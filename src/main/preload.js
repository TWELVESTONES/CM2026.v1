'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cloudmerge', {
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  listAccountLabels: () => ipcRenderer.invoke('accounts:labels'),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  addAccount: (name, provider, params) => ipcRenderer.invoke('accounts:add', { name, provider, params }),
  removeAccount: (name) => ipcRenderer.invoke('accounts:remove', name),
  openMountFolder: () => ipcRenderer.invoke('mount:open'),
  mountStatus: () => ipcRenderer.invoke('mount:status'),
});
