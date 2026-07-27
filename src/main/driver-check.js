'use strict';

/**
 * driver-check.js — verify the platform's FUSE-compatible driver is present
 * before attempting a mount.
 *
 * CloudMerge does NOT bundle the WinFsp or macFUSE installers. Both
 * projects require a paid commercial license to bundle/distribute with
 * closed-source software (see LICENSING.md) — that's a business step for
 * you to complete directly with each project's author, not something this
 * code can do for you. Until that's sorted, CloudMerge points users at the
 * official installers instead of shipping them itself.
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

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: `${name} required`,
    message: `CloudMerge needs ${name} installed to mount your cloud accounts as a folder.`,
    detail: `${name} isn't bundled with CloudMerge (its license requires a separate ` +
      `commercial agreement for closed-source distribution — see LICENSING.md). ` +
      `Click "Open download page" to install it, then relaunch CloudMerge.`,
    buttons: ['Open download page', 'Cancel'],
    defaultId: 0,
  });

  if (response === 0) shell.openExternal(url);
  return false;
}

module.exports = { isDriverInstalled, ensureDriverOrPrompt };
