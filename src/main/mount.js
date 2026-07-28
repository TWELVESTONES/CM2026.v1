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
 * Result: ~/CloudMerge/gdrive-jamesfw/..., ~/CloudMerge/onedrive-work/...,
 * ~/CloudMerge/dropbox-personal/... — one folder, one subfolder per account,
 * exactly like odrive's placeholder-file approach but backed by rclone's
 * VFS layer (on-demand file fetch, not a full local copy).
 *
 * Requires WinFsp (Windows) or macFUSE (Mac) to be installed — rclone mount
 * shells out to whichever FUSE-compatible driver is present on the system.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const rclone = require('./rclone');

const MOUNT_DIR = path.join(os.homedir(), 'CloudMerge');
const COMBINE_REMOTE_NAME = 'merged';

let mountProcess = null;

async function regenerateCombineRemote() {
  const remotes = (await rclone.listRemotes())
    .map((r) => r.replace(/:$/, ''))
    .filter((r) => r !== COMBINE_REMOTE_NAME);

  if (remotes.length === 0) {
    // Nothing to combine yet — leave any previous combine config in place
    // rather than erroring, so the UI can still show an empty state.
    return false;
  }

  // Build `upstreams` as "name=name:" pairs, one per configured account.
  const args = ['config', 'create', COMBINE_REMOTE_NAME, 'combine', 'upstreams'];
  const upstreamArg = remotes.map((r) => `${r}=${r}:`).join(' ');
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
      if (/failed to mount|error/i.test(s)) {
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
