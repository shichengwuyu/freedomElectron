// 视频历史记录管理
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { projectDir, sanitizeFilename } from './storage.js';
import {
  cleanupSupersededVideoFiles,
  nextVideoWritePath,
  videoDiskPath,
  videoFileEntryExists,
} from './videoFunctions.js';

const MAX_HISTORY_VERSIONS = 5;

// 获取历史记录目录路径
export function videoHistoryDir(projectId, episodeId) {
  return path.join(projectDir(projectId), 'videos', String(episodeId), '.history');
}

// 生成历史版本文件名：<shotNo>_<timestamp>.mp4
function historyVersionFilename(shotNo, timestamp) {
  const safeShotNo = sanitizeFilename(String(shotNo));
  return `${safeShotNo}_${timestamp}.mp4`;
}

function nextHistoryVersion(projectId, episodeId, shotNo) {
  const historyDir = videoHistoryDir(projectId, episodeId);
  let timestamp = Date.now();
  let filename = historyVersionFilename(shotNo, timestamp);
  while (videoFileEntryExists(path.join(historyDir, filename))) {
    timestamp += 1;
    filename = historyVersionFilename(shotNo, timestamp);
  }
  return { timestamp, filename, filePath: path.join(historyDir, filename) };
}

async function fileDigest(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function videoFilesEqual(leftPath, rightPath) {
  if (path.resolve(leftPath) === path.resolve(rightPath)) return true;
  try {
    const [leftStat, rightStat] = await Promise.all([
      fs.promises.stat(leftPath),
      fs.promises.stat(rightPath),
    ]);
    if (!leftStat.isFile() || !rightStat.isFile() || leftStat.size !== rightStat.size) return false;
    const [leftHash, rightHash] = await Promise.all([fileDigest(leftPath), fileDigest(rightPath)]);
    return leftHash === rightHash;
  } catch {
    return false;
  }
}

// 列出某个分镜的所有历史版本
export function listShotVideoHistory(projectId, episodeId, shotNo) {
  const historyDir = videoHistoryDir(projectId, episodeId);
  const safeShotNo = sanitizeFilename(String(shotNo));
  const prefix = `${safeShotNo}_`;

  try {
    if (!fs.existsSync(historyDir)) return [];

    const files = fs.readdirSync(historyDir)
      .filter((name) => name.startsWith(prefix) && name.toLowerCase().endsWith('.mp4'))
      .map((name) => {
        const filePath = path.join(historyDir, name);
        const timestampText = name.slice(prefix.length, -4);
        if (!/^\d+$/.test(timestampText)) return null;
        const timestamp = Number(timestampText);
        if (!Number.isSafeInteger(timestamp)) return null;
        const stats = fs.statSync(filePath);

        return {
          filename: name,
          path: filePath,
          timestamp,
          createdAt: new Date(timestamp).toISOString(),
          size: stats.size,
          sizeFormatted: formatFileSize(stats.size),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp); // 最新的在前

    return files;
  } catch (error) {
    console.error(`列出历史版本失败 ${projectId}/${episodeId}/${shotNo}:`, error);
    return [];
  }
}

// 保存当前视频到历史记录（在生成新版本前调用）
export async function archiveCurrentVideoToHistory(projectId, episodeId, shotNo) {
  const currentPath = videoDiskPath(projectId, episodeId, shotNo);

  // 如果当前没有视频，无需归档
  if (!videoFileEntryExists(currentPath)) {
    return { archived: false, reason: 'no_current_video' };
  }

  const historyDir = videoHistoryDir(projectId, episodeId);
  await compactShotVideoHistory(projectId, episodeId, shotNo);
  for (const version of listShotVideoHistory(projectId, episodeId, shotNo)) {
    if (await videoFilesEqual(currentPath, version.path)) {
      return {
        archived: true,
        reused: true,
        historyPath: version.path,
        timestamp: version.timestamp,
      };
    }
  }
  const { timestamp, filePath: historyPath } = nextHistoryVersion(projectId, episodeId, shotNo);

  try {
    // 确保历史目录存在
    await fs.promises.mkdir(historyDir, { recursive: true });

    // 复制当前视频到历史记录
    await fs.promises.copyFile(currentPath, historyPath);

    // 清理超出数量限制的旧版本
    await pruneOldHistoryVersions(projectId, episodeId, shotNo);

    return {
      archived: true,
      historyPath,
      timestamp,
    };
  } catch (error) {
    console.error(`归档视频到历史失败 ${projectId}/${episodeId}/${shotNo}:`, error);
    return {
      archived: false,
      error: error.message,
    };
  }
}

// 清理超出数量限制的旧历史版本
async function pruneOldHistoryVersions(projectId, episodeId, shotNo) {
  const versions = listShotVideoHistory(projectId, episodeId, shotNo);

  // 保留最新的 MAX_HISTORY_VERSIONS 个版本，删除更旧的
  if (versions.length > MAX_HISTORY_VERSIONS) {
    const toDelete = versions.slice(MAX_HISTORY_VERSIONS);

    for (const version of toDelete) {
      try {
        await fs.promises.rm(version.path, { force: true });
      } catch (error) {
        console.error(`删除旧历史版本失败 ${version.path}:`, error);
      }
    }
  }
}

// 恢复和重试可能把同一段视频重复归档。只保留每种实际视频内容的最新一条，
// 避免重复点击恢复把五个历史槽位全部占满。
export async function compactShotVideoHistory(projectId, episodeId, shotNo) {
  const versions = listShotVideoHistory(projectId, episodeId, shotNo);
  const seenBySize = new Map();
  let deleted = 0;

  for (const version of versions) {
    const candidates = seenBySize.get(version.size) || [];
    let duplicate = false;
    for (const candidate of candidates) {
      if (await videoFilesEqual(version.path, candidate.path)) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      try {
        await fs.promises.rm(version.path, { force: true });
        deleted += 1;
      } catch {
        // 文件被预览占用时保留，下一次打开历史记录再清理。
      }
      continue;
    }
    candidates.push(version);
    seenBySize.set(version.size, candidates);
  }

  await pruneOldHistoryVersions(projectId, episodeId, shotNo);
  return { deleted };
}

// 恢复历史版本到当前（会先将当前版本归档）
export async function restoreVideoFromHistory(projectId, episodeId, shotNo, timestamp) {
  const historyVersions = listShotVideoHistory(projectId, episodeId, shotNo);
  const targetVersion = historyVersions.find((v) => v.timestamp === timestamp);

  if (!targetVersion) {
    throw new Error('历史版本不存在');
  }

  const currentPath = videoDiskPath(projectId, episodeId, shotNo);
  if (videoFileEntryExists(currentPath) && await videoFilesEqual(currentPath, targetVersion.path)) {
    return {
      restored: true,
      unchanged: true,
      currentPath,
      restoredFrom: targetVersion.createdAt,
    };
  }
  const restoredPath = nextVideoWritePath(projectId, episodeId, shotNo);
  const stagingPath = `${restoredPath}.${Date.now()}-${Math.random().toString(36).slice(2)}.part`;

  try {
    await fs.promises.mkdir(path.dirname(restoredPath), { recursive: true });

    // 先暂存目标历史文件。归档当前版本时会执行数量清理，目标版本即使是最旧
    // 的一个，也不能在恢复过程中过早被删掉。
    await fs.promises.copyFile(targetVersion.path, stagingPath);

    // 如果当前有视频，先归档它
    if (videoFileEntryExists(currentPath)) {
      const archiveResult = await archiveCurrentVideoToHistory(projectId, episodeId, shotNo);
      if (!archiveResult.archived && archiveResult.reason !== 'no_current_video') {
        throw new Error(`当前视频归档失败：${archiveResult.error || '无法复制视频文件'}`);
      }
    }

    // 使用全新的版本路径，避免覆盖正在被 Chromium 播放占用的文件。
    await fs.promises.rename(stagingPath, restoredPath);
    await cleanupSupersededVideoFiles(projectId, episodeId, shotNo, {
      keepPath: restoredPath,
      attempts: 1,
    });

    return {
      restored: true,
      currentPath: restoredPath,
      restoredFrom: targetVersion.createdAt,
    };
  } catch (error) {
    await fs.promises.rm(stagingPath, { force: true }).catch(() => {});
    console.error(`恢复历史版本失败 ${projectId}/${episodeId}/${shotNo}:`, error);
    throw new Error(`恢复失败: ${error.message}`);
  }
}

// 删除指定的历史版本
export async function deleteHistoryVersion(projectId, episodeId, shotNo, timestamp) {
  const historyVersions = listShotVideoHistory(projectId, episodeId, shotNo);
  const targetVersion = historyVersions.find((v) => v.timestamp === timestamp);

  if (!targetVersion) {
    throw new Error('历史版本不存在');
  }

  try {
    await fs.promises.rm(targetVersion.path, { force: true });
    return { deleted: true };
  } catch (error) {
    console.error(`删除历史版本失败 ${targetVersion.path}:`, error);
    throw new Error(`删除失败: ${error.message}`);
  }
}

// 清空某个分镜的所有历史记录
export async function clearShotVideoHistory(projectId, episodeId, shotNo) {
  const historyVersions = listShotVideoHistory(projectId, episodeId, shotNo);

  let deleted = 0;
  for (const version of historyVersions) {
    try {
      await fs.promises.rm(version.path, { force: true });
      deleted++;
    } catch (error) {
      console.error(`删除历史版本失败 ${version.path}:`, error);
    }
  }

  return { deleted, total: historyVersions.length };
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// 获取历史记录统计信息
export function getHistoryStats(projectId, episodeId, shotNo) {
  const versions = listShotVideoHistory(projectId, episodeId, shotNo);
  const totalSize = versions.reduce((sum, v) => sum + v.size, 0);

  return {
    count: versions.length,
    maxCount: MAX_HISTORY_VERSIONS,
    totalSize,
    totalSizeFormatted: formatFileSize(totalSize),
    oldestVersion: versions.length > 0 ? versions[versions.length - 1].createdAt : null,
    newestVersion: versions.length > 0 ? versions[0].createdAt : null,
  };
}
