'use strict';

const { app, Tray, Menu, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const AutoLaunch = require('auto-launch');
const rclone = require('./rclone');
const mountMgr = require('./mount');
const driverCheck = require('./driver-check');
const accountLabels = require('./account-labels');
const accountIdentity = require('./account-identity');

// Last-resort safety net: an uncaught error anywhere in the main process
// used to mean the app just quietly stopped doing anything further, with
// no window, no tray, and no way for the user to know something went
// wrong. Surface it instead — a visible error beats an invisible zombie
// process every time.
process.on('uncaughtException', (err) => {
  try {
    dialog.showErrorBox('CloudMerge hit an unexpected error', String(err && err.stack || err));
  } catch (_) { /* dialog module itself unavailable this early — nothing more we can do */ }
});
process.on('unhandledRejection', (err) => {
  try {
    dialog.showErrorBox('CloudMerge hit an unexpected error', String(err && err.stack || err));
  } catch (_) { /* same as above */ }
});

let tray = null;
let win = null;

const autoLauncher = new AutoLaunch({ name: 'CloudMerge' });

// Only one CloudMerge instance should ever run at a time — without this,
// double-clicking the desktop icon (or auto-launch plus a manual launch)
// silently spawns a second, third, fourth... background process, each
// invisible unless its own window happens to still be open. If the lock
// fails, this process IS the extra copy — bow out immediately and let the
// original instance (which will be focused via 'second-instance' below)
// keep handling things.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    createWindow();
  });
}

function createWindow() {
  if (win) { win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 480,
    height: 620,
    resizable: false,
    title: 'CloudMerge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

function buildTrayMenu() {
  const mounted = mountMgr.isMounted();
  return Menu.buildFromTemplate([
    { label: 'CloudMerge', enabled: false },
    { type: 'separator' },
    {
      label: mounted ? 'Open Cloud Folder' : 'Not connected yet',
      enabled: mounted,
      click: () => shell.openPath(mountMgr.MOUNT_DIR),
    },
    { label: 'Manage Accounts…', click: createWindow },
    { type: 'separator' },
    { label: 'Quit CloudMerge', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

app.on('ready', async () => {
  try {
    tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
    tray.setToolTip('CloudMerge — all your cloud drives, one folder');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', createWindow);
  } catch (e) {
    // Tray creation failing would previously take the whole startup down
    // with it silently. Surface something rather than nothing.
    dialog.showErrorBox('CloudMerge failed to start the tray icon', String(e && e.message || e));
  }

  try {
    if (!(await autoLauncher.isEnabled())) await autoLauncher.enable();
  } catch (e) { /* non-fatal: auto-launch is a nicety, not a requirement */ }

  // Everything below talks to the bundled rclone binary. If that spawn
  // fails for any reason (blocked by antivirus, missing dependency, first
  // run before WinFsp exists, etc.), it used to throw here uncaught —
  // which silently skipped createWindow() below, leaving the process
  // running invisibly with no window and nothing for the user to see or
  // act on. Always fall through to a visible window instead.
  try {
    const remotes = await rclone.listRemotes();
    if (remotes.length > 0) {
      if (await driverCheck.ensureDriverOrPrompt()) {
        try { await mountMgr.mount(); } catch (e) { /* surfaced in UI on open */ }
      }
      // Fire-and-forget: fill in friendly labels (e.g. an email address)
      // for any account connected before this lookup existed, or whose
      // lookup didn't succeed the first time. Never awaited — must not
      // delay startup — and the renderer's periodic refresh will just
      // pick up the result whenever it lands.
      accountIdentity.backfillLabels(rclone, accountLabels, remotes.map((r) => r.replace(/:$/, '')))
        .catch(() => {});
    } else {
      createWindow();
    }
  } catch (e) {
    createWindow();
    dialog.showErrorBox(
      'CloudMerge had trouble talking to rclone',
      `${e && e.message || e}\n\nThis usually means antivirus software is blocking ` +
      `resources/bin/rclone.exe, or it failed to run for another reason. You can still ` +
      `use this window; account connections may not work until that's resolved.`
    );
  }
  refreshTray();
});

app.on('window-all-closed', (e) => e.preventDefault()); // stay in tray

app.on('before-quit', async () => { await mountMgr.unmount(); });

// ---- IPC bridge for the renderer (onboarding / account manager UI) ----

ipcMain.handle('accounts:list', async () => rclone.listRemotes());

ipcMain.handle('providers:list', async () => rclone.PROVIDER_MAP);

ipcMain.handle('accounts:add', async (_evt, { name, provider, params }) => {
  const safeName = await rclone.addRemote(name, provider, params);
  await mountMgr.regenerateCombineRemote();
  if (!mountMgr.isMounted() && (await driverCheck.ensureDriverOrPrompt())) {
    await mountMgr.mount();
  }
  // Best-effort only: label lookup failing (offline, revoked scope, API
  // change) should never block the account from being added — the UI just
  // falls back to showing the technical remote name in that case.
  try {
    const identity = await accountIdentity.lookupIdentity(rclone, safeName, provider);
    if (identity) accountLabels.setLabel(safeName, identity);
  } catch (_) { /* cosmetic only */ }
  refreshTray();
  return safeName;
});

ipcMain.handle('accounts:remove', async (_evt, name) => {
  await rclone.removeRemote(name);
  accountLabels.removeLabel(name.replace(/:$/, ''));
  await mountMgr.regenerateCombineRemote();
  refreshTray();
});

ipcMain.handle('accounts:labels', async () => accountLabels.readAll());

ipcMain.handle('mount:open', async () => {
  const result = await shell.openPath(mountMgr.MOUNT_DIR);
  if (result) {
    dialog.showErrorBox('Could not open Cloud Folder', result);
  }
});

ipcMain.handle('mount:status', async () => ({
  mounted: mountMgr.isMounted(),
  mountDir: mountMgr.MOUNT_DIR,
}));
