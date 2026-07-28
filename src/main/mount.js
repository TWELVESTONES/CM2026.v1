'use strict';

/**
 * mount.js — the "odrive-style unified folder" layer.
 *
 * Strategy: rclone's `combine` backend can present several remotes as
 * named subdirectories of one virtual remote. We regenerate a `merged`
 * combine remote every time the account list changes (upstreams = every
 * configured remote, keyed by its own name), then `rclone mount` that one
 * virtual remote to a single local folder, e.g. ~/CloudMerge.
 *
 * Result: ~/CloudMerge/Google Drive — jamesfw@gmail.com/...,
 * ~/CloudMerge/OneDrive — jamesfw@outlook.com/..., etc. — one folder, one
 * friendly-named subfolder per account (falls back to the raw rclone remote
 * name until a friendly identity has been looked up), exactly like odrive's
 * placeholder-file approach but backed by rclone's VFS layer (on-demand file
 * fetch, not a full local copy).
 *
 * Requires WinFsp (Windows) or macFUSE (Mac) to be installed — rclone mount
 * shells out to whichever FUSE-compatible driver is present on the system.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const rclone = require('./rclone');
const accountLabels = require('./account-labels');

const MOUNT_DIR = path.join(os.homedir(), 'CloudMerge');
const COMBINE_REMOTE_NAME = 'merged';

let mountProcess = null;

// Populated by regenerateCombineRemote() with any configured remote that got
// left out of the combined mount because its own config is incomplete (see
// rclone.isRemoteConfigComplete) — currently only possible for a OneDrive
// account whose drive_id/drive_type never got recorded (e.g. one created
// before addOneDriveRemote()'s own cleanup-on-failure existed). Exposed via
// getSkippedRemotes() so index.js can tell the user *which* account needs
// attention instead of the whole folder just silently missing it.
let lastSkippedRemotes = [];

function getSkippedRemotes() {
  return lastSkippedRemotes;
}

// Mirrors renderer.js's own providerLabel() — keep the two in sync. Used to
// build the same "Google Drive — jamesfw@gmail.com" style name for the
// *mounted folder's subdirectory*, not just the in-app account list.
function providerLabel(remoteName) {
  if (remoteName.startsWith('gdrive') || remoteName.startsWith('google_drive') || remoteName.includes('google')) return 'Google Drive';
  if (remoteName.startsWith('onedrive')) return 'OneDrive';
  if (remoteName.startsWith('dropbox')) return 'Dropbox';
  if (remoteName.startsWith('wd_cloud')) return 'WD Cloud / NAS';
  return 'Cloud account';
}

// Windows (and, to a lesser extent, macOS/Linux) forbid these characters in
// file/directory names. A looked-up identity is normally just an email
// address, which never contains them, but sanitize defensively rather than
// let an unexpected provider response (or display name) break mounting
// entirely — falling back to the raw remote name if nothing usable remains.
//
// `=` is included here too, even though it's a perfectly legal filename
// character on every OS CloudMerge supports: a QA pass ahead of this
// release found that rclone's `combine` backend parses each upstream on the
// *first* `=` it finds, splitting "dir=name:" into its two halves — so a
// display name containing its own `=` (a work/school account's display name
// is tenant-controlled free text, not something CloudMerge or the person
// using it has any control over) would silently produce a malformed
// upstream and take down the *entire* merged mount, exactly the class of
// single-account-poisons-everything failure this whole release exists to
// prevent. Every other character combine's parser accepts as-is.
function sanitizeDirName(name, fallback) {
  const cleaned = name.replace(/[<>:"/\\|?*=\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
  return cleaned || fallback;
}

/**
 * Build the subdirectory name a given remote should appear as inside the
 * merged mount. Previously this was always the raw rclone remote name (e.g.
 * "google_drive-ms4up8n3") — the friendly-name lookup in account-identity.js
 * only ever fed the *in-app account list*, never the actual mounted folder,
 * so the folder itself kept showing technical names even once labels worked.
 *
 * `usedNames` guards against two accounts resolving to the identical display
 * name (e.g. the same account connected twice) — combine's upstream "dir"
 * keys must be unique, or one silently shadows the other.
 */
function friendlyDirName(remoteName, labels, usedNames) {
  const label = labels[remoteName];
  let dirName = label
    ? sanitizeDirName(`${providerLabel(remoteName)} — ${label}`, remoteName)
    : remoteName;
  if (usedNames.has(dirName)) dirName = `${dirName} (${remoteName.slice(-6)})`;
  usedNames.add(dirName);
  return dirName;
}

async function regenerateCombineRemote() {
  const allRemotes = (await rclone.listRemotes())
    .map((r) => r.replace(/:$/, ''))
    .filter((r) => r !== COMBINE_REMOTE_NAME);

  if (allRemotes.length === 0) {
    // Nothing to combine yet — leave any previous combine config in place
    // rather than erroring, so the UI can still show an empty state.
    lastSkippedRemotes = [];
    return false;
  }

  // Exclude any remote whose own config is incomplete (currently: a OneDrive
  // account missing drive_id/drive_type — see rclone.isRemoteConfigComplete)
  // from the combine upstreams entirely, rather than including it and
  // letting rclone's mount fail outright for *every* account. Previously a
  // single broken OneDrive remote — even one left over from before
  // addOneDriveRemote()'s own verification/cleanup existed — poisoned the
  // whole merged mount with a CRITICAL crash, taking down Google Drive/
  // Dropbox too, even though only one account was actually broken.
  const dump = await rclone.dumpAllRemoteConfigs();
  const remotes = dump
    ? allRemotes.filter((r) => rclone.isRemoteConfigComplete(dump[r]))
    : allRemotes; // couldn't check — don't block on a check we can't perform
  lastSkippedRemotes = dump ? allRemotes.filter((r) => !remotes.includes(r)) : [];

  if (remotes.length === 0) {
    // Every configured remote is broken — nothing usable to combine, same
    // as having no accounts at all.
    return false;
  }

  // Build `upstreams` as "dir=name:" pairs, one per configured account. The
  // "dir" half is a friendly display name when we have one (falls back to
  // the raw remote name otherwise) — it's just the mount's subfolder label,
  // the "name:" half after the "=" is still the real rclone remote
  // reference, unchanged. Each entry is individually double-quoted per
  // rclone's own `--combine-upstreams` syntax: the overall `upstreams` value
  // is itself a space-separated list, so an unquoted friendly name
  // containing spaces (e.g. "Google Drive — jamesfw@gmail.com") would be
  // misparsed as several separate entries and break the *entire* combined
  // mount, not just that one account — verified this failure mode directly
  // ("no \"=\" in upstream definition") before adding the quoting.
  const labels = accountLabels.readAll();
  const usedNames = new Set();
  const args = ['config', 'create', COMBINE_REMOTE_NAME, 'combine', 'upstreams'];
  const upstreamArg = remotes
    .map((r) => `"${friendlyDirName(r, labels, usedNames)}=${r}:"`)
    .join(' ');
  const { code, stderr } = await rclone.run([...args, upstreamArg]);
  if (code !== 0) {
    throw new Error(`Failed to regenerate combined view: ${stderr}`);
  }
  return true;
}

function isMounted() {
  return mountProcess !== null && !mountProcess.killed;
}

/**
 * Whether the mounted folder is *actually usable* right now, not just
 * whether the rclone process happens to still be running.
 *
 * `isMounted()` only reflects "the child process hasn't exited" — but a
 * process can stay alive indefinitely without WinFsp ever having actually
 * attached the mount (for example, if MOUNT_DIR already existed with
 * leftover content from an older version/failed attempt, which blocks
 * Windows's fixed-disk mount mode from ever creating the reparse point).
 * That gap is exactly what let CloudMerge report "Connected" while
 * Explorer's own "Windows cannot find ... CloudMerge" error still showed
 * up when opening the folder — verified by reasoning through the reported
 * screenshot: the app displayed its "Connected" state (so `mount()` had
 * already resolved successfully) yet the OS-level path didn't exist.
 *
 * The one signal that's reliable on both Windows (target doesn't exist at
 * all until WinFsp attaches it) and Linux/macOS (target is pre-created
 * empty, then FUSE overlays it) is: once truly mounted, listing MOUNT_DIR
 * returns at least one entry, because `mount()` never runs with zero
 * configured remotes (see the `hasRemotes` guard below) — so a genuinely
 * live mount always has at least one account subfolder to show.
 */
function isMountFolderReady() {
  try {
    return fs.readdirSync(MOUNT_DIR).length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Get MOUNT_DIR into the state rclone needs it in before mounting — and
 * that state is the *opposite* on Windows vs. Linux/macOS.
 *
 * Per `rclone mount --help`, Windows's default "fixed disk drive" mode
 * (what we use — see the removed `--network-mode` note in mount() below)
 * requires the target to be "a path representing a **nonexistent**
 * subdirectory of an **existing** parent directory" — rclone/WinFsp
 * creates the folder itself as part of setting up the mount. Linux/macOS
 * FUSE is the opposite: the target directory must already exist (and be
 * empty) before mounting.
 *
 * Previously this always pre-created MOUNT_DIR (the correct behavior for
 * Linux/macOS), which on Windows left a plain, empty, never-actually-
 * mounted CloudMerge folder sitting on disk — every real mount attempt
 * failed silently against it, which is why accounts appeared "connected"
 * in the account list but the folder stayed empty.
 *
 * Returns `{ hadStaleNonEmptyDir }` so mount() can mention this specific,
 * known cause by name if the mount below never actually comes up — a
 * leftover non-empty folder at this exact path is a very plausible reason
 * Windows's fixed-disk mode would silently refuse to attach.
 */
function prepareMountDir() {
  if (process.platform === 'win32') {
    if (fs.existsSync(MOUNT_DIR)) {
      // Only ever remove an EMPTY leftover directory (e.g. from an older
      // CloudMerge version, or a previous failed mount) — if it's
      // non-empty for any reason, leave it alone and let rclone's own
      // mount error surface rather than risk deleting real files.
      const isEmpty = fs.readdirSync(MOUNT_DIR).length === 0;
      if (isEmpty) {
        fs.rmdirSync(MOUNT_DIR);
      } else {
        return { hadStaleNonEmptyDir: true };
      }
    }
    return { hadStaleNonEmptyDir: false };
  }
  if (!fs.existsSync(MOUNT_DIR)) fs.mkdirSync(MOUNT_DIR, { recursive: true });
  return { hadStaleNonEmptyDir: false };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mount() {
  if (isMounted()) return { alreadyMounted: true, mountDir: MOUNT_DIR };

  const hasRemotes = await regenerateCombineRemote();
  if (!hasRemotes) return { noAccounts: true };

  const { hadStaleNonEmptyDir } = prepareMountDir();

  const bin = rclone.getRclonePath();
  const args = [
    '--config', rclone.getConfigPath(),
    'mount', `${COMBINE_REMOTE_NAME}:`, MOUNT_DIR,
    '--vfs-cache-mode', 'writes',
    '--dir-cache-time', '30s',
    '--no-modtime',
    // Without this, rclone's VFS layer refuses to render any entry it sees
    // as a symlink at all ("symlinks not supported without the --links
    // flag"), which can surface for a single item from any provider — not
    // something specific to one account. --vfs-links makes it represent
    // that item as a plain ".rclonelink" file instead of erroring.
    '--vfs-links',
  ];
  // NOTE: this used to also push `--network-mode` on Windows, on the
  // (incorrect) assumption it was needed to mount onto a folder. rclone's
  // own docs are explicit that --network-mode is fundamentally
  // incompatible with a directory-path target: "Mounting to a directory
  // path is not supported in this mode ... the remote must always be
  // mounted to a drive letter." Since the whole point of CloudMerge is
  // the single-folder (MOUNT_DIR) experience, every Windows mount attempt
  // with that flag was guaranteed to fail — which is why the folder
  // never actually connected. Plain directory-path mounting (rclone's
  // default "fixed disk drive" mode) is what supports a folder target, so
  // we just don't pass the flag at all.

  // Capture this specific process in a local `proc` and only null out the
  // module-level `mountProcess` if it's still the SAME process by the time
  // 'exit' actually fires — not just whichever one happens to be current at
  // that moment. Without this guard, a QA pass ahead of this release found
  // a real race: unmount()'s 5s safety net (below) can resolve — and the
  // caller (remount()) can go on to spawn a brand new mount process — before
  // this OLD process's own 'exit' event has actually fired. When it finally
  // does fire, its handler would blindly null out `mountProcess`, wiping out
  // the reference to the live NEW process even though the new mount is
  // still running fine — silently breaking isMounted() (so the tray/UI
  // reports "not connected" for a folder that's actually working) and
  // letting a later mount() spawn yet another duplicate process on top of
  // it, since isMounted() would wrongly say nothing was running.
  const proc = spawn(bin, args, { windowsHide: true });
  proc.on('exit', () => { if (mountProcess === proc) mountProcess = null; });
  mountProcess = proc;

  let stderrBuf = '';
  let criticalError = null;
  mountProcess.stderr.on('data', (d) => {
    const s = d.toString();
    stderrBuf += s;
    // rclone's own log levels distinguish routine per-item problems
    // ("ERROR :" — a single unreadable file, a symlink it skipped, a
    // rate-limited API call — the mount itself keeps running) from
    // failures serious enough that the process gives up and exits
    // ("CRITICAL:" — e.g. "Fatal error: failed to mount FUSE fs: ...", or
    // "Failed to create file system for ..." when one account's upstream
    // fails to initialize). Matching on the bare word "error" (as this
    // used to) treated routine per-item ERROR lines as if the whole mount
    // had failed; matching only two specific fatal phrases missed other
    // CRITICAL failures entirely. Matching rclone's own CRITICAL level
    // catches genuine fatal failures without needing to enumerate every
    // possible message, and without misfiring on benign ERROR-level noise.
    if (/critical:/i.test(s)) criticalError = s;
  });

  // Don't just trust that some fixed amount of time passed without a
  // recognized fatal-error line meaning the mount is healthy — poll for
  // the mount actually becoming *usable* instead. A process staying alive
  // is not the same thing as WinFsp having actually attached the folder:
  // that gap is exactly what let a mount silently fail to attach (e.g.
  // because MOUNT_DIR already existed non-empty, which blocks Windows's
  // fixed-disk mount mode, without rclone logging anything CRITICAL) while
  // CloudMerge still reported "Connected" — confirmed by a real report
  // where the app showed "Connected" yet Explorer's own "Windows cannot
  // find ... CloudMerge" error still appeared when opening the folder.
  // `isMountFolderReady()` checks for real content in MOUNT_DIR, which is
  // only ever true once the mount has genuinely attached (see its comment
  // for why that signal is reliable on both Windows and Linux/macOS).
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (criticalError) throw new Error(criticalError);
    if (!isMounted()) {
      throw new Error(
        `rclone exited before the mount could be confirmed.\n\n${stderrBuf || '(no output captured)'}`
      );
    }
    if (isMountFolderReady()) return { mountDir: MOUNT_DIR };
    await sleep(250);
  }

  // Timed out without ever seeing the mount become usable, and without a
  // recognized fatal error either — something is either very slow, or
  // WinFsp silently refused to attach without logging anything we'd
  // recognize as fatal.
  const staleDirHint = hadStaleNonEmptyDir
    ? `\n\nThis looks like it may be caused by ${MOUNT_DIR} already existing with ` +
      `leftover files in it (e.g. from an older CloudMerge version, or a previous ` +
      `failed connection) — Windows won't connect the folder onto a path that ` +
      `already exists and isn't empty. Try closing CloudMerge, renaming or moving ` +
      `that folder aside, and reopening CloudMerge.`
    : '';
  throw new Error(
    `CloudMerge folder didn't finish connecting.\n\n${stderrBuf || '(no output captured)'}${staleDirHint}`
  );
}

async function unmount() {
  if (!isMounted()) return;
  const proc = mountProcess;
  // Wait for the process to actually exit rather than firing kill() and
  // moving on immediately — remount() below calls mount() right after
  // unmount() resolves, and starting a fresh mount at MOUNT_DIR before
  // Windows/WinFsp has finished releasing the previous one races against
  // that teardown. 5s safety net in case the process doesn't respond to
  // kill() promptly (observed occasionally with WinFsp mounts).
  await new Promise((resolve) => {
    proc.once('exit', resolve);
    proc.kill();
    setTimeout(resolve, 5000);
  });
  mountProcess = null;
}

/**
 * Tear down and re-establish the mount so it picks up the current account
 * list. Needed because rclone's `combine` backend only reads its upstream
 * list once, when the mount process starts — regenerating the `merged`
 * remote's config *while a mount is already running* does not add/remove
 * that account from the live folder. Previously, adding/removing accounts
 * after the first one just silently never showed up (or disappeared)
 * until CloudMerge was restarted.
 */
async function remount() {
  if (isMounted()) await unmount();
  return mount();
}

// mount()/unmount()/remount() are each called from several independent
// places — startup, the accounts:add/accounts:remove IPC handlers, the
// periodic label-backfill timer in index.js, and app quit — with nothing
// previously stopping two of them from running at the same time (a QA pass
// ahead of the v0.1.12 release flagged this as a real gap). Two overlapping
// mount() calls can each see isMounted() === false and both spawn their own
// rclone mount process onto the same MOUNT_DIR: only the second one ends up
// tracked in `mountProcess`, so the first is orphaned — still running,
// invisible to isMounted()/unmount(), and left behind in Task Manager even
// after a clean "Quit CloudMerge" successfully kills the one process this
// module still knows about. Serializing every call through this queue
// means only one mount-affecting operation is ever in flight at a time,
// however many callers ask for one concurrently.
let opQueue = Promise.resolve();
function serialized(fn) {
  return (...args) => {
    const result = opQueue.then(() => fn(...args), () => fn(...args));
    opQueue = result.then(() => {}, () => {}); // keep the chain alive even if this call rejected
    return result;
  };
}

module.exports = {
  mount: serialized(mount),
  unmount: serialized(unmount),
  remount: serialized(remount),
  isMounted, isMountFolderReady, MOUNT_DIR,
  regenerateCombineRemote, getSkippedRemotes,
};
