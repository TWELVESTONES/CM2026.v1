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

function providerLabel(remoteName) {
  if (remoteName.startsWith('gdrive') || remoteName.startsWith('google_drive') || remoteName.includes('google')) return 'Google Drive';
  if (remoteName.startsWith('onedrive')) return 'OneDrive';
  if (remoteName.startsWith('dropbox')) return 'Dropbox';
  if (remoteName.startsWith('wd_cloud')) return 'WD Cloud / NAS';
  return 'Cloud account';
}

async function refreshAccountList() {
  const remotes = (await window.cloudmerge.listAccounts())
    .map((r) => r.replace(/:$/, ''))
    .filter((r) => r !== 'merged');

  listEl.innerHTML = '';
  emptyStateEl.style.display = remotes.length === 0 ? 'block' : 'none';

  for (const name of remotes) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${providerLabel(name)} — ${name}`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = async () => {
      removeBtn.disabled = true;
      await window.cloudmerge.removeAccount(name + ':');
      await refreshAccountList();
    };
    li.appendChild(label);
    li.appendChild(removeBtn);
    listEl.appendChild(li);
  }

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
  bannerEl.textContent = 'Opening browser sign-in — finish there, then return here…';
  try {
    await window.cloudmerge.addAccount(name, provider);
    bannerEl.textContent = 'Account added.';
  } catch (e) {
    bannerEl.textContent = `Could not add account: ${e.message || e}`;
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
  bannerEl.textContent = 'Connecting…';
  try {
    await window.cloudmerge.addAccount(name, activeManualProvider, params);
    bannerEl.textContent = 'Connected.';
    closeSmbForm();
  } catch (e2) {
    bannerEl.textContent = `Could not connect: ${e2.message || e2}`;
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
