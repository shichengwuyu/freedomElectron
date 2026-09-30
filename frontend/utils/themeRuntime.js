export const THEME_STORAGE_KEY = 'yanzhi-ui-theme';
export const UI_SCALE_STORAGE_KEY = 'yanzhi-ui-scale';

export const themeOptions = [
  { value: 'dark', label: '深色', icon: 'Moon', swatches: ['#2c2c2c', '#3f7fd8', '#57b894'] },
  { value: 'light', label: '浅色', icon: 'Sunny', swatches: ['#fbfbfb', '#4a8fe0', '#2f9e79'] },
  { value: 'system', label: '跟随系统', icon: 'Monitor', swatches: ['#fbfbfb', '#9a9a9a', '#2c2c2c'] },
];

const THEME_VALUES = new Set(themeOptions.map((item) => item.value));

export function normalizeThemePreference(value, fallback = 'dark') {
  const normalized = String(value || '').trim().toLowerCase();
  return THEME_VALUES.has(normalized) ? normalized : fallback;
}

export function readStoredThemePreference(storage) {
  try {
    return normalizeThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

export function resolveThemePreference(preference, prefersDark = false) {
  const normalized = normalizeThemePreference(preference);
  return normalized === 'system' ? (prefersDark ? 'dark' : 'light') : normalized;
}

export function normalizeUiScale(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(1.5, Math.max(.85, numeric)) * 20) / 20;
}

export function readStoredUiScale(storage) {
  try {
    return normalizeUiScale(storage?.getItem(UI_SCALE_STORAGE_KEY));
  } catch {
    return 1;
  }
}

export function createThemeRuntime({ ref, computed, watch, globals = {} } = {}) {
  const windowObject = globals.window || window;
  const documentObject = globals.document || document;
  const storage = globals.storage || windowObject.localStorage;
  const mediaQuery = windowObject.matchMedia?.('(prefers-color-scheme: dark)') || null;
  const themePreference = ref(readStoredThemePreference(storage));
  const resolvedTheme = ref(resolveThemePreference(themePreference.value, mediaQuery?.matches));
  const uiScale = ref(readStoredUiScale(storage));

  const applyTheme = () => {
    const preference = normalizeThemePreference(themePreference.value);
    const resolved = resolveThemePreference(preference, mediaQuery?.matches);
    if (themePreference.value !== preference) themePreference.value = preference;
    resolvedTheme.value = resolved;
    documentObject.documentElement.dataset.theme = resolved;
    documentObject.documentElement.dataset.themePreference = preference;
    documentObject.documentElement.style.colorScheme = ['dark', 'violet', 'neon-rose', 'black-pink', 'forest-gold', 'plum-teal'].includes(resolved) ? 'dark' : 'light';
    windowObject.desktopPetHost?.setTitleBarTheme?.(resolved);
    try {
      storage?.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Theme changes still apply when storage is unavailable.
    }
  };

  const setThemePreference = (value) => {
    themePreference.value = normalizeThemePreference(value);
  };
  const applyUiScale = () => {
    const normalized = normalizeUiScale(uiScale.value);
    if (uiScale.value !== normalized) uiScale.value = normalized;
    documentObject.documentElement.style.setProperty('--ui-scale', String(normalized));
    documentObject.documentElement.dataset.uiScale = String(Math.round(normalized * 100));
    try {
      storage?.setItem(UI_SCALE_STORAGE_KEY, String(normalized));
    } catch {
      // Interface scale still applies when storage is unavailable.
    }
  };
  const setUiScale = (value) => {
    uiScale.value = normalizeUiScale(value);
  };
  const uiScalePercent = computed(() => Math.round(normalizeUiScale(uiScale.value) * 100));
  const themePreferenceLabel = computed(() => (
    themeOptions.find((item) => item.value === themePreference.value)?.label || '深色'
  ));
  const themeIcon = computed(() => {
    if (themePreference.value === 'system') return 'Monitor';
    return themeOptions.find((item) => item.value === themePreference.value)?.icon || 'Moon';
  });

  watch(themePreference, applyTheme, { immediate: true });
  watch(uiScale, applyUiScale, { immediate: true });
  if (mediaQuery?.addEventListener) mediaQuery.addEventListener('change', applyTheme);
  else if (mediaQuery?.addListener) mediaQuery.addListener(applyTheme);

  return {
    themeOptions,
    themePreference,
    themePreferenceLabel,
    resolvedTheme,
    themeIcon,
    setThemePreference,
    uiScale,
    uiScalePercent,
    setUiScale,
  };
}
