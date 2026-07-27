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

async function mount() {
  if (isMounted()) return { alreadyMounted: true, mountDir: MOUNT_DIR };

  const hasRemotes = await regenerateCombineRemote();
  if (!hasRemotes) return { noAccounts: true };

  if (!fs.existsSync(MOUNT_DIR)) fs.mkdirSync(MOUNT_DIR, { recursive: true });

  const bin = rclone.getRclonePath();
  const args = [
    '--config', rclone.getConfigPath(),
    'mount', `${COMBINE_REMOTE_NAME}:`, MOUNT_DIR,
    '--vfs-cache-mode', 'writes',
    '--dir-cache-time', '30s',
    '--no-modtime',
  ];
  // Windows-specific: let rclone pick a free network location instead of a
  // fixed drive letter when mounting to an existing empty directory.
  if (process.platform === 'win32') args.push('--network-mode');

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
  mountProcess.kill();
  mountProcess = null;
}

module.exports = { mount, unmount, isMounted, MOUNT_DIR, regenerateCombineRemote };
