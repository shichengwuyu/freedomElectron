// 登录窗口 preload：仅暴露账号和授权相关的安全接口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('license', {
  getMachineCode: () => ipcRenderer.invoke('license:getMachineCode'),
  // 透传界面上真实填写的凭据（此前这里写死了 freedom/freedom，等于绕过登录）。
  login: (credentials) => ipcRenderer.invoke('license:login', credentials || {}),
  register: (credentials) => ipcRenderer.invoke('license:register', credentials || {}),
  status: () => ipcRenderer.invoke('license:status'),
});

contextBridge.exposeInMainWorld('softwareUpdate', {
  getState: () => ipcRenderer.invoke('software-update:get-state'),
  check: () => ipcRenderer.invoke('software-update:check'),
  download: () => ipcRenderer.invoke('software-update:download'),
  install: () => ipcRenderer.invoke('software-update:install'),
  onState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('software-update:state', handler);
    return () => ipcRenderer.removeListener('software-update:state', handler);
  },
});
