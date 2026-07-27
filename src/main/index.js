'use strict';

const { app, Tray, Menu, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const AutoLaunch = require('auto-launch');
const rclone = require('./rclone');
const mountMgr = require('./mount');
const driverCheck = require('./driver-check');

let tray = null;
let win = null;

const autoLauncher = new AutoLaunch({ name: 'CloudMerge' });

function createWindow() {
  if (win) { win.show(); return; }
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
  tray = new Tray(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray.setToolTip('CloudMerge — all your cloud drives, one folder');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', createWindow);

  try {
    if (!(await autoLauncher.isEnabled())) await autoLauncher.enable();
  } catch (e) { /* non-fatal: auto-launch is a nicety, not a requirement */ }

  const remotes = await rclone.listRemotes();
  if (remotes.length > 0) {
    if (await driverCheck.ensureDriverOrPrompt()) {
      try { await mountMgr.mount(); } catch (e) { /* surfaced in UI on open */ }
    }
  } else {
    createWindow();
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
  refreshTray();
  return safeName;
});

ipcMain.handle('accounts:remove', async (_evt, name) => {
  await rclone.removeRemote(name);
  await mountMgr.regenerateCombineRemote();
  refreshTray();
});

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
