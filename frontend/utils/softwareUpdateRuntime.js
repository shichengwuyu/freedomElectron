const STATE_KEYS = [
  'enabled',
  'status',
  'currentVersion',
  'targetVersion',
  'releaseName',
  'releaseDate',
  'releaseNotes',
  'updateAvailable',
  'percent',
  'transferred',
  'total',
  'bytesPerSecond',
  'checkedAt',
  'downloadedAt',
  'error',
];

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const amount = bytes / (1024 ** index);
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function createSoftwareUpdateRuntime({
  reactive,
  computed,
  onMounted,
  host,
  message,
  messageBox,
  windowObject,
} = {}) {
  const softwareUpdate = reactive({
    enabled: false,
    status: 'disabled',
    currentVersion: '0.0.0',
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
  });
  let previousStatus = softwareUpdate.status;
  let unsubscribe = null;
  let offeredVersion = '';
  let offerOpen = false;

  async function offerSoftwareUpdateDownload() {
    const version = String(softwareUpdate.targetVersion || '新版本');
    if (!messageBox?.confirm || offerOpen || offeredVersion === version || softwareUpdate.status !== 'available') return;
    offeredVersion = version;
    offerOpen = true;
    try {
      await messageBox.confirm(
        `发现Freedom ${version}，是否现在下载？`,
        '发现新版本',
        {
          confirmButtonText: '立即下载',
          cancelButtonText: '稍后',
          type: 'info',
        },
      );
    } catch {
      return;
    } finally {
      offerOpen = false;
    }
    if (softwareUpdate.status === 'available' && String(softwareUpdate.targetVersion || '新版本') === version) {
      await downloadSoftwareUpdate();
    }
  }

  function applyState(next, notify = false) {
    if (!next || typeof next !== 'object') return;
    const prior = previousStatus;
    for (const key of STATE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(next, key)) softwareUpdate[key] = next[key];
    }
    previousStatus = softwareUpdate.status;
    if (!notify || prior === softwareUpdate.status) return;
    if (softwareUpdate.status === 'available') {
      message?.info?.(`发现Freedom ${softwareUpdate.targetVersion || '新版本'}`);
      void offerSoftwareUpdateDownload();
    } else if (softwareUpdate.status === 'downloaded') {
      message?.success?.('更新已下载，可以重启安装。');
    }
  }

  async function invoke(action) {
    if (!host?.[action]) throw new Error('当前环境不支持软件更新。');
    try {
      const next = await host[action]();
      applyState(next);
      return next;
    } catch (error) {
      message?.error?.(error?.message || '更新操作失败。');
      return null;
    }
  }

  async function checkSoftwareUpdate() {
    const next = await invoke('check');
    if (next?.status === 'up-to-date') message?.success?.('当前已经是最新版本。');
  }

  async function downloadSoftwareUpdate() {
    await invoke('download');
  }

  async function installSoftwareUpdate() {
    if (messageBox?.confirm) {
      try {
        await messageBox.confirm(
          'Freedom将关闭并安装已经下载的新版本。',
          '重启并更新',
          {
            confirmButtonText: '立即重启',
            cancelButtonText: '稍后',
            type: 'warning',
          },
        );
      } catch {
        return;
      }
    }
    await invoke('install');
  }

  const softwareUpdateBusy = computed(() => (
    ['checking', 'downloading', 'installing'].includes(softwareUpdate.status)
  ));
  const softwareUpdateCanDownload = computed(() => (
    softwareUpdate.enabled
    && softwareUpdate.updateAvailable
    && ['available', 'error'].includes(softwareUpdate.status)
  ));
  const softwareUpdateCanInstall = computed(() => softwareUpdate.status === 'downloaded');
  const softwareUpdateStatusText = computed(() => {
    const version = softwareUpdate.targetVersion ? ` ${softwareUpdate.targetVersion}` : '';
    return {
      idle: '在线更新已关闭',
      disabled: '在线更新已关闭',
      checking: '正在检查更新',
      available: `发现新版本${version}`,
      downloading: `正在下载 ${Math.round(Number(softwareUpdate.percent) || 0)}%`,
      downloaded: `版本${version}已就绪`,
      'up-to-date': '当前已是最新版本',
      installing: '正在重启安装',
      error: '更新暂时不可用',
    }[softwareUpdate.status] || '等待检查';
  });
  const softwareUpdateStatusType = computed(() => ({
    available: 'warning',
    downloading: 'primary',
    downloaded: 'success',
    'up-to-date': 'success',
    error: 'danger',
  }[softwareUpdate.status] || 'info'));
  const softwareUpdateProgressText = computed(() => {
    if (softwareUpdate.status !== 'downloading') return '';
    const amount = `${formatBytes(softwareUpdate.transferred)} / ${formatBytes(softwareUpdate.total)}`;
    const speed = softwareUpdate.bytesPerSecond > 0 ? ` · ${formatBytes(softwareUpdate.bytesPerSecond)}/s` : '';
    return `${amount}${speed}`;
  });

  onMounted(async () => {
    if (!host) return;
    unsubscribe = host.onState?.((next) => applyState(next, true)) || null;
    try {
      applyState(await host.getState?.());
      if (softwareUpdate.status === 'available') void offerSoftwareUpdateDownload();
    } catch (error) {
      softwareUpdate.error = error?.message || '无法读取更新状态。';
      softwareUpdate.status = 'error';
    }
    windowObject?.addEventListener?.('beforeunload', () => unsubscribe?.(), { once: true });
  });

  return {
    softwareUpdate,
    softwareUpdateBusy,
    softwareUpdateCanDownload,
    softwareUpdateCanInstall,
    softwareUpdateStatusText,
    softwareUpdateStatusType,
    softwareUpdateProgressText,
    checkSoftwareUpdate,
    downloadSoftwareUpdate,
    installSoftwareUpdate,
  };
}

export { formatBytes };
