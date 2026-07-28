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
        try {
          await mountMgr.mount();
        } catch (e) {
          // This used to be swallowed with a comment claiming the error was
          // "surfaced in UI on open" — nothing actually did that, so a mount
          // failure here (e.g. the Windows directory-mount bug fixed in this
          // release) was completely invisible: accounts looked "connected"
          // in the list, but the folder just stayed empty forever with no
          // explanation.
          dialog.showErrorBox(
            'CloudMerge could not connect your cloud folder',
            `${e && e.message || e}\n\nYour accounts are still connected — try Manage Accounts, ` +
            `or restart CloudMerge, to retry connecting the folder.`
          );
        }
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
  // Always remount (not just "mount if not already mounted"): rclone's
  // `combine` backend only reads its upstream list once, at mount start, so
  // a live mount doesn't pick up a newly-added account on its own — it has
  // to be torn down and re-established. This is also why previously only
  // the *first* connected account ever actually showed up in the folder.
  //
  // Wrapped in try/catch (previously unguarded): a mount hiccup here is a
  // separate, non-fatal problem from "was the account added" — the account
  // above was already added successfully. Letting a mount failure throw out
  // of this whole handler used to skip the friendly-name lookup below
  // entirely and made the renderer wrongly report "Could not add account"
  // for an account that, in fact, had been added.
  try {
    if (await driverCheck.ensureDriverOrPrompt()) {
      await mountMgr.remount();
    }
  } catch (e) {
    dialog.showErrorBox(
      'CloudMerge added the account but could not refresh the connected folder',
      `${e && e.message || e}\n\nThe account was added successfully — try Manage Accounts, ` +
      `or restart CloudMerge, to retry connecting the folder.`
    );
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
  // Same reasoning as accounts:add above: refresh the live mount so a
  // removed account's folder actually disappears, and don't let a mount
  // hiccup mask the fact that the account itself was removed successfully.
  try {
    if (mountMgr.isMounted()) await mountMgr.remount();
  } catch (e) {
    dialog.showErrorBox(
      'CloudMerge removed the account but could not refresh the connected folder',
      `${e && e.message || e}\n\nThe account was removed successfully — try restarting ` +
      `CloudMerge to retry connecting the folder.`
    );
  }
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
