import { createAppSettingsRuntime } from '../utils/settingsConfig.js';

export function createSettingsRuntimeForApp({
  api,
  message,
  refs,
  helpers,
  options,
  vue,
}) {
  const { reactive, ref, computed, nextTick, watch } = vue;

  return createAppSettingsRuntime({
    api,
    message,
    refs,
    helpers: {
      ...helpers,
      nextTick,
      warn: (...args) => console.warn(...args),
    },
    options,
    reactive,
    ref,
    computed,
    watch,
  });
}
