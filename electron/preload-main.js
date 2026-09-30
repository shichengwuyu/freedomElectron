// 主工作台与 Electron 主进程之间的最小安全桥接。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopPetHost', {
  notifyTaskDone: (payload) => ipcRenderer.send('app:agent-notify', payload),
  chooseDirectory: (defaultPath) => ipcRenderer.invoke('app:choose-directory', defaultPath),
  chooseVideoFile: () => ipcRenderer.invoke('app:choose-video-file'),
  chooseVideoOutputDirectory: (defaultPath) => ipcRenderer.invoke('app:choose-video-output-directory', defaultPath),
  openExternalUrl: (url) => ipcRenderer.invoke('app:open-external-url', url),
  openStorageDirectory: (directory) => ipcRenderer.invoke('app:open-storage-directory', directory),
  openCanvasMediaFolder: (directory) => ipcRenderer.invoke('app:open-canvas-media-folder', directory),
  saveCanvasMedia: (payload) => ipcRenderer.invoke('app:save-canvas-media', payload),
  // 把本地视频文件作为 OS 级拖拽交给外部 App（如剪映）。渲染侧 dragstart 已先
  // preventDefault 取消 HTML5 拖拽，这里用异步 send 通知主进程调 webContents.startDrag。
  // 不能用 sendSync：原生拖拽是模态循环，渲染进程会被阻塞到拖拽结束；一旦主进程
  // startDrag 不返回（拖拽状态被 HTML5 拖拽抢占时就会），渲染进程便永久卡死。
  startFileDrag: (videoUrl) => ipcRenderer.send('app:start-file-drag', videoUrl),
  getLegalAgreement: () => ipcRenderer.sendSync('legal-agreement:get'),
  acceptLegalAgreement: (version) => ipcRenderer.sendSync('legal-agreement:accept', version),
  quitApp: () => ipcRenderer.send('app:quit'),
  restartApp: () => ipcRenderer.send('app:restart'),
  rendererReady: () => ipcRenderer.send('app:renderer-ready'),
  setTitleBarTheme: (theme) => ipcRenderer.send('app:set-titlebar-theme', theme),
  onOpenAgent: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = () => callback();
    ipcRenderer.on('app:open-agent', handler);
    return () => ipcRenderer.removeListener('app:open-agent', handler);
  },
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
