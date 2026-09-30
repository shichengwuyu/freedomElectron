export const LIBTV_VIDEO_MODEL_NAMES = Object.freeze([
  'Seedance 2.0 VIP',
  'Seedance 2.0 Fast VIP',
  'Seedance 2.0 Mini',
  'Seedance 2.5',
  'Minimax H3',
  'Wan 3.0',
  'Wan 3.0 Prime',
]);

export const DEFAULT_LIBTV_VIDEO_MODEL = LIBTV_VIDEO_MODEL_NAMES[0];

const LIBTV_VIDEO_MODEL_SET = new Set(LIBTV_VIDEO_MODEL_NAMES);

export function normalizeLibtvVideoModelName(value, fallback = DEFAULT_LIBTV_VIDEO_MODEL) {
  const model = String(value || '').trim();
  if (model === 'Seedance 2.0') return DEFAULT_LIBTV_VIDEO_MODEL;
  if (LIBTV_VIDEO_MODEL_SET.has(model)) return model;
  const normalizedFallback = String(fallback || '').trim();
  return LIBTV_VIDEO_MODEL_SET.has(normalizedFallback)
    ? normalizedFallback
    : DEFAULT_LIBTV_VIDEO_MODEL;
}
