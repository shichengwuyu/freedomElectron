export const IMAGE_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const AUDIO_FILE_MAX_BYTES = 50 * 1024 * 1024;
const IMAGE_FILE_EXTENSION_RE = /\.(png|jpe?g|jfif|webp|gif|bmp|avif)$/i;

export function isImageFile(file) {
  return Boolean(file?.type?.startsWith('image/') || IMAGE_FILE_EXTENSION_RE.test(String(file?.name || '')));
}

export function pickImageFile(fileList) {
  const file = [...(fileList || [])].find(isImageFile);
  if (!file) return { file: null, error: '请上传图片文件' };
  if (file.size > IMAGE_FILE_MAX_BYTES) return { file: null, error: '图片不能超过 15 MB' };
  return { file, error: '' };
}

export function firstImageFile(fileList, handlers = {}) {
  const result = pickImageFile(fileList);
  if (result.error) handlers.warning?.(result.error);
  return result.file;
}

export function pickAudioFile(fileList) {
  const file = [...(fileList || [])].find((f) => f.type?.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(f.name || ''));
  if (!file) return { file: null, error: '请上传音频文件' };
  if (file.size > AUDIO_FILE_MAX_BYTES) return { file: null, error: '音频不能超过 50 MB' };
  return { file, error: '' };
}

export function firstAudioFile(fileList, handlers = {}) {
  const result = pickAudioFile(fileList);
  if (result.error) handlers.warning?.(result.error);
  return result.file;
}

export function readImageAsPngB64(file) {
  if (!isImageFile(file)) return Promise.reject(new Error('不支持的图片格式'));
  if (/\.png$/i.test(String(file?.name || '')) || file?.type === 'image/png') {
    return readFileAsB64(file);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const width = Number(img.naturalWidth) || 0;
        const height = Number(img.naturalHeight) || 0;
        if (!width || !height) throw new Error('图片尺寸无效');
        if (width > 32767 || height > 32767 || width * height > 64 * 1024 * 1024) {
          throw new Error(`图片尺寸过大（${width}x${height}）`);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建图片转换画布');
        context.drawImage(img, 0, 0);
        const result = canvas.toDataURL('image/png').split(',')[1];
        if (!result) throw new Error('图片转换失败');
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

export function readFileAsB64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      resolve(raw.includes(',') ? raw.split(',').pop() : raw);
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文本文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}
