'use strict';

/**
 * rclone.js — thin wrapper around the bundled rclone binary.
 *
 * CloudMerge does not reimplement cloud-sync protocols. It shells out to the
 * real rclone (https://rclone.org, MIT licensed) for every account
 * connection and mount operation. See /resources/licenses/rclone-LICENSE
 * for the required attribution notice.
 *
 * rclone ships with its own registered OAuth client IDs for Google Drive,
 * OneDrive, and Dropbox, so the standard `rclone config create` flow opens
 * a normal browser sign-in/consent screen without CloudMerge needing to
 * register its own OAuth app for an MVP. For a commercial release at scale,
 * swapping in your own client_id/client_secret per provider is recommended
 * (see README "Scaling up" section) — Google in particular requires an
 * OAuth verification review for apps requesting Drive scope from the public.
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'
// resources/bin ships both shipping platforms' binaries side by side (see
// scripts/fetch-rclone.sh); pick the right one for the current OS. Linux is
// not a CloudMerge distribution target — rclone-linux is bundled only so
// this codebase can be developed/tested in a Linux sandbox.
const BIN_NAME = PLATFORM === 'win32' ? 'rclone.exe'
  : PLATFORM === 'darwin' ? 'rclone-mac'
  : 'rclone-linux';

function getResourcesPath() {
  // In a packaged app, extraResources land next to the executable under
  // process.resourcesPath, flattened to resources/bin/<binary>. In dev
  // (unpacked repo), binaries instead live under resources/bin/<platform>/.
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'bin'))) {
    return process.resourcesPath;
  }
  return path.join(__dirname, '..', '..', 'resources');
}

function getRclonePath() {
  const base = getResourcesPath();
  const packaged = path.join(base, 'bin', BIN_NAME);
  if (fs.existsSync(packaged)) return packaged;
  // Dev-mode layout: resources/bin/win/rclone.exe, resources/bin/mac/rclone-mac,
  // resources/bin/rclone-linux (flat, dev/testing only — not packaged).
  const devSubdir = PLATFORM === 'win32' ? 'win' : PLATFORM === 'darwin' ? 'mac' : '';
  return devSubdir
    ? path.join(base, 'bin', devSubdir, BIN_NAME)
    : path.join(base, 'bin', BIN_NAME);
}

function getConfigPath() {
  const dir = path.join(os.homedir(), '.cloudmerge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'rclone.conf');
}

/** Run an rclone subcommand, resolving with {stdout, stderr, code}. */
function run(args, opts = {}, _retriesLeft = 8) {
  return new Promise((resolve, reject) => {
    const bin = getRclonePath();
    if (!fs.existsSync(bin)) {
      reject(new Error(
        `rclone binary not found at ${bin}. Run scripts/fetch-rclone.sh ` +
        `(or .ps1 on Windows) to download it into resources/bin before building.`
      ));
      return;
    }
    const fullArgs = ['--config', getConfigPath(), ...args];
    const child = spawn(bin, fullArgs, { windowsHide: true, ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      // Diagnosed from a real report: CloudMerge's installer now auto-
      // launches the app the instant setup finishes (runAfterFinish, see
      // package.json), which can fire before Windows Defender's on-access
      // scan of the just-written rclone.exe has released its lock on the
      // file — the very first spawn attempt on a brand new install can fail
      // with a generic, unhelpful "spawn UNKNOWN" even though the exe is
      // completely fine. Retry with a short delay before giving up, instead
      // of surfacing a scary error on a fresh install. This only triggers on
      // genuine spawn failures (the child process never started at all) — a
      // normal rclone run that exits non-zero still resolves via 'close'
      // below and is never retried here.
      //
      // v0.1.14 shipped this with a ~3s total retry budget (2 retries x
      // 1.5s), which turned out not to be enough — the same "spawn UNKNOWN"
      // was reported again on a fresh v0.1.14 install. A first-time scan of
      // a brand new, unsigned executable can involve a cloud reputation
      // lookup (Defender's MAPS/Smart App Control checks), not just a local
      // heuristic pass, which can run well past 3 seconds. Widened to 8
      // retries at 2s apart (~16s total budget) to give that real-world
      // range enough room. This only costs time on the rare first-launch
      // race — every other call (and every later launch, once the file's
      // already been scanned once) succeeds on the very first attempt with
      // no delay at all. The tray icon is created before this ever runs
      // (see index.js), so the app doesn't look frozen or unlaunched while
      // this plays out in the background.
      if (_retriesLeft > 0) {
        setTimeout(() => {
          run(args, opts, _retriesLeft - 1).then(resolve, reject);
        }, 2000);
      } else {
        reject(err);
      }
    });
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/** List configured remotes, e.g. ['gdrive-work:', 'onedrive-personal:'] */
async function listRemotes() {
  const { stdout, code } = await run(['listremotes']);
  if (code !== 0) return [];
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

// Provider -> rclone backend type + any extra config flags needed.
// google_drive/onedrive/dropbox are OAuth-based (browser sign-in, no fields
// needed from the user beyond a display name). wd_cloud is SMB-based — WD
// My Cloud / My Cloud Home devices (and any other NAS, generically) are
// reached over the local network via the same protocol as Windows file
// sharing, not a public OAuth API, so it needs real connection details
// instead of a "click to sign in" button.
const PROVIDER_MAP = {
  google_drive: { type: 'drive', auth: 'oauth' },
  // onedrive needs one extra piece of setup beyond plain OAuth: after
  // signing in, rclone's own wizard always asks which specific drive to use
  // (fetched live from Microsoft Graph's "/me/drives") — a question that,
  // per rclone's own onedrive.go source, is NEVER skippable by pre-supplying
  // a config key up front (there's no "if drive_id is already set, skip the
  // lookup" shortcut). A first attempt at fixing this (v0.1.9/v0.1.10) only
  // pre-supplied `config_type=onedrive`, which skips the earlier "type of
  // connection" question but leaves this drive question completely
  // unanswered — confirmed by a real-machine test to still reproduce the
  // exact same "unable to get drive_id and drive_type" crash even on a
  // fresh install. addRemote() below special-cases 'onedrive' to actually
  // drive rclone's non-interactive config wizard end to end instead (see
  // addOneDriveRemote), so this entry no longer carries an `extraConfig` —
  // handling it generically here was the part that didn't work.
  onedrive: { type: 'onedrive', auth: 'oauth' },
  dropbox: { type: 'dropbox', auth: 'oauth' },
  wd_cloud: {
    type: 'smb',
    auth: 'manual',
    fields: [
      { key: 'host', label: 'Device address', placeholder: '192.168.1.50 or mycloudname.local', required: true },
      { key: 'share', label: 'Share name', placeholder: 'Public', required: true },
      { key: 'user', label: 'Username', placeholder: '', required: true },
      { key: 'pass', label: 'Password', placeholder: '', required: false, secret: true },
    ],
  },
};

/**
 * Create a new remote.
 *
 * For most OAuth providers (google_drive/dropbox), this drives rclone's
 * plain config flow: `rclone config create <name> <type> ...` opens the
 * user's default browser for the OAuth consent screen and writes the
 * resulting token back into the config file once they finish signing in —
 * nothing else to answer, so a single call is enough.
 *
 * onedrive is handled separately by addOneDriveRemote() below: after OAuth
 * it always has one more question rclone must resolve (which drive to use)
 * that a single plain call can't answer, so it needs the fuller
 * non-interactive wizard-driving treatment instead. See that function's
 * comment for why.
 *
 * For manual providers (wd_cloud/SMB), `params` supplies the connection
 * details (host/share/user/pass) directly instead — no browser round trip,
 * since NAS devices authenticate with plain credentials on your local
 * network, not OAuth. Password-like fields are passed with `--obscure` so
 * rclone stores them obfuscated in its config file rather than plaintext.
 *
 * @param {string} name - user-facing label, e.g. "gdrive-jamesfw"
 * @param {'google_drive'|'onedrive'|'dropbox'|'wd_cloud'} provider
 * @param {Object} [params] - required for 'wd_cloud': { host, share, user, pass }
 */
async function addRemote(name, provider, params = {}) {
  const cfg = PROVIDER_MAP[provider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');

  if (provider === 'onedrive') {
    await addOneDriveRemote(safeName);
    return safeName;
  }

  const args = ['config', 'create', safeName, cfg.type, 'config_is_local', 'true'];
  let hasSecret = false;

  if (cfg.auth === 'manual') {
    for (const field of cfg.fields) {
      const value = params[field.key];
      if (field.required && !value) {
        throw new Error(`Missing required field "${field.label}" for ${provider}`);
      }
      if (value) {
        args.push(field.key, value);
        if (field.secret) hasSecret = true;
      }
    }
  }
  if (hasSecret) args.push('--obscure');

  const { stdout, stderr, code } = await run(args);
  if (code !== 0) {
    throw new Error(`Failed to add ${provider} remote "${safeName}":\n${stderr || stdout}`);
  }
  return safeName;
}

/** Parse one line of rclone's `--non-interactive` JSON wizard output, or
 * null if it isn't (yet) a parseable JSON question — e.g. still mid-OAuth,
 * where rclone only logs plain NOTICE lines to stderr until the browser
 * round trip finishes. */
function parseWizardJSON(output) {
  const trimmed = (output || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}

/**
 * Every remote's raw config fields as reported by `rclone config dump`,
 * keyed by remote name (no trailing colon) — the same data source used to
 * verify a fresh OneDrive setup below, and reused by mount.js so a broken
 * remote sitting in an existing config (from before this check existed, or
 * from any other cause) gets excluded from the combined mount rather than
 * crashing it outright. Returns null if the dump can't be read/parsed —
 * callers should treat that as "couldn't check" and not block on it.
 */
async function dumpAllRemoteConfigs() {
  const { stdout, code } = await run(['config', 'dump']);
  if (code !== 0) return null;
  try {
    return JSON.parse(stdout);
  } catch (_) {
    return null;
  }
}

/**
 * Whether a remote's config section actually has everything its backend
 * needs to work, beyond just existing. Currently this only matters for
 * onedrive: `rclone config create` can report success and leave a config
 * section behind (see addOneDriveRemote) without ever recording
 * `drive_id`/`drive_type` — a gap that's otherwise silent until the combined
 * folder tries to mount. Every other provider CloudMerge supports
 * (google_drive/dropbox/wd_cloud) has no equivalent post-setup step, so an
 * existing config section for those is assumed complete.
 */
function isRemoteConfigComplete(section) {
  if (!section) return false;
  if (section.type === 'onedrive') return Boolean(section.drive_id && section.drive_type);
  return true;
}

/**
 * Pick an answer for one step of rclone's non-interactive config wizard.
 *
 * - `config_type`: always "onedrive" (Personal/Business sign-in) — never
 *   sharepoint/url/search/manual-ID, which need extra details CloudMerge's
 *   UI has no field to collect.
 * - `config_driveid` (the "which drive" question, fetched live from
 *   Microsoft Graph's /me/drives): prefer a personal or business OneDrive
 *   over a SharePoint document library — see chooseDriveId() below for why.
 * - Any yes/no confirmation (Type "bool", e.g. "use this drive?"): "true" —
 *   there's nothing else CloudMerge could sensibly answer here.
 * - Anything else presented as a list of choices: take the first option.
 * - Otherwise, whatever default rclone itself proposes, or "" as a last resort.
 */
function answerForWizardStep(state) {
  const opt = (state && state.Option) || {};
  if (opt.Name === 'config_type') return 'onedrive';
  if (opt.Name === 'config_driveid' && Array.isArray(opt.Examples) && opt.Examples.length > 0) {
    return chooseDriveId(opt.Examples);
  }
  if (opt.Type === 'bool') return 'true';
  if (Array.isArray(opt.Examples) && opt.Examples.length > 0) {
    return String(opt.Examples[0].Value);
  }
  if (opt.Default !== undefined && opt.Default !== null) return String(opt.Default);
  return '';
}

/**
 * Pick which drive to use from rclone's "config_driveid" choice list.
 *
 * First diagnosed from a real report: a user's OneDrive add attempt failed
 * with "Failed to query root for drive \"b!...\": HTTP error 400 ...
 * ObjectHandle is Invalid" — an error rclone's own onedrive backend raised
 * while trying to validate the drive CloudMerge had picked. The v0.1.16 fix
 * below (the `isOwnType` check) addressed one cause of that: the old code
 * took Examples[0] unconditionally, and this account's /me/drives response
 * listed more than one drive — not just their own OneDrive, but at least
 * one SharePoint document library too, which happened to sort first.
 * rclone's own onedrive.go labels each choice exactly "<name> (<type>)" in
 * its Help text ("personal"/"business"/"documentLibrary", confirmed against
 * rclone's public source — CloudMerge doesn't vendor or modify rclone
 * itself, see NOTICE.md), so preferring a personal/business match over a
 * document library was a real improvement.
 *
 * However, the SAME user hit the SAME exact "b!..." drive ID and the SAME
 * ObjectHandle error again on a later attempt, on a build that already had
 * the v0.1.16 fix — meaning that drive genuinely was labeled personal or
 * business, and still failed. Researched afterward: this matches a
 * documented Microsoft Graph limitation (reported independently on
 * Microsoft's own Q&A forum and in rclone's issue tracker) where some
 * drives are only queryable via a short alphanumeric drive ID (e.g.
 * "540541d728bc6c6b"), while the longer "b!"-prefixed base64 composite ID
 * format for that same class of drive — typical of SharePoint-backed
 * drives, but also seen on some accounts' own OneDrive for Business drive —
 * returns exactly this "ObjectHandle is Invalid" error when queried. So:
 * within whichever drives are labeled personal/business, additionally
 * prefer one with a short (non-"b!") ID when there's a choice. This never
 * downgrades to a non-owned drive purely for ID format — it only breaks
 * ties among the user's own drives — so it can't reintroduce the v0.1.16
 * document-library bug.
 *
 * If an account's own drive is *only* ever offered in the "b!" format (no
 * short-ID alternative), this can't fix that by itself — see
 * addOneDriveRemote()'s error-path logging below, which now includes every
 * drive choice offered so a future failure gives real evidence instead of
 * another guess.
 */
function chooseDriveId(examples) {
  const isOwnType = (e) => /\((personal|business)\)/i.test(String(e.Help || ''));
  const isShortId = (e) => !/^b!/i.test(String(e.Value || '').trim());

  const ownTypeMatches = examples.filter(isOwnType);
  const ownShort = ownTypeMatches.find(isShortId);
  if (ownShort) return String(ownShort.Value);
  if (ownTypeMatches.length > 0) return String(ownTypeMatches[0].Value);

  const anyShort = examples.find(isShortId);
  if (anyShort) return String(anyShort.Value);

  return String(examples[0].Value);
}

/**
 * Render the full list of drives rclone offered during config_driveid, for
 * inclusion in an error message. Diagnosed from having burned multiple
 * releases guessing at drive-selection fixes from a single reported drive
 * ID with no visibility into what else was on offer — this makes the next
 * failure (if any) self-diagnosing instead of another guess. Marks which
 * one CloudMerge actually picked so it's clear whether the failure was a
 * bad pick or the only-available option failing regardless.
 */
function formatDriveChoicesForError(choices, chosenValue) {
  if (!choices || choices.length === 0) return '';
  const lines = choices.map((e) => {
    const marker = String(e.Value) === String(chosenValue) ? '-> ' : '   ';
    return `${marker}${e.Help || '(no label)'} [id: ${e.Value}]`;
  });
  return `\n\nDrives offered for this account:\n${lines.join('\n')}`;
}

/**
 * Create a OneDrive remote by driving rclone's config wizard end to end via
 * its documented `--non-interactive`/`--continue` protocol
 * (https://rclone.org/commands/rclone_config_create/), instead of the
 * single plain `config create` call used for google_drive/dropbox.
 *
 * Why OneDrive specifically needs this: after OAuth, the onedrive backend
 * always has one more question — which specific drive to use, looked up
 * live from Microsoft Graph's "/me/drives" — and per rclone's own
 * onedrive.go source, that question is asked unconditionally; there is no
 * "already have a drive_id, skip the lookup" shortcut. A plain `config
 * create` call has no real terminal attached to answer it, so that prompt
 * was previously never actually answered, leaving the remote listed as
 * "added" but with no `drive_id`/`drive_type` ever recorded — invisible
 * until the folder tried to mount. (An earlier fix in v0.1.10 only
 * pre-supplied `config_type=onedrive`, which skips the *type of
 * connection* question but not this one — confirmed insufficient by a
 * real-machine test that reproduced the identical crash on a completely
 * fresh install.)
 *
 * Each `--continue` call below returns the next question as JSON (or an
 * empty State once done); answerForWizardStep() answers each one
 * automatically, and the OAuth step itself (opening the browser, waiting
 * for the person to actually sign in) happens synchronously inside
 * whichever single call is running at the time — same as it always has.
 *
 * Verification note: the wizard protocol shape, JSON field names, and exact
 * command syntax used here were confirmed directly against the real
 * bundled rclone binary. The one step that can't be exercised in this
 * sandbox (no real Microsoft account/network) is a live OAuth sign-in
 * itself, so the drive-selection step immediately after it — while
 * implemented from rclone's own source — hasn't been exercised against a
 * real Microsoft Graph response.
 */
async function addOneDriveRemote(safeName) {
  const MAX_STEPS = 25; // generous ceiling — a real run takes roughly 3-4 steps
  // Captured when rclone presents the config_driveid step, purely for
  // inclusion in an error message if setup fails afterward — see
  // formatDriveChoicesForError()'s comment for why this exists.
  let driveChoices = null;
  let chosenDriveId = null;

  let { stdout, stderr, code } = await run([
    'config', 'create', safeName, 'onedrive',
    'config_is_local', 'true',
    '--non-interactive',
  ]);
  let state = parseWizardJSON(stdout);
  if (!state && code !== 0) {
    throw new Error(`Failed to start OneDrive setup for "${safeName}":\n${stderr || stdout}`);
  }

  // From here on, the `config create` call above has already written a stub
  // config section for `safeName` to disk. Any failure below — a wizard-
  // reported Error, an unanswerable question hitting MAX_STEPS, or the
  // post-wizard drive_id/drive_type check failing — needs to roll that stub
  // back, not just the final verification-failure case: a QA pass ahead of
  // this release found that rclone's onedrive backend can report a
  // ConfigError *partway* through the wizard (its own error for e.g. a
  // failed Microsoft Graph call — "/me/drives", "/me/drive", or
  // "/drives/<id>/root" failing, which can happen even after a completely
  // valid sign-in, and is more common for work/school accounts) — and an
  // earlier version of this function only cleaned up the "wizard said done
  // but drive_id/drive_type is still missing" case below, leaving any other
  // failure's half-created remote sitting in rclone.conf permanently. That
  // orphaned entry would then just sit there getting silently excluded (and
  // nagged about) by mount.js's filtering on every future launch forever,
  // instead of ever actually going away.
  try {
    let steps = 0;
    while (state && state.State) {
      if (state.Option && state.Option.Name === 'config_driveid' && Array.isArray(state.Option.Examples)) {
        driveChoices = state.Option.Examples;
      }
      if (state.Error) {
        throw new Error(
          `OneDrive setup for "${safeName}" hit an error: ${state.Error}` +
          formatDriveChoicesForError(driveChoices, chosenDriveId)
        );
      }
      if (++steps > MAX_STEPS) {
        throw new Error(
          `OneDrive setup for "${safeName}" didn't finish after ${MAX_STEPS} steps ` +
          `(stuck asking about "${(state.Option && state.Option.Name) || state.State}"). ` +
          `This likely means rclone asked a question CloudMerge doesn't yet know how to ` +
          `answer automatically — please let me know so I can add support for it.`
        );
      }
      const answer = answerForWizardStep(state);
      if (state.Option && state.Option.Name === 'config_driveid') {
        chosenDriveId = answer;
      }
      ({ stdout, stderr, code } = await run([
        'config', 'update', safeName,
        '--continue', '--state', state.State, '--result', answer,
        '--non-interactive',
      ]));
      state = parseWizardJSON(stdout);
    }
    if (state && state.Error) {
      throw new Error(
        `OneDrive setup for "${safeName}" hit an error: ${state.Error}` +
        formatDriveChoicesForError(driveChoices, chosenDriveId)
      );
    }

    // Belt-and-suspenders: the wizard reporting "done" (empty State) isn't
    // by itself proof drive_id/drive_type actually got set — confirm it
    // directly against the config rclone just wrote, so a still-broken
    // remote is caught here with a clear, actionable error instead of
    // resurfacing later as the exact confusing mount-time CRITICAL crash
    // this fix exists to prevent. (mount.js's regenerateCombineRemote also
    // still excludes any already-incomplete OneDrive remote from the
    // combine upstreams as a second line of defense, in case one is already
    // sitting in an existing install's config from before this existed.)
    const dump = await dumpAllRemoteConfigs();
    if (dump && !isRemoteConfigComplete(dump[safeName])) {
      throw new Error(
        `OneDrive account "${safeName}" finished sign-in, but rclone still didn't record ` +
        `which drive to use, so it wasn't kept. Try adding it again — if this keeps ` +
        `happening, let me know and send the exact wording.` +
        formatDriveChoicesForError(driveChoices, chosenDriveId)
      );
    }
  } catch (err) {
    try {
      await removeRemote(safeName);
    } catch (_) {
      // best-effort cleanup — the original error re-thrown below is what matters
    }
    throw err;
  }
}

async function removeRemote(name) {
  // rclone's `config delete` operates on the config section name, which
  // never includes a trailing colon (that's only used when referring to
  // remote:path in file operations) — strip one defensively in case a
  // caller passes one, since rclone doesn't error on a colon-suffixed name
  // that matches no section: it just exits 0 having deleted nothing,
  // which silently looks like the remote was removed when it wasn't.
  const safeName = name.replace(/:$/, '');
  const { code, stderr } = await run(['config', 'delete', safeName]);
  if (code !== 0) throw new Error(`Failed to remove remote "${safeName}": ${stderr}`);

  // Belt-and-suspenders: `config delete` exiting 0 doesn't actually
  // guarantee the remote is gone (see above), so confirm it before
  // reporting success — otherwise a future edge case here would
  // reproduce the exact "Remove does nothing" bug silently again.
  const remaining = await listRemotes();
  if (remaining.includes(`${safeName}:`)) {
    throw new Error(`rclone reported success removing "${safeName}", but it's still configured.`);
  }
}

module.exports = {
  getRclonePath,
  getConfigPath,
  listRemotes,
  addRemote,
  removeRemote,
  run,
  PROVIDER_MAP,
  dumpAllRemoteConfigs,
  isRemoteConfigComplete,
};
