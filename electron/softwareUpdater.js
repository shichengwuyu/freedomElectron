const DEFAULT_STARTUP_DELAY_MS = 15 * 1000;
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Online software updates are intentionally disabled for this release.
// Keep the state/IPC surface so existing settings UIs remain compatible,
// but never initialize electron-updater or contact the publish endpoint.
const SOFTWARE_UPDATES_ENABLED = false;
const IPC_CHANNELS = Object.freeze({
  getState: 'software-update:get-state',
  check: 'software-update:check',
  download: 'software-update:download',
  install: 'software-update:install',
  state: 'software-update:state',
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedText(value, maxLength = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function releaseNotesText(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => boundedText(item?.note ?? item?.notes ?? item, 1500))
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
  }
  return boundedText(value, 4000);
}

function errorMessage(error) {
  return boundedText(error?.message || error || '更新服务暂时不可用。', 500);
}

export function isTrustedSoftwareUpdateUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.username || url.password) return false;
    if (url.protocol === 'http:') {
      return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    }
    return url.protocol === 'file:' && /\/electron\/activation\.html$/i.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

function updaterLogger(log) {
  const forward = (level, values) => {
    const method = typeof log?.[level] === 'function' ? level : (level === 'debug' ? 'info' : level);
    log?.[method]?.('software_update_engine', {
      detail: values.map((value) => errorMessage(value)).filter(Boolean).join(' '),
    });
  };
  return {
    debug: (...values) => forward('debug', values),
    info: (...values) => forward('info', values),
    warn: (...values) => forward('warn', values),
    error: (...values) => forward('error', values),
  };
}

export function createInitialSoftwareUpdateState(app) {
  const enabled = Boolean(app?.isPackaged && SOFTWARE_UPDATES_ENABLED);
  return {
    enabled,
    status: enabled ? 'idle' : 'disabled',
    currentVersion: boundedText(app?.getVersion?.() || '0.0.0', 64),
    targetVersion: '',
    releaseName: '',
    releaseDate: '',
    releaseNotes: '',
    updateAvailable: false,
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    checkedAt: '',
    downloadedAt: '',
    error: '',
  };
}

export function createSoftwareUpdater({
  app,
  updater,
  ipcMain,
  getWindows = () => [],
  beforeInstall = () => {},
  log = console,
  startupDelayMs = DEFAULT_STARTUP_DELAY_MS,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  installDelayMs = 120,
} = {}) {
  if (!app || !ipcMain) throw new Error('Software updater requires app and ipcMain.');

  let state = createInitialSoftwareUpdateState(app);
  let started = false;
  let startupTimer = null;
  let intervalTimer = null;
  let installTimer = null;
  let checkPromise = null;
  let downloadPromise = null;
  let installPromise = null;
  const updaterListeners = [];

  const snapshot = () => ({ ...state });
  const windows = () => {
    const values = getWindows?.();
    return Array.isArray(values) ? values.filter(Boolean) : [];
  };
  const allowedSender = (event) => windows().some((window) => {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    return !window?.isDestroyed?.()
      && sender === window.webContents
      && frame === sender?.mainFrame
      && isTrustedSoftwareUpdateUrl(frame?.url || sender?.getURL?.());
  });
  const broadcast = () => {
    const value = snapshot();
    for (const window of windows()) {
      if (window?.isDestroyed?.() || window?.webContents?.isDestroyed?.()) continue;
      try {
        window.webContents.send(IPC_CHANNELS.state, value);
      } catch (error) {
        log.warn?.('software_update_state_delivery_failed', { message: errorMessage(error) });
      }
    }
  };
  const setState = (patch) => {
    state = { ...state, ...patch };
    broadcast();
    return snapshot();
  };
  const addUpdaterListener = (event, handler) => {
    updater.on(event, handler);
    updaterListeners.push([event, handler]);
  };

  function assertAllowed(event) {
    if (!allowedSender(event)) throw new Error('Software update request was rejected.');
  }

  async function checkForUpdates() {
    if (!state.enabled) return snapshot();
    if (checkPromise) return checkPromise;
    if (downloadPromise || installPromise || ['downloading', 'downloaded', 'installing'].includes(state.status)) return snapshot();

    checkPromise = (async () => {
      setState({ status: 'checking', error: '' });
      try {
        await updater.checkForUpdates();
      } catch (error) {
        log.warn?.('software_update_check_failed', { message: errorMessage(error) });
        setState({ status: 'error', checkedAt: new Date().toISOString(), error: errorMessage(error) });
      }
      return snapshot();
    })();
    try {
      return await checkPromise;
    } finally {
      checkPromise = null;
    }
  }

  async function downloadUpdate() {
    if (!state.enabled) return snapshot();
    if (downloadPromise) return downloadPromise;
    if (state.status === 'downloaded') return snapshot();
    if (!state.updateAvailable) throw new Error('当前没有可下载的新版本。');

    downloadPromise = (async () => {
      setState({ status: 'downloading', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: '' });
      try {
        await updater.downloadUpdate();
      } catch (error) {
        log.warn?.('software_update_download_failed', { message: errorMessage(error) });
        setState({ status: 'error', error: errorMessage(error) });
      }
      return snapshot();
    })();
    try {
      return await downloadPromise;
    } finally {
      downloadPromise = null;
    }
  }

  async function installUpdate() {
    if (!state.enabled) return snapshot();
    if (installPromise) return installPromise;
    if (state.status !== 'downloaded') throw new Error('更新尚未下载完成。');

    installPromise = (async () => {
      try {
        await beforeInstall();
        setState({ status: 'installing', error: '' });
        installTimer = setTimeout(() => {
          installTimer = null;
          try {
            updater.quitAndInstall(true, true);
          } catch (error) {
            log.error?.('software_update_install_failed', { message: errorMessage(error) });
            installPromise = null;
            setState({ status: 'error', error: errorMessage(error) });
          }
        }, Math.max(0, finiteNumber(installDelayMs)));
      } catch (error) {
        installPromise = null;
        setState({ status: 'error', error: errorMessage(error) });
      }
      return snapshot();
    })();
    return installPromise;
  }

  function registerUpdaterEvents() {
    addUpdaterListener('checking-for-update', () => {
      setState({ status: 'checking', error: '' });
    });
    addUpdaterListener('update-available', (info = {}) => {
      setState({
        status: 'available',
        targetVersion: boundedText(info.version, 64),
        releaseName: boundedText(info.releaseName, 160),
        releaseDate: boundedText(info.releaseDate, 80),
        releaseNotes: releaseNotesText(info.releaseNotes),
        updateAvailable: true,
        checkedAt: new Date().toISOString(),
        percent: 0,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
        error: '',
      });
    });
    addUpdaterListener('update-not-available', (info = {}) => {
      setState({
        status: 'up-to-date',
        targetVersion: boundedText(info.version || state.currentVersion, 64),
        releaseName: '',
        releaseDate: '',
        releaseNotes: '',
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
        percent: 0,
        transferred: 0,
        total: 0,
        bytesPerSecond: 0,
        error: '',
      });
    });
    addUpdaterListener('download-progress', (progress = {}) => {
      setState({
        status: 'downloading',
        percent: Math.max(0, Math.min(100, finiteNumber(progress.percent))),
        transferred: Math.max(0, finiteNumber(progress.transferred)),
        total: Math.max(0, finiteNumber(progress.total)),
        bytesPerSecond: Math.max(0, finiteNumber(progress.bytesPerSecond)),
        error: '',
      });
    });
    addUpdaterListener('update-downloaded', (info = {}) => {
      setState({
        status: 'downloaded',
        targetVersion: boundedText(info.version || state.targetVersion, 64),
        releaseName: boundedText(info.releaseName || state.releaseName, 160),
        releaseDate: boundedText(info.releaseDate || state.releaseDate, 80),
        releaseNotes: releaseNotesText(info.releaseNotes) || state.releaseNotes,
        updateAvailable: true,
        percent: 100,
        transferred: state.total || state.transferred,
        downloadedAt: new Date().toISOString(),
        error: '',
      });
    });
    addUpdaterListener('error', (error) => {
      log.warn?.('software_update_error', { message: errorMessage(error) });
      setState({ status: 'error', error: errorMessage(error) });
    });
  }

  function registerIpc() {
    ipcMain.handle(IPC_CHANNELS.getState, (event) => {
      assertAllowed(event);
      return snapshot();
    });
    ipcMain.handle(IPC_CHANNELS.check, async (event) => {
      assertAllowed(event);
      return checkForUpdates();
    });
    ipcMain.handle(IPC_CHANNELS.download, async (event) => {
      assertAllowed(event);
      return downloadUpdate();
    });
    ipcMain.handle(IPC_CHANNELS.install, async (event) => {
      assertAllowed(event);
      return installUpdate();
    });
  }

  function start() {
    if (started) return snapshot();
    started = true;
    registerIpc();
    if (!state.enabled) return snapshot();
    if (!updater) throw new Error('Packaged software updater requires electron-updater.');

    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    if ('disableWebInstaller' in updater) updater.disableWebInstaller = true;
    updater.logger = updaterLogger(log);
    registerUpdaterEvents();

    startupTimer = setTimeout(() => {
      startupTimer = null;
      void checkForUpdates();
    }, Math.max(0, finiteNumber(startupDelayMs, DEFAULT_STARTUP_DELAY_MS)));
    startupTimer.unref?.();
    intervalTimer = setInterval(() => {
      void checkForUpdates();
    }, Math.max(60 * 1000, finiteNumber(checkIntervalMs, DEFAULT_CHECK_INTERVAL_MS)));
    intervalTimer.unref?.();
    return snapshot();
  }

  function stop() {
    if (startupTimer) clearTimeout(startupTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    if (installTimer) clearTimeout(installTimer);
    startupTimer = null;
    intervalTimer = null;
    installTimer = null;
    for (const [event, handler] of updaterListeners.splice(0)) updater?.removeListener?.(event, handler);
    for (const channel of [IPC_CHANNELS.getState, IPC_CHANNELS.check, IPC_CHANNELS.download, IPC_CHANNELS.install]) {
      ipcMain.removeHandler?.(channel);
    }
    started = false;
  }

  return {
    start,
    stop,
    getState: snapshot,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}

export { DEFAULT_CHECK_INTERVAL_MS, DEFAULT_STARTUP_DELAY_MS, IPC_CHANNELS, SOFTWARE_UPDATES_ENABLED };
