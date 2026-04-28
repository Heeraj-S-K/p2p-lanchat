const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('roomServer', {
  start: (opts) => ipcRenderer.invoke('roomServer:start', opts),
  stop: () => ipcRenderer.invoke('roomServer:stop'),
  status: () => ipcRenderer.invoke('roomServer:status'),
});

contextBridge.exposeInMainWorld('discovery', {
  start: () => ipcRenderer.invoke('discovery:start'),
  stop: () => ipcRenderer.invoke('discovery:stop'),
  onFound: (callback) => ipcRenderer.on('discovery:found', (_evt, data) => callback(data)),
});

contextBridge.exposeInMainWorld('file', {
  save: (data) => ipcRenderer.invoke('file:save', data),
});

