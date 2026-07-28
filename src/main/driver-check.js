'use strict';

/**
 * driver-check.js — verify the platform's FUSE-compatible driver is present
 * before attempting a mount.
 *
 * As of v0.1.3, the Windows installer bundles the official, unmodified
 * WinFsp installer and silently runs it during setup if WinFsp isn't
 * already present — permitted under WinFsp's own FLOSS exception, since
 * CloudMerge is MIT-licensed and carries the required attribution in its
 * About screen (see NOTICE.md for the full reasoning). So on a normal
 * v0.1.3+ Windows install, this check should always already pass.
 *
 * It still exists as a safety net for cases where that silent install
 * didn't happen or didn't succeed (e.g. upgraded in-place from an older
 * version, the bundled installer was blocked by policy/antivirus, or
 * you're on macOS, where macFUSE's stricter license means CloudMerge
 * still can't bundle it and has to point at the official installer
 * instead — see NOTICE.md).
 */

const fs = require('fs');
const { shell, dialog } = require('electron');

const WINFSP_PATHS = [
  'C:\\Program Files (x86)\\WinFsp',
  'C:\\Program Files\\WinFsp',
];
const MACFUSE_PATH = '/Library/Filesystems/macfuse.fs';

function isDriverInstalled() {
  if (process.platform === 'win32') {
    return WINFSP_PATHS.some((p) => fs.existsSync(p));
  }
  if (process.platform === 'darwin') {
    return fs.existsSync(MACFUSE_PATH);
  }
  return true; // not a shipping target; dev/linux assumed fine
}

async function ensureDriverOrPrompt() {
  if (isDriverInstalled()) return true;

  const isWin = process.platform === 'win32';
  const name = isWin ? 'WinFsp' : 'macFUSE';
  const url = isWin ? 'https://winfsp.dev/rel/' : 'https://macfuse.github.io/';

  const detail = isWin
    ? `CloudMerge's installer normally installs WinFsp for you automatically (you'll see a ` +
      `Windows admin prompt for that step during setup, since installing a driver always ` +
      `requires it) — so seeing this dialog usually means that step didn't complete: the ` +
      `admin prompt was declined, a policy/antivirus block got in the way, or this is an ` +
      `in-place upgrade from an older CloudMerge version that didn't bundle it. Click ` +
      `"Open download page" to install it manually, then relaunch CloudMerge.`
    : `macFUSE isn't bundled with CloudMerge — its license terms are stricter than WinFsp's ` +
      `and require separate written permission from its author before bundling (see ` +
      `NOTICE.md). Click "Open download page" to install it, then relaunch CloudMerge.`;

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: `${name} required`,
    message: `CloudMerge needs ${name} installed to mount your cloud accounts as a folder.`,
    detail,
    buttons: ['Open download page', 'Cancel'],
    defaultId: 0,
  });

  if (response === 0) shell.openExternal(url);
  return false;
}

module.exports = { isDriverInstalled, ensureDriverOrPrompt };
