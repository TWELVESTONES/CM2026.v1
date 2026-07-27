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
function run(args, opts = {}) {
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
    child.on('error', reject);
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
 * For OAuth providers (google_drive/onedrive/dropbox), this drives rclone's
 * non-interactive config flow: `rclone config create <name> <type> ...`
 * opens the user's default browser for the OAuth consent screen and writes
 * the resulting token back into the config file once they finish signing in.
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
};
