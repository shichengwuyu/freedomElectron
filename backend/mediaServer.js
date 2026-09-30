import fs from 'fs';
import path from 'path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

export async function pathExists(file) {
  try {
    await fs.promises.access(file, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function serveStatic({ frontendDir }, req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const filePath = path.normalize(path.join(frontendDir, rel));
  if (!filePath.startsWith(frontendDir)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (['.html', '.js', '.css'].includes(ext)) {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headers.Pragma = 'no-cache';
      headers.Expires = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

export function serveProjectImage({ imageDiskPath }, req, res, parts) {
  const [projectId, category, rawName] = parts;
  const name = decodeURIComponent(rawName || '').replace(/\.png$/i, '');
  const file = imageDiskPath(decodeURIComponent(projectId), category, name);
  fs.stat(file, (statErr, stat) => {
    if (statErr) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    // no-cache（可缓存、用前必须校验）+ ETag：图片没变时返回 304，切分类/重渲染
    // 不再整张重新下载；重新生成后 mtime 变化 → ETag 失配 → 自动拉取新图。
    // 之前的 no-store 会让画廊每次渲染都全量重下所有图，出图占用连接时全部排队白屏。
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (req?.headers?.['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not Found');
      }
      res.writeHead(200, { ...headers, 'Content-Length': data.length });
      res.end(data);
    });
  });
}

export function serveProjectVideo({ videoDiskPath }, req, res, parts) {
  const [projectId, episodeId, rawShot] = parts;
  const shotNo = decodeURIComponent(rawShot || '').replace(/\.mp4$/i, '');
  const file = videoDiskPath(decodeURIComponent(projectId), decodeURIComponent(episodeId), shotNo);
  streamRangeFile(req, res, file, 'video/mp4', true);
}

// 片头是项目级的（data/<projectId>/intro/intro.mp4），URL 形状 /video-intro/<projectId>.mp4。
export function serveProjectIntro({ introDiskPath }, req, res, parts) {
  const projectId = decodeURIComponent(parts[0] || '').replace(/\.mp4$/i, '');
  streamRangeFile(req, res, introDiskPath(projectId), 'video/mp4', true);
}

export function serveVideoHistory({ videoHistoryDir }, req, res, parts) {
  const [projectId, episodeId, shotNo, rawTimestamp] = parts;
  const timestamp = decodeURIComponent(rawTimestamp || '').replace(/\.mp4$/i, '');
  if (!/^\d+$/.test(timestamp)) {
    res.writeHead(404);
    return res.end('Not Found');
  }
  const historyDir = videoHistoryDir(decodeURIComponent(projectId), decodeURIComponent(episodeId));
  const sanitizeShotNo = decodeURIComponent(String(shotNo || '')).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `${sanitizeShotNo}_${timestamp}.mp4`;
  const file = path.join(historyDir, filename);
  streamRangeFile(req, res, file, 'video/mp4', true);
}

export function serveTailFrame({ tailFrameDiskPath }, res, parts) {
  const [projectId, episodeId, rawShot] = parts;
  const shotNo = decodeURIComponent(rawShot || '').replace(/\.png$/i, '');
  const file = tailFrameDiskPath(decodeURIComponent(projectId), decodeURIComponent(episodeId), shotNo);
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': data.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(data);
  });
}

export function serveCharacterAudio({ characterVoiceDiskPath }, req, res, parts) {
  const [projectId, category, rawName] = parts;
  if (category !== 'character') {
    res.writeHead(404);
    return res.end('Not Found');
  }
  const characterName = decodeURIComponent(rawName || '').replace(/\.(?:mp3|m4a)$/i, '');
  const file = characterVoiceDiskPath(decodeURIComponent(projectId), characterName);
  const contentType = MIME[path.extname(file).toLowerCase()] || 'audio/mpeg';
  streamRangeFile(req, res, file, contentType, true);
}

export function serveCharacterLibraryMedia({ globalCharacterMediaPath }, req, res, parts) {
  const [rawId, rawFilename] = parts;
  const id = decodeURIComponent(rawId || '');
  const filename = decodeURIComponent(rawFilename || '');
  const file = globalCharacterMediaPath(id, filename);
  if (!file) {
    res.writeHead(404);
    return res.end('Not Found');
  }
  const contentType = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  streamRangeFile(req, res, file, contentType, true);
}

export function streamRangeFile(req, res, file, contentType, noStore = false, extraHeaders = {}) {
  const streamFile = (options = {}, attempt = 0) => {
    const stream = fs.createReadStream(file, options);
    // 播放器 seek/切镜头会直接中止响应。不显式销毁读流，句柄会一直挂在这个
    // 进程上，Windows 下旧视频文件就永远删不掉，「重新生成」被卡在清理失败。
    const closeStream = () => { if (!stream.destroyed) stream.destroy(); };
    res.once('close', closeStream);
    res.once('error', closeStream);
    stream.once('close', () => {
      res.off('close', closeStream);
      res.off('error', closeStream);
    });
    stream.on('error', (err) => {
      if (err?.code === 'ERR_STREAM_PREMATURE_CLOSE' || res.destroyed) return;
      // 杀软扫描/文件正被替换会短暂 EBUSY/EPERM，立即报错会让播放器把好
      // 视频当成"视频不可用"。占用通常亚秒级释放，先重试再放弃；只在还没
      // 写出任何字节时重试，避免同一响应里重复数据。
      if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code) && attempt < 3 && stream.bytesRead === 0 && !res.destroyed) {
        setTimeout(() => streamFile(options, attempt + 1), 300 * (attempt + 1));
        return;
      }
      console.warn(`[media] failed to stream ${file}: ${err.message}`);
      if (!res.headersSent) {
        const status = err.code === 'ENOENT' ? 404 : 423;
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (!res.destroyed) res.end(err.code === 'ENOENT' ? 'Not Found' : 'File temporarily unavailable');
    });
    stream.pipe(res);
  };

  fs.stat(file, (err, stat) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const range = req.headers.range;
    const headersBase = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      ...extraHeaders,
    };
    if (noStore) {
      headersBase['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headersBase.Pragma = 'no-cache';
      headersBase.Expires = '0';
    }
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range);
      const start = match && match[1] ? parseInt(match[1], 10) : 0;
      let end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
      // RFC 9110：end 超出文件末尾时截断到 size-1，而不是返回 416；
      // 部分播放器会发送远大于文件长度的 end（如 bytes=0-99999999）。
      if (end >= stat.size) end = stat.size - 1;
      if (start >= stat.size || start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }
      res.writeHead(206, {
        ...headersBase,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      return streamFile({ start, end });
    }
    res.writeHead(200, { ...headersBase, 'Content-Length': stat.size });
    streamFile();
  });
}
