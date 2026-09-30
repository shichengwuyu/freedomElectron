// 视频存储：下载、路径、导出到剪映草稿
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { loadProject, projectDir, sanitizeFilename } from './storage.js';
import { videoDiskPath, introDiskPath } from './videoFunctions.js';
import { ffprobePath, loadConfig } from './config.js';
import { diskShotNos } from './shotVideoUtils.js';

const execFileAsync = promisify(execFile);

// 视频存储路径：data/<projectId>/videos/<episodeId>/<shotNo>.mp4
// 这个函数已经在 storage.js 中定义，这里不需要重复

// 从剪映 globalSetting 读取用户自定义的草稿目录
function readJianyingDraftDirFromConfig() {
  const appdata = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (!appdata) return null;
  const settingPath = path.join(appdata, 'JianyingPro', 'User Data', 'Config', 'globalSetting');
  if (!fs.existsSync(settingPath)) return null;
  try {
    const content = fs.readFileSync(settingPath, 'utf8');
    // globalSetting 里存的是路径，格式类似 "D:\\JianyingPro Drafts"
    const match = content.match(/([A-Z]:\\[^"\r\n]+Drafts[^"\r\n]*)/i);
    if (match) {
      const dir = match[1].replace(/\\\\/g, '\\'); // 反斜杠去重
      if (fs.existsSync(dir)) return dir;
    }
  } catch (e) {
    // 读取失败，继续回退
  }
  return null;
}

// 查找剪映草稿目录（优先用户自定义，回退到默认候选）
function findJianyingDraftDir() {
  // 优先从 globalSetting 读用户自定义路径
  const customDir = readJianyingDraftDirFromConfig();
  if (customDir) return customDir;

  const appdata = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (!appdata) return null;

  // 常见默认路径
  const candidates = [
    path.join(appdata, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft'),
    path.join(appdata, '剪映专业版', 'User Data', 'Projects', 'com.lveditor.draft'),
    path.join(appdata, 'JianyingPro', 'drafts'),
    path.join(appdata, '剪映', 'drafts'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

// 获取剪映草稿目录（优先使用配置，否则自动查找）
export function getJianyingDraftDir() {
  const cfg = loadConfig();

  // 如果用户配置了目录且存在，使用配置的
  if (cfg.jianying?.draftDir && fs.existsSync(cfg.jianying.draftDir)) {
    return cfg.jianying.draftDir;
  }

  // 否则自动查找
  return findJianyingDraftDir();
}

// 自动检测剪映草稿目录（返回检测到的路径或 null）
export function detectJianyingDraftDir() {
  return findJianyingDraftDir();
}

// 用 ffprobe 读取视频真实时长（秒），读取失败返回 null
export async function getVideoDuration(videoPath) {
  try {
    const { stdout } = await execFileAsync(ffprobePath(), [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 });
    const sec = parseFloat(stdout.trim());
    return Number.isFinite(sec) && sec > 0 ? sec : null;
  } catch {
    return null;
  }
}

// 生成 32 位小写 hex UUID（用于素材/片段/轨道 id）
function uuid32() {
  return crypto.randomUUID().replace(/-/g, '');
}

// 生成大写带横杠 UUID（用于草稿 id）
function uuidUpper() {
  return crypto.randomUUID().toUpperCase();
}

export function currentEpisodeVideoFiles(projectId, episodeId) {
  return [...diskShotNos(projectId, episodeId)]
    .map((shotNo) => ({ shotNo, path: videoDiskPath(projectId, episodeId, shotNo) }))
    .filter((item) => fs.existsSync(item.path))
    .sort((a, b) => {
      const numberA = Number(a.shotNo);
      const numberB = Number(b.shotNo);
      if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB;
      return String(a.shotNo).localeCompare(String(b.shotNo), 'zh-CN', { numeric: true });
    });
}

// 片头：项目级共用的开场片段。启用且文件存在、时长可读时返回导出信息，否则 null。
export async function introClipExportInfo(projectId) {
  if (!projectId) return null;
  const project = loadProject(projectId);
  const clip = project?.introClip;
  if (!clip || clip.enabled === false) return null;
  const filePath = introDiskPath(projectId);
  if (!fs.existsSync(filePath)) return null;
  const durationSec = await getVideoDuration(filePath);
  if (!durationSec) return null;
  return { path: filePath, durationUs: Math.round(durationSec * 1_000_000), name: '片头' };
}

export function jianyingDraftName(projectId, episodeId) {
  const project = loadProject(projectId);
  const projectName = String(project?.name || project?.id || projectId || '').trim();
  return `${projectName}第${episodeId}集`;
}

export async function createJianyingDraftDirectory(draftDir, requestedName) {
  const baseName = sanitizeFilename(requestedName, '剪映草稿');
  for (let copyNumber = 1; copyNumber <= 9999; copyNumber += 1) {
    const draftName = copyNumber === 1 ? baseName : `${baseName} (${copyNumber})`;
    const draftPath = path.join(draftDir, draftName);
    try {
      await fs.promises.mkdir(draftPath);
      return { draftName, draftPath };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`同名剪映草稿过多：${baseName}`);
}

// 导出视频到剪映草稿（明文 schema，兼容剪映 5.9 / 6.0+ / 10.x）
export async function exportToJianyingDraft(projectId, episodeId) {
  const draftDir = getJianyingDraftDir();
  if (!draftDir) {
    throw new Error('未找到剪映草稿目录。请在设置中配置剪映草稿目录，或确保已安装剪映专业版。');
  }

  // 每个镜头只导出当前激活版本。播放器占用时会保留旧版本文件，直接枚举
  // 目录会把旧片重复塞进草稿，也可能绕过去字幕后的最新版本。
  const videos = currentEpisodeVideoFiles(projectId, episodeId);
  const intro = await introClipExportInfo(projectId);

  if (videos.length === 0 && !intro) {
    throw new Error('该集没有生成的视频');
  }

  const requestedDraftName = jianyingDraftName(projectId, episodeId);

  // 获取每个视频的真实时长（微秒）。不生成时长错误的草稿。
  const materialsData = [];
  let totalDuration = 0;
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const durationSec = await getVideoDuration(video.path);
    if (!durationSec) {
      throw new Error(`无法读取镜头 ${video.shotNo} 的视频时长，请确认视频文件完整后重试`);
    }
    const durationUs = Math.round(durationSec * 1_000_000); // 微秒

    const materialId = uuid32();
    const speedId = uuid32();
    materialsData.push({
      shotNo: video.shotNo,
      path: video.path, // 绝对路径
      duration: durationUs,
      materialId,
      speedId,
      name: `镜头${video.shotNo}`,
    });
    totalDuration += durationUs;
  }

  // 片头插在素材最前面：materials / segments / tracks[0].segments 都按 materialsData 顺序生成，
  // 且 segments[].target_timerange.start 是前缀累加，所以后续所有镜头会整体后移，不用另写偏移逻辑。
  if (intro) {
    materialsData.unshift({
      shotNo: null,
      path: intro.path,
      duration: intro.durationUs,
      materialId: uuid32(),
      speedId: uuid32(),
      name: intro.name,
    });
    totalDuration += intro.durationUs;
  }

  // 部分剪映版本会用文件夹名覆盖 draft_name，因此文件夹本身也必须可读。
  const { draftName, draftPath } = await createJianyingDraftDirectory(draftDir, requestedDraftName);
  const draftId = draftName;

  // 生成 draft_content.json（明文，剪映 5.9 schema）
  const draftContentId = uuidUpper();
  const trackId = uuid32();

  const materials = {
    videos: materialsData.map(m => ({
      id: m.materialId,
      material_id: m.materialId,
      local_material_id: '',
      material_name: m.name,
      path: m.path.replace(/\\/g, '/'), // 统一用正斜杠
      type: 'video',
      duration: m.duration,
      width: 1920, // 默认 1080p，实际可从 ffprobe 读
      height: 1080,
      media_path: '',
      crop: {
        upper_left_x: 0.0, upper_left_y: 0.0,
        upper_right_x: 1.0, upper_right_y: 0.0,
        lower_left_x: 0.0, lower_left_y: 1.0,
        lower_right_x: 1.0, lower_right_y: 1.0,
      },
      crop_ratio: 'free',
      crop_scale: 1.0,
      category_id: '',
      category_name: 'local',
      check_flag: 63487,
      audio_fade: null,
    })),
    speeds: materialsData.map(m => ({
      id: m.speedId,
      type: 'speed',
      mode: 0,
      speed: 1.0,
      curve_speed: null,
    })),
    // 其余 materials 数组全部空
    ai_translates: [], audios: [], canvases: [], transitions: [], masks: [],
    video_effects: [], material_animations: [], texts: [], stickers: [],
    subtitles: [], video_trackings: [], sound_channel_mappings: [],
    chromakeys: [], adjusts: [], speeds_v2: [], smart_crops: [],
    manual_deformations: [], vocal_separations: [], vocal_beautifys: [],
    beatTemplates: [], beat_effects: [],
  };

  const segments = materialsData.map((m, i) => {
    const start = materialsData.slice(0, i).reduce((sum, x) => sum + x.duration, 0);
    return {
      id: uuid32(),
      material_id: m.materialId,
      target_timerange: { start, duration: m.duration },
      source_timerange: { start: 0, duration: m.duration },
      extra_material_refs: [m.speedId],
      speed: 1.0,
      volume: 1.0,
      is_tone_modify: false,
      render_index: 0,
      visible: true,
      reverse: false,
      track_attribute: 0,
      track_render_index: 0,
      clip: {
        alpha: 1.0,
        flip: { horizontal: false, vertical: false },
        rotation: 0.0,
        scale: { x: 1.0, y: 1.0 },
        transform: { x: 0.0, y: 0.0 },
      },
      uniform_scale: { on: true, value: 1.0 },
      hdr_settings: { intensity: 1.0, mode: 1, nits: 1000 },
      common_keyframes: [],
      keyframe_refs: [],
      enable_adjust: true,
      enable_color_curves: true,
      enable_color_wheels: true,
      enable_lut: true,
      last_nonzero_volume: 1.0,
    };
  });

  const draftContent = {
    canvas_config: { width: 1920, height: 1080, ratio: 'original' },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      maintrack_adsorb: true,
      material_save_mode: 0,
      video_mute: false,
      export_range: { end: -1, start: -1 },
    },
    cover: null,
    create_time: Date.now() * 1000, // 微秒
    duration: totalDuration,
    fps: 30.0,
    id: draftContentId,
    keyframes: { adjusts: [], audios: [], videos: [] },
    last_modified_platform: {
      app_id: 3704,
      app_source: 'lv', // 国内版=lv，国际版=cc
      app_version: '5.9.0',
      os: 'windows',
    },
    platform: {
      app_id: 3704,
      app_source: 'lv',
      app_version: '5.9.0',
      os: 'windows',
    },
    materials,
    name: draftName,
    new_version: '110.0.0',
    relationships: [],
    source: 'default',
    tracks: [
      {
        id: trackId,
        type: 'video',
        attribute: 0,
        flag: 0,
        is_default_name: true,
        name: '',
        segments,
      },
    ],
    update_time: Date.now() * 1000,
    version: 360000,
  };

  await fs.promises.writeFile(
    path.join(draftPath, 'draft_content.json'),
    JSON.stringify(draftContent, null, 2),
    'utf-8'
  );

  // 生成 draft_meta_info.json
  const nowUs = Date.now() * 1000;
  const draftMetaInfo = {
    draft_id: draftContentId, // 与 draft_content.json 顶层 id 一致
    draft_name: draftName,
    draft_fold_path: draftPath.replace(/\\/g, '/'), // 草稿文件夹绝对路径
    draft_root_path: draftDir.replace(/\\/g, '/'), // 草稿根目录绝对路径
    draft_cover: '', // 可选，留空让剪映自动生成
    tm_draft_create: nowUs,
    tm_draft_modified: nowUs,
    tm_duration: totalDuration,
    draft_materials: [
      { type: 0, value: [] }, { type: 1, value: [] }, { type: 2, value: [] },
      { type: 3, value: [] }, { type: 6, value: [] }, { type: 7, value: [] },
      { type: 8, value: [] },
    ],
    draft_cloud_materials: [],
    draft_enterprise_info: {
      draft_enterprise_extra: '',
      draft_enterprise_id: '',
      draft_enterprise_name: '',
      enterprise_material: [],
    },
    draft_is_invisible: false,
    draft_new_version: '',
    draft_removable_storage_device: '',
    draft_segment_extra_info: [],
    draft_type: '',
    tm_draft_cloud_modified: 0,
    tm_draft_removed: 0,
  };

  await fs.promises.writeFile(
    path.join(draftPath, 'draft_meta_info.json'),
    JSON.stringify(draftMetaInfo, null, 2),
    'utf-8'
  );

  // 生成 draft_settings（ini 格式明文，可选但建议写）
  const draftSettings = `[General]
draft_create_time=${Math.floor(nowUs / 1000000)}
draft_last_edit_time=${Math.floor(nowUs / 1000000)}
real_edit_seconds=0
real_edit_keys=0
`;
  await fs.promises.writeFile(
    path.join(draftPath, 'draft_settings'),
    draftSettings,
    'utf-8'
  );

  return { draftId, draftPath, draftName, videoCount: materialsData.length };
}

// 批量导出所有集到剪映草稿
export async function exportAllEpisodesToJianying(projectId) {
  const videosDir = path.join(projectDir(projectId), 'videos');
  if (!fs.existsSync(videosDir)) {
    throw new Error('项目中没有生成的视频');
  }

  const episodes = [];
  const dirs = fs.readdirSync(videosDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const episodeId = dir.name;
      const files = fs.readdirSync(path.join(videosDir, episodeId));
      if (files.some(f => f.endsWith('.mp4'))) {
        episodes.push(episodeId);
      }
    }
  }

  if (episodes.length === 0) {
    throw new Error('项目中没有生成的视频');
  }

  const results = [];
  for (const episodeId of episodes) {
    try {
      const result = await exportToJianyingDraft(projectId, episodeId);
      results.push({ episodeId, success: true, ...result });
    } catch (error) {
      results.push({ episodeId, success: false, error: error.message });
    }
  }

  return results;
}
