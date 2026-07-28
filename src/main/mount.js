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
function sanitizeDirName(name, fallback) {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim();
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
  const remotes = (await rclone.listRemotes())
    .map((r) => r.replace(/:$/, ''))
    .filter((r) => r !== COMBINE_REMOTE_NAME);

  if (remotes.length === 0) {
    // Nothing to combine yet — leave any previous combine config in place
    // rather than erroring, so the UI can still show an empty state.
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
 */
function prepareMountDir() {
  if (process.platform === 'win32') {
    if (fs.existsSync(MOUNT_DIR)) {
      // Only ever remove an EMPTY leftover directory (e.g. from an older
      // CloudMerge version, or a previous failed mount) — if it's
      // non-empty for any reason, leave it alone and let rclone's own
      // mount error surface rather than risk deleting real files.
      const isEmpty = fs.readdirSync(MOUNT_DIR).length === 0;
      if (isEmpty) fs.rmdirSync(MOUNT_DIR);
    }
    return;
  }
  if (!fs.existsSync(MOUNT_DIR)) fs.mkdirSync(MOUNT_DIR, { recursive: true });
}

async function mount() {
  if (isMounted()) return { alreadyMounted: true, mountDir: MOUNT_DIR };

  const hasRemotes = await regenerateCombineRemote();
  if (!hasRemotes) return { noAccounts: true };

  prepareMountDir();

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

  mountProcess = spawn(bin, args, { windowsHide: true });
  mountProcess.on('exit', () => { mountProcess = null; });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve({ mountDir: MOUNT_DIR }), 2500);
    mountProcess.stderr.on('data', (d) => {
      const s = d.toString();
      // Only treat genuinely fatal, mount-never-started failures as a
      // rejection. rclone logs plenty of "ERROR"-level lines for one-off,
      // per-item problems (a single unreadable file, a symlink it skipped,
      // a rate-limited API call) while the mount itself succeeds and stays
      // up — matching on the bare word "error" (as this used to) treated
      // those as if the whole mount had failed, which produced a false
      // "could not connect the folder" report even though it had. rclone's
      // own fatal-startup failures are consistently logged as "CRITICAL:
      // Fatal error: ..." (verified against real failure output), so match
      // that instead.
      if (/fatal error|failed to mount fuse/i.test(s)) {
        clearTimeout(timeout);
        reject(new Error(s));
      }
    });
  });
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

module.exports = { mount, unmount, remount, isMounted, MOUNT_DIR, regenerateCombineRemote };
