export function decodeTxtBuffer(buffer) {
  const decode = (encoding) => {
    try { return new TextDecoder(encoding).decode(buffer); } catch { return ''; }
  };
  const utf8 = decode('utf-8');
  const utf8Bad = (utf8.match(/\uFFFD/g) || []).length;
  if (!utf8Bad) return utf8.replace(/^\uFEFF/, '');
  const gbText = decode('gb18030');
  const gbBad = gbText ? (gbText.match(/\uFFFD/g) || []).length : Number.POSITIVE_INFINITY;
  return (gbText && gbBad < utf8Bad ? gbText : utf8).replace(/^\uFEFF/, '');
}

export function readTxtFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(decodeTxtBuffer(reader.result));
    reader.onerror = () => reject(new Error(`${file.name} 读取失败`));
    reader.readAsArrayBuffer(file);
  });
}

export async function readPlainTxtFiles(fileList) {
  const files = [...fileList].filter((f) => /\.txt$/i.test(f.name) || f.type === 'text/plain');
  if (!files.length) return null;
  const settled = await Promise.allSettled(files.map(readTxtFile));
  const parts = settled
    .map((item) => item.status === 'fulfilled' ? String(item.value || '') : '')
    .filter((text) => text.trim());
  const failed = settled.length - parts.length;
  if (!parts.length) throw new Error('TXT 内容为空或读取失败');
  return { text: parts.join('\n\n'), okCount: parts.length, failed };
}
