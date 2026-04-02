const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clawsurf', {
  // Window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),

  // Browser automation
  attachDebugger: (wcId) => ipcRenderer.invoke('browser:attach-debugger', wcId),
  execute: (wcId, method, params) => ipcRenderer.invoke('browser:execute', wcId, method, params),

  // High-level automation
  navigate: (wcId, url) => ipcRenderer.invoke('automation:navigate', wcId, url),
  click: (wcId, selector) => ipcRenderer.invoke('automation:click', wcId, selector),
  type: (wcId, selector, text) => ipcRenderer.invoke('automation:type', wcId, selector, text),
  screenshot: (wcId) => ipcRenderer.invoke('automation:screenshot', wcId),
  getHtml: (wcId, selector) => ipcRenderer.invoke('automation:get-html', wcId, selector),

  // Gateway
  gatewayStatus: () => ipcRenderer.invoke('gateway:status'),
});
