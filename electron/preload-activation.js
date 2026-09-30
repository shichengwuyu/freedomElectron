// 登录窗口 preload：仅暴露账号和授权相关的安全接口
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('license', {
  getMachineCode: () => ipcRenderer.invoke('license:getMachineCode'),
  login: () => ipcRenderer.invoke('license:login', { username: 'freedom', password: 'freedom', activationCode: '' }),
  redeem: () => ipcRenderer.invoke('license:redeem', { username: 'freedom', password: 'freedom', activationCode: 'FREEDOM' }),
  register: () => ipcRenderer.invoke('license:register', { username: 'freedom', password: 'freedom', activationCode: '' }),
  status: () => Promise.resolve({ ok: true, code: 'OK', error: '' }),
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
