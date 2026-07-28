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

/**
 * Tell the user if regenerateCombineRemote() had to leave an account out of
 * the combined folder because its own config was incomplete (currently only
 * possible for a OneDrive account that never got a drive_id/drive_type
 * recorded — see rclone.isRemoteConfigComplete). Without this, that account
 * would just be silently missing from the folder with no explanation, which
 * is exactly the kind of "invisible failure" this app keeps running into —
 * the whole point of excluding it (rather than letting it crash the entire
 * mount, as previously happened) is so this can be a small, specific, non-
 * fatal warning instead of a total connection failure.
 */
function warnAboutSkippedRemotes() {
  const skipped = mountMgr.getSkippedRemotes();
  if (skipped.length === 0) return;
  dialog.showErrorBox(
    'One of your accounts needs attention',
    `${skipped.join(', ')} couldn't be included in your Cloud Folder because its setup ` +
    `never finished properly — this can happen with OneDrive accounts. Your other ` +
    `accounts are working normally. To fix it, remove this account in Manage Accounts ` +
    `and add it again.`
  );
}

let backfillInFlight = false;

/**
 * Look up friendly names for any connected account that doesn't have one
 * yet, and refresh the mounted folder if any were newly found.
 *
 * A single failed lookup (offline at the moment, a rate-limited API call,
 * a revoked scope) used to mean that account's folder was stuck showing
 * its technical remote name until CloudMerge was restarted — the only
 * other place this ran was once, at startup. Called again periodically
 * below so a transient failure gets other chances to resolve on its own
 * during a long-running session, not just at the next restart.
 */
async function runLabelBackfill() {
  if (backfillInFlight) return; // don't overlap if a previous run is still in progress
  backfillInFlight = true;
  try {
    const remotes = await rclone.listRemotes();
    const names = remotes.map((r) => r.replace(/:$/, '')).filter((r) => r !== 'merged');
    const existing = accountLabels.readAll();
    if (!names.some((n) => !existing[n])) return; // everything already has a label

    await accountIdentity.backfillLabels(rclone, accountLabels, names);
    if (mountMgr.isMounted()) {
      await mountMgr.regenerateCombineRemote();
      await mountMgr.remount();
    }
  } catch (_) {
    // Best-effort — next periodic attempt (or the next add/remove/restart)
    // will just try again.
  } finally {
    backfillInFlight = false;
  }
}

// Retry unlabeled accounts periodically while CloudMerge is running, not
// just once at startup — a transient failure (offline, rate-limited,
// briefly-revoked scope) would otherwise leave that account's folder
// stuck on its technical name for the rest of the session.
setInterval(() => { runLabelBackfill().catch(() => {}); }, 3 * 60 * 1000);

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
          warnAboutSkippedRemotes();
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
      runLabelBackfill();
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

// A user report ("CloudMerge leaves processes running in Task Manager after
// I Quit it") traced back to this handler: Electron's 'before-quit' listener
// is synchronous (event: Event) => void — per Electron's own docs, calling
// event.preventDefault() is the ONLY way to delay quitting; a returned
// promise is simply ignored. The previous `async () => { await
// mountMgr.unmount(); }` looked like it would wait for the rclone mount
// process to be killed before the app exited, but Electron never actually
// awaited it: it proceeded to tear down and exit the whole app immediately,
// racing against (and usually winning against) unmount()'s kill() + up-to-
// 5s wait — leaving the child rclone.exe mount process orphaned in Task
// Manager every time "Quit CloudMerge" was used, not just occasionally.
//
// The fix is Electron's own documented pattern for async cleanup on quit:
// prevent the default the FIRST time this fires, do the async cleanup, then
// call app.quit() again ourselves once it's done — that second call re-fires
// this same listener, so a flag lets it fall through and actually quit.
let quitCleanupDone = false;
app.on('before-quit', (e) => {
  if (quitCleanupDone) return;
  e.preventDefault();
  mountMgr.unmount()
    .catch(() => {}) // best-effort — a cleanup hiccup shouldn't block quitting outright
    .finally(() => {
      quitCleanupDone = true;
      app.quit();
    });
});

// ---- IPC bridge for the renderer (onboarding / account manager UI) ----

ipcMain.handle('accounts:list', async () => rclone.listRemotes());

ipcMain.handle('providers:list', async () => rclone.PROVIDER_MAP);

ipcMain.handle('accounts:add', async (_evt, { name, provider, params }) => {
  const safeName = await rclone.addRemote(name, provider, params);
  // Always remount (not just "mount if not already mounted"): rclone's
  // `combine` backend only reads its upstream list once, at mount start, so
  // a live mount doesn't pick up a newly-added account on its own — it has
  // to be torn down and re-established. This is also why previously only
  // the *first* connected account ever actually showed up in the folder.
  //
  // Wrapped in try/catch (previously unguarded, and previously
  // regenerateCombineRemote() itself ran outside this try entirely): a
  // hiccup anywhere in here — including regenerating the combine config, not
  // just the remount that follows it — is a separate, non-fatal problem
  // from "was the account added" — the account above was already added
  // successfully. Letting a failure here throw out of this whole handler
  // used to skip the friendly-name lookup below entirely and made the
  // renderer wrongly report "Could not add account" for an account that, in
  // fact, had been added.
  try {
    await mountMgr.regenerateCombineRemote();
    if (await driverCheck.ensureDriverOrPrompt()) {
      await mountMgr.remount();
      warnAboutSkippedRemotes();
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
  // Same reasoning as accounts:add above: refresh the live mount so a
  // removed account's folder actually disappears, and don't let a hiccup in
  // regenerating the combine config or remounting mask the fact that the
  // account itself was removed successfully.
  try {
    await mountMgr.regenerateCombineRemote();
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
  // Check first rather than always trying: every account add/remove briefly
  // tears down and re-creates MOUNT_DIR while remounting (see mount.js), and
  // if the folder isn't mounted at all, opening it can surface Windows' own
  // native "Windows cannot find ... Make sure you typed the name correctly"
  // dialog — confusing on its own, since it looks like a typo rather than
  // "the folder isn't connected right now."
  // Check both that the rclone process is alive AND that the folder is
  // actually populated (isMountFolderReady()) rather than isMounted() alone
  // — a process can stay running without the mount ever having genuinely
  // attached (see mount.js's isMountFolderReady() comment), which is what
  // previously let this handler call shell.openPath() on a path Windows
  // itself couldn't find, surfacing its own confusing native error dialog
  // instead of this clearer one.
  if (!mountMgr.isMounted() || !mountMgr.isMountFolderReady()) {
    dialog.showErrorBox(
      'Cloud folder isn\'t connected right now',
      'This can happen briefly while an account is being added or removed — try again in ' +
      'a few seconds. If it keeps happening, check Manage Accounts for a connection error, ' +
      'or try restarting CloudMerge.'
    );
    return;
  }
  const result = await shell.openPath(mountMgr.MOUNT_DIR);
  if (result) {
    dialog.showErrorBox('Could not open Cloud Folder', result);
  }
});

ipcMain.handle('mount:status', async () => ({
  mounted: mountMgr.isMounted(),
  mountDir: mountMgr.MOUNT_DIR,
}));
