export const VIDEO_PROVIDER_IDS = ['dreamina-cli', 'dreamina-agent', 'libtv-cli', 'xiaoyunque', 'updream', 'neowow', 'comfyui', 'video-api'];

export const VIDEO_PROVIDERS = {
  'dreamina-cli': {
    id: 'dreamina-cli',
    label: 'Dreamina CLI',
    pendingAccountKey: 'dreamina-cli',
  },
  'dreamina-agent': {
    id: 'dreamina-agent',
    label: '即梦 Agent',
    pendingAccountKey: 'dreamina-agent',
  },
  'libtv-cli': {
    id: 'libtv-cli',
    label: 'LibTV CLI',
    pendingAccountKey: 'libtv-cli',
  },
  xiaoyunque: {
    id: 'xiaoyunque',
    label: '小云雀',
    pendingAccountKey: 'xiaoyunque',
  },
  updream: {
    id: 'updream',
    label: 'UpDream',
    pendingAccountKey: 'updream',
  },
  neowow: {
    id: 'neowow',
    label: 'Neowow',
    pendingAccountKey: 'neowow',
  },
  comfyui: {
    id: 'comfyui',
    label: 'ComfyUI U09/U07',
    pendingAccountKey: 'comfyui',
  },
  'video-api': {
    id: 'video-api',
    label: '视频 API',
    pendingAccountKey: 'video-api',
  },
};

export function normalizeVideoProvider(provider, fallback = 'dreamina-cli') {
  const value = String(provider || '').trim();
  return VIDEO_PROVIDERS[value] ? value : fallback;
}

export function videoProviderLabel(provider) {
  return VIDEO_PROVIDERS[normalizeVideoProvider(provider)]?.label || VIDEO_PROVIDERS['dreamina-cli'].label;
}

export function isVideoProvider(provider) {
  return Boolean(VIDEO_PROVIDERS[String(provider || '').trim()]);
}
