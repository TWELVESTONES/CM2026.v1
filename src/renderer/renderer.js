'use strict';

const listEl = document.getElementById('account-list');
const emptyStateEl = document.getElementById('empty-state');
const bannerEl = document.getElementById('status-banner');
const openFolderBtn = document.getElementById('open-folder-btn');
const smbForm = document.getElementById('smb-form');
const smbFormTitle = document.getElementById('smb-form-title');
const smbCancelBtn = document.getElementById('smb-cancel-btn');

let providers = {};
let activeManualProvider = null;

// refreshAccountList() below unconditionally overwrites bannerEl with the
// current connection status ("Connected — ...", "Connecting…", or blank) —
// which used to instantly clobber any message an action had just set (e.g.
// "Could not add account: ..."), since both addAccount() and the smb form's
// submit handler call refreshAccountList() from their own `finally` block
// right after setting that message, and a 4-second poll (see the bottom of
// this file) does the same on top of that. A user report of an add-account
// error appearing and "then disappearing" too fast to read traced back to
// exactly this — the message was real and correct, just visible for under a
// second. bannerStickyUntil gives an explicitly-set message a window to
// actually be read before status polling is allowed to overwrite it again.
let bannerStickyUntil = 0;
function setBanner(text, stickyMs = 6000) {
  bannerEl.textContent = text;
  bannerStickyUntil = Date.now() + stickyMs;
}

function providerLabel(remoteName) {
  if (remoteName.startsWith('gdrive') || remoteName.startsWith('google_drive') || remoteName.includes('google')) return 'Google Drive';
  if (remoteName.startsWith('onedrive')) return 'OneDrive';
  if (remoteName.startsWith('dropbox')) return 'Dropbox';
  if (remoteName.startsWith('wd_cloud')) return 'WD Cloud / NAS';
  return 'Cloud account';
}

async function refreshAccountList() {
  const [remotesRaw, labels] = await Promise.all([
    window.cloudmerge.listAccounts(),
    window.cloudmerge.listAccountLabels(),
  ]);
  const remotes = remotesRaw
    .map((r) => r.replace(/:$/, ''))
    .filter((r) => r !== 'merged');

  listEl.innerHTML = '';
  emptyStateEl.style.display = remotes.length === 0 ? 'block' : 'none';

  for (const name of remotes) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    // Prefer the looked-up account identity (e.g. an email address) when
    // we have one; fall back to the internal rclone remote name otherwise
    // — that lookup is best-effort and may not always succeed.
    label.textContent = `${providerLabel(name)} — ${labels[name] || name}`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = async () => {
      removeBtn.disabled = true;
      // `name` here is already the bare remote name (colon stripped above
      // for display) — pass it through as-is. rclone's `config delete`
      // operates on the config section name, which never has a trailing
      // colon; passing one silently no-ops (exit code 0, remote untouched)
      // instead of erroring, which is what made this look like Remove
      // just didn't do anything.
      await window.cloudmerge.removeAccount(name);
      await refreshAccountList();
    };
    li.appendChild(label);
    li.appendChild(removeBtn);
    listEl.appendChild(li);
  }

  if (Date.now() < bannerStickyUntil) return; // a just-set message is still on screen — don't stomp on it
  const status = await window.cloudmerge.mountStatus();
  bannerEl.textContent = status.mounted
    ? `Connected — everything is available at ${status.mountDir}`
    : (remotes.length ? 'Connecting…' : '');
}

function closeSmbForm() {
  smbForm.hidden = true;
  smbForm.reset();
  activeManualProvider = null;
  document.querySelectorAll('.provider-btn').forEach((b) => b.classList.remove('active'));
}

async function addAccount(provider, btn) {
  const name = `${provider}-${Date.now().toString(36)}`;
  btn.disabled = true;
  setBanner('Opening browser sign-in — finish there, then return here…');
  try {
    await window.cloudmerge.addAccount(name, provider);
    setBanner('Account added.');
  } catch (e) {
    // The main process now also shows this same text in a dialog box (see
    // index.js's accounts:add handler) that stays up until dismissed, so
    // even if this banner's sticky window elapses before it's read, the
    // dialog is the reliable way to actually see it.
    setBanner(`Could not add account: ${e.message || e}`);
  } finally {
    btn.disabled = false;
    await refreshAccountList();
  }
}

document.querySelectorAll('.provider-btn').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const provider = btn.dataset.provider;
    const meta = providers[provider];

    if (meta && meta.auth === 'manual') {
      // Toggle the connection form for this manual (non-OAuth) provider
      // instead of firing a browser sign-in.
      if (activeManualProvider === provider && !smbForm.hidden) {
        closeSmbForm();
        return;
      }
      document.querySelectorAll('.provider-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeManualProvider = provider;
      smbFormTitle.textContent = `Connect: ${btn.textContent.replace('+ ', '')}`;
      smbForm.hidden = false;
      smbForm.querySelector('input[name="host"]').focus();
      return;
    }

    await addAccount(provider, btn);
  });
});

smbForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeManualProvider) return;
  const connectBtn = document.getElementById('smb-connect-btn');
  const formData = new FormData(smbForm);
  const params = Object.fromEntries(formData.entries());
  const name = `${activeManualProvider}-${Date.now().toString(36)}`;

  connectBtn.disabled = true;
  setBanner('Connecting…');
  try {
    await window.cloudmerge.addAccount(name, activeManualProvider, params);
    setBanner('Connected.');
    closeSmbForm();
  } catch (e2) {
    setBanner(`Could not connect: ${e2.message || e2}`);
  } finally {
    connectBtn.disabled = false;
    await refreshAccountList();
  }
});

smbCancelBtn.addEventListener('click', closeSmbForm);

openFolderBtn.addEventListener('click', () => window.cloudmerge.openMountFolder());

const aboutDialog = document.getElementById('about-dialog');
document.getElementById('about-btn').addEventListener('click', () => aboutDialog.showModal());
document.getElementById('close-about-btn').addEventListener('click', () => aboutDialog.close());

(async () => {
  providers = await window.cloudmerge.listProviders();
  await refreshAccountList();
})();
setInterval(refreshAccountList, 4000);
