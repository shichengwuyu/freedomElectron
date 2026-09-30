import { ELEMENT_CATEGORIES, flatProjectElements } from './elementList.js';
import { applyShotTimelineMeta, createShotTimelineRuntime } from './shotTimeline.js';
import { cloneShotLockTags, isValidShotLockSnapshot } from './shotLock.js';
import { createIntroClipRuntime } from './introClipRuntime.js';
import { createReferenceStudioRuntime, applyCarryPatchToBody } from './referenceStudioRuntime.js';
import { canSplitShotBody, canSplitShotByParagraphs, shotSplitTargetSeconds, splitShotBodyByParagraphs, splitShotBodyInHalf } from './video/splitShot.js';

export const SHOT_HEADER_PREFIX_MAX_LENGTH = 4000;

const SHOT_PICKER_POPPER_OPTIONS = {
  strategy: 'fixed',
  modifiers: [
    {
      name: 'preventOverflow',
      options: {
        boundary: 'viewport',
        rootBoundary: 'viewport',
        padding: 12,
        altAxis: true,
        tether: false,
      },
    },
    {
      name: 'flip',
      options: { boundary: 'viewport', rootBoundary: 'viewport', padding: 12 },
    },
  ],
};

export function normalizeShotHeaderPrefix(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, SHOT_HEADER_PREFIX_MAX_LENGTH);
}

export function createShotUiStateRuntime({ ref, reactive, computed, refs = {}, helpers = {} } = {}) {
  const fallbackShotHeaderPrefix = ref('无字幕无BGM');
  const shotHeaderPrefix = computed({
    get: () => refs.config?.video?.shotHeaderPrefix ?? fallbackShotHeaderPrefix.value,
    set: (value) => {
      const normalized = String(value ?? '').slice(0, SHOT_HEADER_PREFIX_MAX_LENGTH);
      if (refs.config?.video) refs.config.video.shotHeaderPrefix = normalized;
      else fallbackShotHeaderPrefix.value = normalized;
    },
  });
  return {
    shotHeaderPrefix,
    shotEdit: reactive({ key: '', text: '' }),
    shotVideos: reactive({}),
    shotStatus: reactive({}),
    shotProgress: reactive({}),
    videoQueue: reactive({ items: [], processing: false }),
    videoQueueDialog: ref(false),
    addTagPanel: reactive({
      visible: false,
      activePicker: '',
      shotNo: '',
      searchQuery: '',
      selectedCategory: 'all',
      audioSearchQuery: '',
      lookSearchQuery: '',
      lookOwnerName: '',
      sceneSearchQuery: '',
    }),
    aiBinding: reactive({ running: false, scope: '', activeShotNo: '' }),
    aiBindRangeDialog: reactive({ visible: false, fromNo: null, toNo: null }),
    batchCharacterLookDialog: reactive({
      visible: false,
      ownerName: '',
      lookName: '',
      fromNo: null,
      toNo: null,
    }),
    shotPromptReveal: reactive({}),
    shotTimeline: reactive({
      visible: false,
      selectedNos: [],
      anchorNo: '',
      dragNo: '',
      dropNo: '',
      dropAfter: false,
      attentionFilter: 'all',
      activeAttentionNo: '',
      attentionInput: '',
      jumpNo: '',
      dockJumpOpen: false,
      dockJumpNo: '',
      reviewStatus: 'draft',
      targetEpisodeId: '',
      groupByScene: true,
      zoom: 1,
      cardDensity: undefined,
      busy: false,
      videoPreview: {
        visible: false,
        url: '',
        title: '',
        shotNo: '',
      },
    }),
    selectedSbEpisode: computed(() => helpers.findEpisode(refs.episodeId.value) || null),
    selectedSbStoryboard: computed(() => helpers.findStoryboard(refs.episodeId.value) || null),
  };
}

export function createTailFramePickerStateRuntime({ ref, reactive } = {}) {
  return {
    tailFramePickerVideo: ref(null),
    tailFramePicker: reactive({
      visible: false,
      targetShotNo: null,
      fromShotNo: null,
      videoUrl: '',
      frameName: '开场参考图',
      currentTime: 0,
      duration: 0,
      saving: false,
    }),
  };
}

export function parseShots(text, options = {}) {
  const source = String(text || '');
  const raw = source.trim();
  if (!raw) return [];
  const offset = source.indexOf(raw);
  const re = /^[ \t]*分镜\s*(\d+)\s*[：:]|【(?:分镜|镜头)\s*(\d+)】/gm;
  const marks = [];
  let m;
  while ((m = re.exec(raw)) !== null) marks.push({ no: m[1] || m[2], start: offset + m.index, headEnd: offset + re.lastIndex });
  if (!marks.length) return [{ no: '1', title: '镜头', duration: '', body: raw, index: 0, start: 0, headEnd: 0, end: source.length, fallback: true }];
  const shots = [];
  for (let i = 0; i < marks.length; i++) {
    const cur = marks[i];
    const end = i + 1 < marks.length ? marks[i + 1].start : offset + raw.length;
    const body = source.slice(cur.headEnd, end).trim();
    let title = '';
    const sceneMatch = body.match(/【场景】\s*([^\n]+)/);
    const sceneNameMatch = body.match(/(?:^|\n)\s*场景名称\s*[:：]?\s*([^\n]+)/);
    if (sceneMatch) title = sceneMatch[1].trim();
    else if (sceneNameMatch) title = sceneNameMatch[1].trim();
    else {
      const headerText = String(options.headerPrefix || '').trim();
      const firstLine = body.split('\n').map((l) => l.trim()).find((l) => (
        l && l !== headerText && !/^(?:3D动漫)?无字幕无BGM$/.test(l)
      ));
      title = (firstLine || '').replace(/^(?:3D动漫)?无字幕无BGM\s*/, '').trim() || '镜头';
    }
    const times = [...body.matchAll(/(\d+(?:\.\d+)?)\s*(?:s\b|秒)/gi)].map((x) => parseFloat(x[1]));
    const duration = times.length ? `${Math.max(...times).toFixed(0)}s` : '';
    shots.push({ no: cur.no, title: title.slice(0, 60), duration, body, index: i, start: cur.start, headEnd: cur.headEnd, end });
  }
  return shots;
}

export function defaultShotBody() {
  return '';
}

export function shotBodyHasPrefix(body, prefix) {
  const source = String(body || '').replace(/\r\n?/g, '\n').trim();
  const expected = normalizeShotHeaderPrefix(prefix);
  return !!expected && (source === expected || source.startsWith(`${expected}\n`));
}

export function removeShotBodyPrefix(body, prefix) {
  const source = String(body || '').replace(/\r\n?/g, '\n').trim();
  const expected = normalizeShotHeaderPrefix(prefix);
  if (!expected || !shotBodyHasPrefix(source, expected)) return source;
  return source.slice(expected.length).replace(/^\n+/, '').trim();
}

export function updateStoryboardShotPrefix(content, { previousPrefix = '', nextPrefix = '' } = {}) {
  const source = String(content || '');
  const shots = parseShots(source);
  if (!shots.length) return source;
  const previous = normalizeShotHeaderPrefix(previousPrefix);
  const next = normalizeShotHeaderPrefix(nextPrefix);
  return shots.map((shot) => {
    const header = shot.fallback
      ? '分镜1：'
      : source.slice(shot.start, shot.headEnd).trim();
    let body = previous ? removeShotBodyPrefix(shot.body, previous) : String(shot.body || '').trim();
    if (next && !shotBodyHasPrefix(body, next)) body = `${next}${body ? `\n${body}` : ''}`;
    return `${header}${body ? `\n${body}` : ''}`;
  }).join('\n\n');
}

const SHOT_SETUP_FIELD_LABELS = {
  scene: '场景',
  characters: '人物',
  positions: '人物站位关系',
  props: '道具',
};

const SHOT_SETUP_FIELD_KEYS = {
  场景: 'scene',
  场景名称: 'scene',
  人物: 'characters',
  出场人物: 'characters',
  角色: 'characters',
  人物站位关系: 'positions',
  人物站位: 'positions',
  站位关系: 'positions',
  道具: 'props',
  关键道具: 'props',
};

function parseShotSetupFieldLine(line) {
  const source = String(line ?? '');
  const labelPattern = '人物站位关系|人物站位|站位关系|场景名称|出场人物|关键道具|场景|人物|角色|道具';
  const colonMatch = source.match(new RegExp(`^\\s*(?:[-*]\\s*)?(${labelPattern})\\s*[:：]\\s*(.*?)\\s*$`));
  const bracketMatch = colonMatch
    ? null
    : source.match(new RegExp(`^\\s*(?:[-*]\\s*)?【(${labelPattern})】\\s*(.*?)\\s*$`));
  const match = colonMatch || bracketMatch;
  if (!match) return null;
  const key = SHOT_SETUP_FIELD_KEYS[match[1]];
  return key ? {
    key,
    label: SHOT_SETUP_FIELD_LABELS[key],
    line: source.trimEnd(),
  } : null;
}

function isShotSetupBoundaryLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^(?:画面|画面内容|镜头|运镜|镜头运动|台词|对白|旁白|独白|字幕|音效|音乐|BGM|景别|构图|动作|表情|视觉|摄影|机位|生成段落)\s*[:：]/i.test(text)) return true;
  if (/^(?:【|\[)\s*(?:\d|X|画面|镜头|起始画面|定格画面|结尾帧锚定|状态继承摘要|光影基调|承接定帧|衔接策略|Seedance)/i.test(text)) return true;
  return false;
}

export function extractShotSetupFields(body) {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const fields = [];
  const seen = new Set();
  let start = -1;
  let end = -1;

  let blankSeen = false;

  for (let index = 0; index < lines.length; index += 1) {
    const field = parseShotSetupFieldLine(lines[index]);
    if (field) {
      if (start < 0) start = index;
      end = index;
      blankSeen = false;
      if (!seen.has(field.key)) {
        seen.add(field.key);
        fields.push(field);
      }
      continue;
    }
    if (start < 0) continue;
    // 空行不属于字段块，但字段可能在空行后继续（模型偶尔会分组输出）。
    if (!lines[index].trim()) {
      blankSeen = true;
      continue;
    }
    // 字段值的硬换行续行永远紧跟在字段行后面，不会隔着空行。
    if (blankSeen) break;
    if (isShotSetupBoundaryLine(lines[index])) break;
    // 「角色名：台词」这类无标签台词属于本镜表演内容，不能算进字段块。
    if (isDialogueOrAudioLine(lines[index])) break;
    // 模型经常会在长人物或站位描述中插入硬换行；这些行仍属于字段块。
    end = index;
  }

  return {
    fields,
    start,
    end,
    blockLines: start >= 0 ? lines.slice(start, end + 1) : [],
  };
}

export function reuseShotSetupFields(previousBody, currentBody, options = {}) {
  const source = extractShotSetupFields(previousBody);
  const current = normalizeShotEditBody(currentBody);
  const labels = source.fields.map((field) => field.label);
  if (!source.fields.length) {
    return { body: current, total: 0, labels, changed: false };
  }

  const lines = current.replace(/\r\n?/g, '\n').split('\n');
  const target = extractShotSetupFields(current);
  const sourceLines = source.blockLines;
  if (target.start >= 0) {
    lines.splice(target.start, target.end - target.start + 1, ...sourceLines);
  } else {
    const prefix = normalizeShotHeaderPrefix(options.headerPrefix);
    const insertAt = prefix && shotBodyHasPrefix(current, prefix)
      ? prefix.split('\n').length
      : 0;
    lines.splice(insertAt, 0, ...sourceLines);
  }

  const body = lines.join('\n').trim();
  return {
    body,
    total: source.fields.length,
    labels,
    changed: body !== current,
  };
}

// 分镜正文结构化渲染：把「画面/运镜/台词…」标签、时间轴、【小节】提亮成带色 HTML。
const SHOT_BODY_KEY_KINDS = [
  [/^(画面|镜头|景别|构图|镜头特写|特写|视觉|画面内容)/, 'visual'],
  [/^(运镜|机位|镜头运动|摄影)/, 'camera'],
  [/^(台词|对白|旁白|OS|独白|字幕)/, 'line'],
  [/^(音效|音乐|BGM|声音|音频)/, 'audio'],
  [/^(背景|场景|环境|氛围|前景|中景|后景|世界坐标|固定世界)/, 'scene'],
  [/^(人物|角色|表演|动作|表情)/, 'actor'],
];
function shotBodyKeyKind(label) {
  for (const [re, kind] of SHOT_BODY_KEY_KINDS) {
    if (re.test(label)) return kind;
  }
  return 'meta';
}
function escapeShotHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeShotRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export function renderShotBodyHtml(body, options = {}) {
  const rawNames = Array.isArray(options.characterNames) ? options.characterNames : [];
  const names = [...new Set(rawNames.map((n) => String(n || '').trim()).filter((n) => n.length >= 2 && n.length <= 12))]
    .sort((a, b) => b.length - a.length);
  const speakerRe = names.length
    ? new RegExp(`^(\\s*)(${names.map(escapeShotRegExp).join('|')})((?:（[^）]{0,24}）|\\([^)]{0,24}\\))?)(\\s*[:：])((?:（[^）]{0,24}）|\\([^)]{0,24}\\))?)`)
    : null;
  const lines = String(body || '').split('\n');
  return lines.map((line) => {
    let html = escapeShotHtml(line);

    // [FOOTSTEP_SURFACE_MAP] 之类全大写音效/素材代号 → 代码芯片（任意位置）
    html = html.replace(/\[([A-Z][A-Z0-9_]{3,})\]/g, '<code class="sbk-token">$1</code>');

    // [0.0s-4.5s] 独占一行的时间轴段落头
    const wholeTime = html.match(/^\s*\[(\d+(?:\.\d+)?s?\s*[-–~]\s*\d+(?:\.\d+)?s?)\]\s*$/);
    if (wholeTime) return `<span class="sbk-time">⏱ ${wholeTime[1]}</span>`;

    // 【0-4s】【中景 固定镜头】时间+镜头段落头，后面可跟同行内容
    const seg = html.match(/^(\s*)【(\d+(?:\.\d+)?\s*[-–~]\s*\d+(?:\.\d+)?\s*[sS秒]?)】\s*(?:【([^】]{1,24})】)?\s*/);
    if (seg) {
      const rest = html.slice(seg[0].length);
      return `${seg[1]}<span class="sbk-time">⏱ ${seg[2]}</span>${seg[3] ? `<span class="sbk-cam">${seg[3]}</span>` : ''}${rest ? ' ' + rest : ''}`;
    }

    // 【小节标题】——独占一行或行首带同行内容
    const section = html.match(/^(\s*)【([^】]{1,30})】\s*/);
    if (section) {
      const rest = html.slice(section[0].length);
      return `${section[1]}<span class="sbk-section">${section[2]}</span>${rest ? ' ' + rest : ''}`;
    }

    // 生成段落N： 段落头
    const gen = html.match(/^(\s*)(生成段落\s*\d*)(\s*[:：])/);
    if (gen) return `${gen[1]}<span class="sbk-section">${gen[2].trim()}</span>${gen[3]}${html.slice(gen[0].length)}`;

    // [音效] 行：整行弱化，标签变音符胶囊
    const fx = html.match(/^(\s*)\[(音效|音乐|BGM|声音|音频)\]\s*/);
    if (fx) {
      const rest = html.slice(fx[0].length);
      return `${fx[1]}<span class="sbk-fxline"><b class="sbk sbk-audio">♪ ${fx[2]}</b> ${rest}</span>`;
    }

    // 台词行：行首是本镜头识别到的角色名 → 说话人高亮，（括号动作）弱化
    if (speakerRe) {
      const m = html.match(speakerRe);
      if (m) {
        const rest = html.slice(m[0].length);
        return `<span class="sbk-dialogue">${m[1]}<b class="sbk-speaker">${m[2]}</b>${m[3] ? `<i class="sbk-paren">${m[3]}</i>` : ''}${m[4]}${m[5] ? `<i class="sbk-paren">${m[5]}</i>` : ''}${rest}</span>`;
      }
    }

    // 行首「标签：」通用染色（2-10 字标签，已知类型给专属色，其余中性）
    html = html.replace(/^(\s*)([一-龥A-Za-z][一-龥A-Za-z/（）()·]{1,9})(\s*[:：])/, (whole, pad, label, colon) => {
      const kind = shotBodyKeyKind(label.trim());
      return `${pad}<b class="sbk sbk-${kind}">${label.trim()}</b>${colon}`;
    });
    return html;
  }).join('\n');
}

export function shiftShotMap(map, fromNo, delta, transform = null) {
  if (!map || typeof map !== 'object') return map;
  const next = {};
  const entries = Object.entries(map);
  if (delta > 0) entries.sort((a, b) => Number(b[0]) - Number(a[0]));
  else entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  for (const [key, value] of entries) {
    const n = Number(key);
    if (!Number.isFinite(n)) {
      next[key] = value;
      continue;
    }
    if (n >= fromNo) {
      const nextNo = n + delta;
      next[String(nextNo)] = transform ? transform(value, nextNo, n) : value;
    } else {
      next[String(n)] = value;
    }
  }
  return next;
}

export function shiftRuntimeShotMap(map, episodeId, fromNo, delta, transform = null) {
  const prefix = `${episodeId}:`;
  const entries = Object.entries(map)
    .filter(([key]) => key.startsWith(prefix))
    .sort(([a], [b]) => {
      const na = Number(a.slice(prefix.length));
      const nb = Number(b.slice(prefix.length));
      return delta > 0 ? nb - na : na - nb;
    });
  for (const [key] of entries) {
    const no = Number(key.slice(prefix.length));
    if (!Number.isFinite(no) || no < fromNo) continue;
    const value = map[key];
    delete map[key];
    const nextNo = no + delta;
    map[`${episodeId}:${nextNo}`] = transform ? transform(value, nextNo, no) : value;
  }
}

export function removeShotMapKey(map, no) {
  if (map && typeof map === 'object') delete map[String(no)];
}

export function removeRuntimeShotKey(map, episodeId, no) {
  const key = `${episodeId}:${no}`;
  const value = map[key];
  delete map[key];
  return value;
}

export function renumberShotText(text, insertAtNo = null, insertBody = '', options = {}) {
  const source = String(text || '');
  const shots = parseShots(source, options);
  if (!shots.length) {
    return insertBody ? `分镜1：\n${insertBody.trim()}` : '';
  }
  const parts = [];
  const appendShot = (body) => {
    parts.push(`分镜${parts.length + 1}：\n${String(body || '').trim()}`);
  };
  for (const shot of shots) {
    if (insertAtNo !== null && parts.length + 1 === insertAtNo) appendShot(insertBody);
    appendShot(shot.body);
  }
  if (insertAtNo !== null && insertAtNo > parts.length) appendShot(insertBody);
  return parts.join('\n\n');
}

const STORYBOARD_MARKER_CANDIDATES = ['生成段落', '分镜头', '分镜', '镜头', '段落', '场景', '画面', '镜'];

export function detectStoryboardMarker(text) {
  const src = String(text || '');
  if (!src.trim()) return '';
  let best = '';
  let bestCount = 0;
  for (const word of STORYBOARD_MARKER_CANDIDATES) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^[ \\t]*${escaped}\\s*\\d+\\s*[：:、.\\s]`, 'gm');
    const count = (src.match(re) || []).length;
    if (count >= 2 && (count > bestCount || (count === bestCount && word.length > best.length))) {
      best = word;
      bestCount = count;
    }
  }
  return best;
}

export function nameMatchesText(name, text) {
  const cleanName = String(name || '');
  const sourceText = String(text || '');
  // 本地匹配只接受完整名称/别名出现在镜头文本中，避免长名称的片段命中误绑元素。
  return !!cleanName && sourceText.includes(cleanName);
}

function textMatchRanges(term, text) {
  const cleanTerm = String(term || '');
  const sourceText = String(text || '');
  if (!cleanTerm || !sourceText) return [];
  const ranges = [];
  let fromIndex = 0;
  while (fromIndex <= sourceText.length - cleanTerm.length) {
    const start = sourceText.indexOf(cleanTerm, fromIndex);
    if (start < 0) break;
    ranges.push({ start, end: start + cleanTerm.length });
    fromIndex = start + 1;
  }
  return ranges;
}

function hasIndependentElementMatch(candidate, candidates) {
  return candidate.ranges.some((range) => !candidates.some((other) => (
    other !== candidate
    && other.ranges.some((otherRange) => (
      otherRange.start <= range.start
      && otherRange.end >= range.end
      && (otherRange.end - otherRange.start) > (range.end - range.start)
    ))
  )));
}

const visualPresenceLabelRe = /^(?:人物|角色|道具|场景|特效|关键动作|画中画|幻想(?:画面)?|想象(?:画面)?|内心画面|回忆(?:画面)?|记忆闪回|闪回(?:画面)?|梦境(?:画面)?|投影(?:画面)?|屏幕(?:中|内)?(?:画面|影像)?|照片(?:中|内)?(?:画面|影像)?|镜像(?:画面)?|镜中(?:画面|影像)|监控(?:画面|影像)|视频(?:画面|影像)|Q版(?:画面|形象)?|场景名称|固定世界坐标|门窗\/光源\/地形|人物世界位置|人物当前姿态|人物实际接触物|人物朝向|关键道具位置|前景锚点|中景锚点|后景锚点|不可变化元素|不可误判|本段开场状态|允许变化项|禁止变化项|出场要素|人物结尾世界位置|人物结尾姿态|人物结尾接触物|人物结尾朝向|关键道具\/武器结尾位置|伤口\/血迹\/衣物破损\/污渍状态|特效残留状态|环境破坏状态|主光方向|下一段起幅必须显式写入|画面动作运镜|三维空间关系|连续性防错|特效层次|物理受力点)\s*[:：]/;

export function isVisualPresenceLine(line) {
  return visualPresenceLabelRe.test(String(line || '').trim());
}

export function isDialogueOrAudioLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (isVisualPresenceLine(text)) return false;
  if (/^(?:台词|对白|旁白|画外音|内心独白|OS|音效|音乐|BGM|环境音)\s*[:：]/i.test(text)) return true;
  const m = text.match(/^([^：:\n]{1,16})(?:\([^)]*\)|（[^）]*）)?\s*[：:]/);
  if (!m) return false;
  const label = m[1].trim();
  if (!label || /\d/.test(label) || /[【】\[\]]/.test(label)) return false;
  if (/^(?:画面|镜头|运镜|场景|出场人物|起始画面|定格画面|结尾帧锚定|画面段落|状态继承摘要|光影基调|场景与站位概览|承接定帧|衔接策略|特写|动作|视觉动作)$/i.test(label)) return false;
  return true;
}

export function stripAudioTextFromPresenceLine(line) {
  const text = String(line || '').trim();
  if (!text) return '';
  const marker = text.search(/(?:^|[\s,，;；。])(?:台词|对白|旁白|画外音|内心独白|OS|音效|音乐|BGM|环境音)\s*[:：]/i);
  const visualPart = marker >= 0 ? text.slice(0, marker).trim() : text;
  const timeMatch = visualPart.match(/^(\[[^\]]+\])\s*(.*)$/);
  if (timeMatch && isDialogueOrAudioLine(timeMatch[2])) return timeMatch[1];
  return visualPart;
}

export function shotPresenceText(shot) {
  const body = String(shot?.body || '');
  const visualLines = [];
  for (const line of body.split(/\r?\n/)) {
    const text = line.trim();
    if (!text || isDialogueOrAudioLine(text)) continue;
    const visualText = stripAudioTextFromPresenceLine(text);
    if (!visualText) continue;
    if (/^【(?:起始画面|定格画面|结尾帧锚定|场景|状态继承摘要|光影基调|场景与站位概览|承接定帧|衔接策略[^】]*|本段独立场景与空间锁定|起幅接帧校验|出场要素|人物状态锁定|情绪与光影|镜头内动态调度轴|本段画面出口点|Seedance最终生成提示词|本段结尾状态台账)】/.test(visualText)) {
      visualLines.push(visualText);
      continue;
    }
    if (/^【\d+(?:\.\d+)?\s*[-–]\s*\d+(?:\.\d+)?\s*(?:s|秒)】/i.test(visualText)) {
      visualLines.push(visualText);
      continue;
    }
    if (/^\[\s*(?:\d+(?:\.\d+)?|X)\s*[-–]\s*(?:\d+(?:\.\d+)?|X)\s*(?:s|秒)\s*\]/i.test(visualText)) {
      visualLines.push(visualText);
      continue;
    }
    if (/^(?:出场人物|画面|镜头|运镜|特写|动作|视觉动作)\s*[:：]/.test(visualText) || isVisualPresenceLine(visualText)) {
      visualLines.push(visualText);
      continue;
    }
    if (/^\[[^\]]+\]/.test(visualText)) visualLines.push(visualText);
  }
  if (visualLines.length) return visualLines.join('\n');
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isDialogueOrAudioLine(line))
    .map(stripAudioTextFromPresenceLine)
    .filter(Boolean)
    .join('\n');
}

const shotTagCategoryOrder = { character: 0, group: 1, scene: 2, prop: 3, effect: 4, creature: 5 };

// 元素库里换主形态/重生成只改磁盘文件名不变，URL 不带版本号时浏览器会一直用旧解码结果，
// 分镜里的小图必须重进项目才刷新。带上元素自身的版本号，交换后 src 变化即刻重新拉图。
export function imageVersionQuery(el) {
  const version = String(el?.imageVersion || '').trim();
  return version ? `?v=${encodeURIComponent(version)}` : '';
}

export function buildShotElementTags(shot, options = {}) {
  const text = `${shot.title}\n${shot.body}`;
  const presenceText = shotPresenceText(shot);
  const seen = new Set();
  const tags = [];
  const flat = Array.isArray(options.elements) ? options.elements : flatProjectElements(options.project);
  const excluded = Array.isArray(options.excludedTags) ? options.excludedTags : [];
  const manualTags = Array.isArray(options.manualTags) ? options.manualTags : [];
  const lookOverrideOwners = new Set(
    manualTags
      .filter((item) => item?.cat === 'character' && item?.source === 'look')
      .map((item) => String(item.ownerName || '').trim())
      .filter(Boolean),
  );
  const sceneAreaOverrideOwners = new Set(
    manualTags
      .filter((item) => item?.cat === 'scene')
      .map((item) => {
        const matched = flat.find((element) => element.cat === 'scene' && element.name === item.name);
        if (item?.source === 'sceneArea') return String(item.ownerName || matched?.ownerName || '').trim();
        return matched?.assetKind === 'sceneArea' ? String(matched.ownerName || item.ownerName || '').trim() : '';
      })
      .filter(Boolean),
  );
  const characterOwnerDisplayNames = new Map(
    flat
      .filter((item) => item?.cat === 'character' && item?.assetKind === 'main')
      .map((item) => [String(item.ownerName || item.name || '').trim(), item.displayName || item.name]),
  );
  const projectId = encodeURIComponent(options.projectId || '');
  const pushTag = (el, manual, source = '') => {
    const key = el.cat + ':' + el.name;
    if (seen.has(key)) return;
    if (excluded.some((m) => m.cat === el.cat && m.name === el.name)) return;
    seen.add(key);
    const ownerName = el.ownerName || '';
    const isCharacterLook = el.cat === 'character' && el.assetKind && el.assetKind !== 'main';
    const displayName = isCharacterLook
      ? (characterOwnerDisplayNames.get(ownerName) || ownerName || el.displayName || el.name)
      : (el.displayName || el.name);
    const mentionName = isCharacterLook
      ? (ownerName || displayName)
      : displayName;
    const versionQuery = imageVersionQuery(el);
    const labelQuery = mentionName
      ? `${versionQuery ? '&' : '?'}label=${encodeURIComponent(mentionName)}`
      : '';
    tags.push({
      name: el.name,
      displayName,
      alias: el.alias || '',
      cat: el.cat,
      ownerName,
      assetKind: el.assetKind || '',
      assetLabel: el.assetLabel || '',
      manualOnly: !!el.manualOnly,
      hasImage: el.hasImage,
      manual: !!manual,
      source,
      imageBase: el.imageBase || el.name,
      imageVersion: el.imageVersion || '',
      generating: !!el.generating,
      mentionName,
      hasVoiceAudio: !!el.hasVoiceAudio,
      voiceOwnerName: el.voiceOwnerName || el.ownerName || el.name,
      voiceName: el.voiceName || `${el.name}_音频`,
      url: el.hasImage ? `/img/${projectId}/${el.cat}/${encodeURIComponent(el.imageBase)}.png${versionQuery}` : '',
      labeledUrl: el.hasImage ? `/imglabel/${projectId}/${el.cat}/${encodeURIComponent(el.imageBase)}.png${versionQuery}${labelQuery}` : '',
    });
  };
  const automaticMatches = [];
  for (const el of flat) {
    if (el.manualOnly) continue;
    if (el.cat === 'character' && lookOverrideOwners.has(String(el.ownerName || el.name).trim())) continue;
    if (el.cat === 'scene' && sceneAreaOverrideOwners.has(String(el.ownerName || el.name).trim())) continue;
    if (excluded.some((item) => item.cat === el.cat && item.name === el.name)) continue;
    const matchTerms = [...new Set([...(el.matchTerms || []), el.matchName, el.alias, el.name].map((v) => String(v || '').trim()).filter((v) => v.length >= 2))];
    if (!matchTerms.length) continue;
    const matchText = el.cat === 'character' ? presenceText : text;
    const matchedRanges = matchTerms.flatMap((term) => textMatchRanges(term, matchText));
    if (!matchedRanges.length) continue;
    if (el.cat === 'character' && el.ownerName && !nameMatchesText(el.ownerName, presenceText)) continue;
    // Match eligibility may use the filtered presence text for characters, but
    // overlap checks must use one shared coordinate space across categories.
    const ranges = matchTerms.flatMap((term) => textMatchRanges(term, text));
    automaticMatches.push({ el, ranges });
  }
  for (const candidate of automaticMatches) {
    // 短名称若只命中在更长名称内部，属于同一次提及，不应跨类别重复绑定。
    if (!hasIndependentElementMatch(candidate, automaticMatches)) continue;
    pushTag(candidate.el, false);
  }
  for (const manualTag of manualTags) {
    const el = flat.find((item) => item.cat === manualTag.cat && item.name === manualTag.name);
    if (!el) continue;
    const ownerName = String(el.ownerName || el.name).trim();
    if (
      el.cat === 'character'
      && lookOverrideOwners.has(ownerName)
      && !(manualTag.source === 'look' && manualTag.ownerName === ownerName)
    ) continue;
    if (
      el.cat === 'scene'
      && sceneAreaOverrideOwners.has(ownerName)
      && !(
        (manualTag.source === 'sceneArea' && manualTag.ownerName === ownerName)
        || el.assetKind === 'sceneArea'
      )
    ) continue;
    pushTag(el, true, manualTag.source || '');
  }
  tags.sort((a, b) => (shotTagCategoryOrder[a.cat] - shotTagCategoryOrder[b.cat]) || a.name.localeCompare(b.name));
  return tags;
}

export function characterAudioOptionsForProject(project = {}) {
  const projectId = project?.id || '';
  return (project?.elements?.character || [])
    .map((character) => {
      const name = String(character?.name || '').trim();
      if (!name || !character?.hasVoiceAudio) return null;
      return {
        name,
        displayName: character.alias || name,
        voiceName: character.voiceAudioName || `${name}_音频`,
        url: character.voiceAudioUrl
          || `/audio/${encodeURIComponent(projectId)}/character/${encodeURIComponent(name)}.mp3`,
      };
    })
    .filter(Boolean);
}

function audioBindingNames(bindings, key) {
  const list = bindings?.[key];
  return new Set((Array.isArray(list) ? list : [])
    .map((item) => typeof item === 'string' ? item : item?.name)
    .map((name) => String(name || '').trim())
    .filter(Boolean));
}

export function shotAudioBindingState(storyboard, no) {
  const state = storyboard?.shotMeta?.[String(no)]?.audioBindings;
  return {
    manual: [...audioBindingNames(state, 'manual')],
    excluded: [...audioBindingNames(state, 'excluded')],
  };
}

export function shotAudioTagsForProject(projectId, tags = [], options = {}) {
  const seen = new Set();
  const out = [];
  const audioOptions = Array.isArray(options.audioOptions)
    ? options.audioOptions
    : characterAudioOptionsForProject(options.project || { id: projectId });
  const optionByName = new Map(audioOptions.map((item) => [item.name, item]));
  const manualNames = audioBindingNames(options.audioBindings, 'manual');
  const excludedNames = audioBindingNames(options.audioBindings, 'excluded');
  const push = (owner, fallback = null) => {
    const name = String(owner || '').trim();
    if (!name || seen.has(name) || excludedNames.has(name)) return;
    const option = optionByName.get(name);
    if (!option && !fallback?.hasVoiceAudio) return;
    seen.add(name);
    out.push({
      name,
      displayName: option?.displayName || name,
      voiceName: option?.voiceName || fallback?.voiceName || `${name}_音频`,
      manual: manualNames.has(name),
      url: option?.url || fallback?.voiceAudioUrl || `/audio/${encodeURIComponent(projectId || '')}/character/${encodeURIComponent(name)}.mp3`,
    });
  };
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (tag?.cat !== 'character' || !tag.hasVoiceAudio) continue;
    push(tag.voiceOwnerName || tag.name, tag);
  }
  for (const name of manualNames) push(name);
  return out;
}

export function openAddTagPanel(panel, shot) {
  panel.shotNo = String(shot?.no ?? '');
  panel.visible = true;
  panel.searchQuery = '';
  panel.selectedCategory = 'all';
}

export function filteredAddTagElementsForPanel(project, panel) {
  const empty = Object.fromEntries(ELEMENT_CATEGORIES.map((category) => [category, []]));
  if (!project?.elements) return empty;
  const query = String(panel.searchQuery || '').toLowerCase().trim();
  const selectedCategory = panel.selectedCategory || 'all';
  const result = { ...empty };
  for (const category of ELEMENT_CATEGORIES) {
    if (selectedCategory !== 'all' && selectedCategory !== category) continue;
    const elements = project.elements[category] || [];
    result[category] = query
      ? elements.filter((element) => String(element.name || '').toLowerCase().includes(query))
      : elements;
  }
  return result;
}

export function characterLookGroupsForPanel(project, panel = {}) {
  const query = String(panel.lookSearchQuery || '').trim().toLowerCase();
  const flat = flatProjectElements(project).filter((item) => item.cat === 'character');
  const groups = [];
  for (const character of project?.elements?.character || []) {
    const ownerName = String(character?.name || '').trim();
    if (!ownerName) continue;
    const allLooks = flat.filter((item) => item.ownerName === ownerName);
    if (allLooks.length < 2) continue;
    const ownerSearchable = [ownerName, character.alias]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    const ownerMatches = !query || ownerSearchable.includes(query);
    const looks = ownerMatches ? allLooks : allLooks.filter((item) => (
      [item.matchName, item.lookLabel, item.assetLabel]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
        .includes(query)
    ));
    if (!looks.length) continue;
    groups.push({
      name: ownerName,
      displayName: String(character.alias || ownerName).trim(),
      looks,
    });
  }
  return groups;
}

export function sceneAreaGroupsForPanel(project, panel = {}) {
  const query = String(panel.sceneSearchQuery || '').trim().toLowerCase();
  const flat = flatProjectElements(project).filter((item) => item.cat === 'scene');
  const groups = [];
  for (const scene of project?.elements?.scene || []) {
    const ownerName = String(scene?.name || '').trim();
    if (!ownerName) continue;
    const areas = flat.filter((item) => item.ownerName === ownerName);
    if (areas.length < 2) continue;
    const searchable = [ownerName, scene.alias, ...areas.flatMap((item) => [item.displayName, item.matchName, item.assetLabel])]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
    if (query && !searchable.includes(query)) continue;
    groups.push({
      name: ownerName,
      displayName: String(scene.alias || ownerName).trim(),
      areas,
    });
  }
  return groups;
}

export function projectElementTotal(project) {
  const elements = project?.elements || {};
  return ELEMENT_CATEGORIES.reduce((sum, category) => (
    sum + (Array.isArray(elements[category]) ? elements[category].length : 0)
  ), 0);
}

export async function editElementBindingNameFlow(tag, handlers = {}) {
  const project = handlers.project();
  if (!project || !tag?.cat || !tag?.name) return;
  const list = project.elements?.[tag.cat] || [];
  const index = list.findIndex((element) => element.name === tag.name);
  if (index < 0) {
    handlers.warning('该标签不是元素库主元素，请到元素卡片里修改');
    return;
  }
  const element = list[index];
  const alias = await handlers.promptAlias(String(element.alias || tag.displayName || element.name || '').trim());
  if (alias == null) return;
  try {
    const saved = await handlers.saveElement({
      projectId: project.id,
      category: tag.cat,
      index,
      name: element.name,
      alias,
    });
    if (!saved.ok) throw new Error(saved.error || '保存失败');
    element.alias = saved.alias || '';
    handlers.success(alias ? `已同步绑定名：${alias}` : '已恢复元素原名');
  } catch (error) {
    handlers.error('保存绑定名失败：' + (error.message || error));
  }
}

export function createEditElementBindingNameRuntimeContext({ api, message, refs = {}, ui = {} } = {}) {
  return {
    ...message,
    project: () => refs.project.value,
    promptAlias: (inputValue) => ui.prompt(
      '设置后会同步到元素库，并用于分镜标签显示和视频生成引用名。留空可恢复元素原名。',
      '自定义绑定名',
      {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue,
        inputPlaceholder: '例如：人物站位 / 初始画面 / 少年顾明',
      }
    ).then((result) => String(result.value || '').trim().slice(0, 40)).catch(() => null),
    saveElement: (payload) => api.post('/api/project/element', payload),
  };
}

export function storyboardTagList(storyboard, bucket, no) {
  const list = storyboard?.[bucket]?.[String(no)];
  return Array.isArray(list) ? list : [];
}

export function hasStoryboardTag(storyboard, bucket, no, cat, name) {
  return storyboardTagList(storyboard, bucket, no).some((item) => item.cat === cat && item.name === name);
}

export function toggleStoryboardManualTag(storyboard, no, cat, name) {
  if (!storyboard) return false;
  if (!storyboard.manualTags || typeof storyboard.manualTags !== 'object') storyboard.manualTags = {};
  const key = String(no);
  const list = Array.isArray(storyboard.manualTags[key]) ? storyboard.manualTags[key] : [];
  const idx = list.findIndex((item) => item.cat === cat && item.name === name);
  if (idx >= 0) {
    const [removed] = list.splice(idx, 1);
    writeStoryboardTagList(storyboard, 'manualTags', key, list);
    excludeStoryboardTag(storyboard, key, { ...removed, cat, name });
  } else {
    list.push({ cat, name });
    if (storyboard.excludedTags && typeof storyboard.excludedTags === 'object' && Array.isArray(storyboard.excludedTags[key])) {
      storyboard.excludedTags[key] = storyboard.excludedTags[key].filter((item) => !(item.cat === cat && item.name === name));
      if (!storyboard.excludedTags[key].length) delete storyboard.excludedTags[key];
    }
    storyboard.manualTags[key] = list;
  }
  return true;
}

function characterLookOwnerNames(ownerName, elements = []) {
  return new Set(
    elements
      .filter((item) => item.cat === 'character' && item.ownerName === ownerName)
      .map((item) => item.name),
  );
}

function writeStoryboardTagList(storyboard, bucket, key, list) {
  if (list.length) storyboard[bucket][key] = list;
  else delete storyboard[bucket][key];
}

function excludeStoryboardTag(storyboard, key, tag = {}) {
  if (!storyboard.excludedTags || typeof storyboard.excludedTags !== 'object') storyboard.excludedTags = {};
  const list = Array.isArray(storyboard.excludedTags[key]) ? storyboard.excludedTags[key] : [];
  const index = list.findIndex((item) => item.cat === tag.cat && item.name === tag.name);
  const excluded = { ...tag, cat: tag.cat, name: tag.name, source: 'text-match' };
  if (index >= 0) list.splice(index, 1, { ...list[index], ...excluded });
  else list.push(excluded);
  storyboard.excludedTags[key] = list;
}

export function clearStoryboardCharacterLook(storyboard, no, ownerName, elements = []) {
  const normalizedOwnerName = String(ownerName || '').trim();
  if (!storyboard || !normalizedOwnerName) return false;
  const key = String(no);
  if (!storyboard.manualTags || typeof storyboard.manualTags !== 'object') storyboard.manualTags = {};
  if (!storyboard.excludedTags || typeof storyboard.excludedTags !== 'object') storyboard.excludedTags = {};
  const manualList = Array.isArray(storyboard.manualTags[key]) ? storyboard.manualTags[key] : [];
  const excludedList = Array.isArray(storyboard.excludedTags[key]) ? storyboard.excludedTags[key] : [];
  const hasLookOverride = manualList.some((item) => (
    item.cat === 'character' && item.source === 'look' && item.ownerName === normalizedOwnerName
  )) || excludedList.some((item) => (
    item.cat === 'character' && item.source === 'look' && item.ownerName === normalizedOwnerName
  ));
  if (!hasLookOverride) return false;
  const ownerLookNames = characterLookOwnerNames(normalizedOwnerName, elements);
  const nextManual = manualList.filter((item) => !(
    item.cat === 'character'
    && (ownerLookNames.has(item.name) || (item.source === 'look' && item.ownerName === normalizedOwnerName))
  ));
  const nextExcluded = excludedList.filter((item) => !(
    item.cat === 'character' && item.source === 'look' && item.ownerName === normalizedOwnerName
  ));
  if (nextManual.length === manualList.length && nextExcluded.length === excludedList.length) return false;
  writeStoryboardTagList(storyboard, 'manualTags', key, nextManual);
  writeStoryboardTagList(storyboard, 'excludedTags', key, nextExcluded);
  return true;
}

export function setStoryboardCharacterLook(storyboard, no, look, elements = [], options = {}) {
  if (!storyboard || !look || look.cat !== 'character') return false;
  const ownerName = String(look.ownerName || look.name || '').trim();
  const selectedName = String(look.name || '').trim();
  if (!ownerName || !selectedName) return false;
  const key = String(no);
  if (!storyboard.manualTags || typeof storyboard.manualTags !== 'object') storyboard.manualTags = {};
  if (!storyboard.excludedTags || typeof storyboard.excludedTags !== 'object') storyboard.excludedTags = {};
  const manualList = Array.isArray(storyboard.manualTags[key]) ? storyboard.manualTags[key] : [];
  const excludedList = Array.isArray(storyboard.excludedTags[key]) ? storyboard.excludedTags[key] : [];
  const ownerLookNames = characterLookOwnerNames(ownerName, elements);
  const current = manualList.find((item) => item.cat === 'character' && item.source === 'look' && item.ownerName === ownerName);
  const restoringAutomatic = options.toggle !== false && current?.name === selectedName;
  if (restoringAutomatic) return clearStoryboardCharacterLook(storyboard, no, ownerName, elements);
  const nextManual = manualList.filter((item) => !(
    item.cat === 'character'
    && (ownerLookNames.has(item.name) || (item.source === 'look' && item.ownerName === ownerName))
  ));
  const nextExcluded = excludedList.filter((item) => !(
    item.cat === 'character'
    && (item.name === selectedName || (item.source === 'look' && item.ownerName === ownerName))
  ));

  nextManual.push({ cat: 'character', name: selectedName, source: 'look', ownerName });
  for (const item of elements) {
    if (item.cat !== 'character' || item.ownerName !== ownerName || item.name === selectedName) continue;
    if (!nextExcluded.some((tag) => tag.cat === 'character' && tag.name === item.name)) {
      nextExcluded.push({ cat: 'character', name: item.name, source: 'look', ownerName });
    }
  }

  const changed = JSON.stringify(manualList) !== JSON.stringify(nextManual)
    || JSON.stringify(excludedList) !== JSON.stringify(nextExcluded);
  if (!changed) return false;
  writeStoryboardTagList(storyboard, 'manualTags', key, nextManual);
  writeStoryboardTagList(storyboard, 'excludedTags', key, nextExcluded);
  return true;
}

export function applyStoryboardCharacterLookRange(storyboard, shots, selection = {}, elements = []) {
  const range = normalizeShotNoRange(selection.fromNo, selection.toNo);
  const look = selection.look || null;
  const ownerName = String(selection.ownerName || look?.ownerName || look?.name || '').trim();
  if (!storyboard || !range || !ownerName || (look && look.cat !== 'character')) {
    return { changed: 0, total: 0, range };
  }
  const shotNos = [...new Set((Array.isArray(shots) ? shots : [])
    .map((shot) => Number(shot?.no))
    .filter((no) => Number.isFinite(no) && no >= range.fromNo && no <= range.toNo))];
  let changed = 0;
  for (const no of shotNos) {
    const didChange = look
      ? setStoryboardCharacterLook(storyboard, no, look, elements, { toggle: false })
      : clearStoryboardCharacterLook(storyboard, no, ownerName, elements);
    if (didChange) changed += 1;
  }
  return { changed, total: shotNos.length, range };
}

export function setStoryboardSceneArea(storyboard, no, area, elements = []) {
  if (!storyboard || !area || area.cat !== 'scene') return false;
  const ownerName = String(area.ownerName || area.name || '').trim();
  const selectedName = String(area.name || '').trim();
  if (!ownerName || !selectedName) return false;
  const key = String(no);
  if (!storyboard.manualTags || typeof storyboard.manualTags !== 'object') storyboard.manualTags = {};
  if (!storyboard.excludedTags || typeof storyboard.excludedTags !== 'object') storyboard.excludedTags = {};
  const manualList = Array.isArray(storyboard.manualTags[key]) ? storyboard.manualTags[key] : [];
  const excludedList = Array.isArray(storyboard.excludedTags[key]) ? storyboard.excludedTags[key] : [];
  const ownerAreaNames = new Set(
    elements
      .filter((item) => item.cat === 'scene' && item.ownerName === ownerName)
      .map((item) => item.name),
  );
  const current = manualList.find((item) => item.cat === 'scene' && ownerAreaNames.has(item.name));
  const restoringAutomatic = current?.name === selectedName;
  const nextManual = manualList.filter((item) => !(
    item.cat === 'scene'
    && (ownerAreaNames.has(item.name) || (item.source === 'sceneArea' && item.ownerName === ownerName))
  ));
  const nextExcluded = excludedList.filter((item) => !(
    item.cat === 'scene'
    && (
      item.name === selectedName
      || (item.source === 'sceneArea' && item.ownerName === ownerName)
      || (item.source === 'ai' && (item.ownerName === ownerName || ownerAreaNames.has(item.name)))
    )
  ));

  if (!restoringAutomatic) {
    nextManual.push({ cat: 'scene', name: selectedName, source: 'sceneArea', ownerName });
    for (const item of elements) {
      if (item.cat !== 'scene' || item.ownerName !== ownerName || item.name === selectedName) continue;
      if (!nextExcluded.some((tag) => tag.cat === 'scene' && tag.name === item.name)) {
        nextExcluded.push({ cat: 'scene', name: item.name, source: 'sceneArea', ownerName });
      }
    }
  }

  if (nextManual.length) storyboard.manualTags[key] = nextManual;
  else delete storyboard.manualTags[key];
  if (nextExcluded.length) storyboard.excludedTags[key] = nextExcluded;
  else delete storyboard.excludedTags[key];
  return true;
}

export function removeStoryboardTag(storyboard, no, cat, name) {
  if (!storyboard) return false;
  const key = String(no);
  if (!storyboard.manualTags || typeof storyboard.manualTags !== 'object') storyboard.manualTags = {};
  const manualList = Array.isArray(storyboard.manualTags[key]) ? storyboard.manualTags[key] : [];
  const manualIdx = manualList.findIndex((item) => item.cat === cat && item.name === name);
  if (manualIdx >= 0) {
    const [removed] = manualList.splice(manualIdx, 1);
    if (manualList.length) storyboard.manualTags[key] = manualList;
    else delete storyboard.manualTags[key];
    const overrideCategory = removed?.source === 'look'
      ? 'character'
      : ((removed?.source === 'sceneArea' || removed?.assetKind === 'sceneArea') ? 'scene' : '');
    if (overrideCategory && removed.ownerName && storyboard.excludedTags?.[key]) {
      storyboard.excludedTags[key] = storyboard.excludedTags[key].filter(
        (item) => !(
          item.cat === overrideCategory
          && (item.ownerName === removed.ownerName || (overrideCategory === 'scene' && item.name === removed.ownerName))
          && (item.source === removed.source || (overrideCategory === 'scene' && item.source === 'ai'))
        ),
      );
      if (!storyboard.excludedTags[key].length) delete storyboard.excludedTags[key];
    }
    excludeStoryboardTag(storyboard, key, { ...removed, cat, name });
  } else {
    excludeStoryboardTag(storyboard, key, { cat, name });
  }
  return true;
}

export function reuseStoryboardShotElements(storyboard, no, tags = [], currentTags = []) {
  if (!storyboard) return { total: 0, removed: 0, excluded: 0, restored: 0, changed: false };
  const reusable = [];
  const seen = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const cat = String(tag?.cat || '').trim();
    const name = String(tag?.name || '').trim();
    if (!ELEMENT_CATEGORIES.includes(cat) || !name) continue;
    const tagKey = `${cat}:${name}`;
    if (seen.has(tagKey)) continue;
    seen.add(tagKey);
    reusable.push({
      cat,
      name,
      ...(
        ((tag?.source === 'look' && cat === 'character') || (tag?.source === 'sceneArea' && cat === 'scene'))
        && tag?.ownerName
          ? { source: tag.source, ownerName: tag.ownerName }
          : (cat === 'scene' && tag?.assetKind === 'sceneArea' && tag?.ownerName
            ? { assetKind: 'sceneArea', ownerName: tag.ownerName }
            : {})
      ),
    });
  }
  if (!reusable.length) return { total: 0, removed: 0, excluded: 0, restored: 0, changed: false };

  const key = String(no);
  if (!storyboard.manualTags || typeof storyboard.manualTags !== 'object') storyboard.manualTags = {};
  const previousManualTags = Array.isArray(storyboard.manualTags[key]) ? storyboard.manualTags[key] : [];
  const previousManualKeys = new Set(previousManualTags.map((tag) => `${tag?.cat}:${tag?.name}`));
  const removed = [...previousManualKeys].filter((tagKey) => !seen.has(tagKey)).length;

  const previousExcludedTags = (
    storyboard.excludedTags
    && typeof storyboard.excludedTags === 'object'
    && Array.isArray(storyboard.excludedTags[key])
  ) ? storyboard.excludedTags[key] : [];
  const nextExcludedTags = [];
  const nextExcludedKeys = new Set();
  let restored = 0;
  const addExcludedTag = (tag) => {
    const cat = String(tag?.cat || '').trim();
    const name = String(tag?.name || '').trim();
    if (!ELEMENT_CATEGORIES.includes(cat) || !name) return false;
    const tagKey = `${cat}:${name}`;
    if (seen.has(tagKey) || nextExcludedKeys.has(tagKey)) return false;
    nextExcludedKeys.add(tagKey);
    nextExcludedTags.push({ cat, name });
    return true;
  };
  for (const tag of previousExcludedTags) {
    if (seen.has(`${tag?.cat}:${tag?.name}`)) restored += 1;
    else addExcludedTag(tag);
  }
  let excluded = 0;
  for (const tag of Array.isArray(currentTags) ? currentTags : []) {
    if (addExcludedTag(tag)) excluded += 1;
  }

  const reusableKeys = new Set(reusable.map((tag) => `${tag.cat}:${tag.name}`));
  const manualChanged = reusableKeys.size !== previousManualKeys.size
    || [...reusableKeys].some((tagKey) => !previousManualKeys.has(tagKey));
  const previousExcludedKeys = new Set(previousExcludedTags.map((tag) => `${tag?.cat}:${tag?.name}`));
  const exclusionsChanged = nextExcludedKeys.size !== previousExcludedKeys.size
    || [...nextExcludedKeys].some((tagKey) => !previousExcludedKeys.has(tagKey));
  const changed = manualChanged || exclusionsChanged;
  if (changed) {
    storyboard.manualTags[key] = reusable;
    if (!storyboard.excludedTags || typeof storyboard.excludedTags !== 'object') storyboard.excludedTags = {};
    if (nextExcludedTags.length) storyboard.excludedTags[key] = nextExcludedTags;
    else delete storyboard.excludedTags[key];
  }
  return {
    total: reusable.length,
    removed,
    excluded,
    restored,
    changed,
  };
}

export function reuseStoryboardShotOpenerFrame(storyboard, no, sourceNo) {
  const source = storyboard?.openerFrames?.[String(sourceNo)];
  if (!source || source.fromShotNo == null) return { reused: false, changed: false, meta: null };

  const key = String(no);
  const current = storyboard?.openerFrames?.[key];
  const sourceName = normalizeOpenerFrameName(source.name || source.label);
  const currentName = normalizeOpenerFrameName(current?.name || current?.label);
  const changed = !current
    || String(current.fromShotNo) !== String(source.fromShotNo)
    || String(current.url || '') !== String(source.url || '')
    || currentName !== sourceName;
  if (!changed) return { reused: true, changed: false, meta: current };

  if (!storyboard.openerFrames || typeof storyboard.openerFrames !== 'object') storyboard.openerFrames = {};
  const meta = createShotOpenerFrameMeta(source.fromShotNo, source.url, sourceName);
  storyboard.openerFrames[key] = meta;
  return { reused: true, changed: true, meta };
}

export function optionalShotNoNumber(value) {
  if (value == null) return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;
  const number = Number(raw);
  return Number.isFinite(number) ? number : NaN;
}

export function shotsInNumberRange(shots, { shot = null, fromNo = null, toNo = null } = {}) {
  if (shot) return [shot];
  let list = Array.isArray(shots) ? shots.slice() : [];
  const from = optionalShotNoNumber(fromNo);
  const to = optionalShotNoNumber(toNo);
  if (Number.isFinite(from) || Number.isFinite(to)) {
    const lo = Math.min(Number.isFinite(from) ? from : -Infinity, Number.isFinite(to) ? to : Infinity);
    const hi = Math.max(Number.isFinite(from) ? from : -Infinity, Number.isFinite(to) ? to : Infinity);
    list = list.filter((item) => {
      const no = Number(item?.no);
      return Number.isFinite(no) && no >= lo && no <= hi;
    });
  }
  return list;
}

export function shotNoBounds(shots) {
  const numbers = (Array.isArray(shots) ? shots : [])
    .map((shot) => Number(shot?.no))
    .filter(Number.isFinite);
  if (!numbers.length) return null;
  return { fromNo: Math.min(...numbers), toNo: Math.max(...numbers) };
}

export function normalizeShotNoRange(fromNo, toNo) {
  const from = optionalShotNoNumber(fromNo);
  const to = optionalShotNoNumber(toNo);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return from <= to ? { fromNo: from, toNo: to } : { fromNo: to, toNo: from };
}

export function openAiBindRangeDialogFlow(dialog, shots, handlers = {}) {
  if (handlers.isRunning()) return handlers.warning('AI binding is already running');
  if (!shots.length) return handlers.warning('No shots in current episode');
  const bounds = shotNoBounds(shots);
  if (!bounds) return handlers.warning('Invalid shot number range');
  dialog.fromNo = bounds.fromNo;
  dialog.toNo = bounds.toNo;
  dialog.visible = true;
}

export function confirmAiBindRangeFlow(dialog, handlers = {}) {
  const range = normalizeShotNoRange(dialog.fromNo, dialog.toNo);
  if (!range) return handlers.warning('Please enter a valid shot range');
  dialog.visible = false;
  handlers.runBinding({ ...range, scope: 'range' });
}

export function storyboardBindingRangeParams({ shot = null, fromNo = null, toNo = null } = {}) {
  const shotNoText = shot ? String(shot.no ?? '').trim() : '';
  const shotNoNumber = Number(shotNoText);
  const useShotAsRange = !!shot && Number.isFinite(shotNoNumber);
  const payloadFromNo = useShotAsRange ? shotNoNumber : optionalShotNoNumber(fromNo);
  const payloadToNo = useShotAsRange ? shotNoNumber : optionalShotNoNumber(toNo);
  return {
    shotNo: shot && !useShotAsRange ? shot.no : undefined,
    fromNo: Number.isFinite(payloadFromNo) ? payloadFromNo : undefined,
    toNo: Number.isFinite(payloadToNo) ? payloadToNo : undefined,
  };
}

export function currentAutoTagsForAiBinding(shots, shotTags) {
  return (Array.isArray(shots) ? shots : []).map((shot) => {
    const seen = new Set();
    const tags = [];
    for (const tag of shotTags(shot)) {
      if (tag.manual) continue;
      const key = `${tag.cat}:${tag.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push({ cat: tag.cat, name: tag.name });
    }
    return { shotNo: String(shot.no), tags };
  });
}

export function applyStoryboardBindingUpdate(storyboards, updated) {
  if (!updated || updated.episodeId == null || !Array.isArray(storyboards)) return;
  const normalized = {
    ...updated,
    manualTags: (updated.manualTags && typeof updated.manualTags === 'object') ? updated.manualTags : {},
    excludedTags: (updated.excludedTags && typeof updated.excludedTags === 'object') ? updated.excludedTags : {},
  };
  const index = storyboards.findIndex((storyboard) => String(storyboard.episodeId) === String(updated.episodeId));
  if (index >= 0) storyboards.splice(index, 1, { ...storyboards[index], ...normalized });
  else storyboards.push(normalized);
}

export async function runAiElementBindingFlow({ shot = null, fromNo = null, toNo = null, scope = 'all' } = {}, handlers = {}) {
  if (handlers.isRunning()) return handlers.warning('AI绑定正在进行中');
  if (handlers.hasActiveShotEdit()) return handlers.warning('请先保存或取消当前正在编辑的镜头');
  const project = handlers.project();
  if (!project) return;
  const storyboard = handlers.storyboard();
  if (!storyboard || !String(storyboard.content || '').trim()) return handlers.warning('当前集还没有分镜');
  if (!handlers.projectElementTotal()) return handlers.warning('元素库为空，请先提取或新增元素');
  const targets = handlers.targets({ shot, fromNo, toNo });
  if (!targets.length) return handlers.warning('没有找到要推理的分镜');

  handlers.setBindingState({
    running: true,
    scope,
    activeShotNo: shot ? String(shot.no) : '',
  });
  try {
    await handlers.saveScript();
    const rangeParams = storyboardBindingRangeParams({ shot, fromNo, toNo });
    const result = await handlers.bindElements({
      projectId: handlers.project().id,
      episodeId: handlers.episodeId(),
      ...rangeParams,
      replaceAuto: true,
      currentAutoTags: currentAutoTagsForAiBinding(targets, handlers.shotTags),
    });
    if (!result.ok) throw new Error(result.error || 'AI绑定失败');
    applyStoryboardBindingUpdate(handlers.storyboards(), result.storyboard);
    const rangeText = shot
      ? `镜头 ${shot.no}`
      : (rangeParams.fromNo !== undefined || rangeParams.toNo !== undefined ? `范围 ${fromNo}~${toNo}` : '全部分镜');
    const excludedText = result.excluded ? `，排除 ${result.excluded} 个误匹配` : '';
    const skippedText = result.skippedUserExcluded ? `，保留 ${result.skippedUserExcluded} 个用户排除` : '';
    const processedShots = result.processedShots || result.totalShots || targets.length;
    const failedShotNos = Array.isArray(result.failedShotNos) ? result.failedShotNos : [];
    const invalidText = result.invalidElementCount ? `，忽略 ${result.invalidElementCount} 个无效元素名` : '';
    if (result.partial || failedShotNos.length) {
      const failedText = failedShotNos.length ? `；未改动镜头 ${failedShotNos.join('、')}` : '';
      handlers.warning(`${rangeText} AI绑定部分完成：已确认 ${processedShots}/${result.totalShots || targets.length} 镜，绑定 ${result.bound || 0} 个元素${excludedText}${skippedText}${invalidText}${failedText}`);
    } else {
      handlers.success(`${rangeText} AI绑定完成：${processedShots} 镜，绑定 ${result.bound || 0} 个元素${excludedText}${skippedText}${invalidText}`);
    }
  } catch (error) {
    handlers.error(error.message || 'AI绑定失败');
  } finally {
    handlers.setBindingState({ running: false, scope: '', activeShotNo: '' });
  }
}

export function createAiElementBindingContext(handlers = {}) {
  return {
    ...handlers.message,
    isRunning: () => handlers.aiBinding.running,
    hasActiveShotEdit: () => !!handlers.shotEdit.key,
    project: handlers.project,
    storyboard: handlers.storyboard,
    projectElementTotal: handlers.projectElementTotal,
    targets: handlers.targets,
    setBindingState: (state) => Object.assign(handlers.aiBinding, state),
    saveScript: handlers.saveScript,
    bindElements: (payload) => handlers.api.post(
      '/api/project/storyboard/ai-bind-elements',
      payload,
      { timeoutMs: AI_ELEMENT_BINDING_TIMEOUT_MS },
    ),
    episodeId: handlers.episodeId,
    shotTags: handlers.shotTags,
    storyboards: handlers.storyboards,
  };
}

export function createAiElementBindingRuntimeContext({ api, message, refs = {}, helpers = {} } = {}) {
  return createAiElementBindingContext({
    api,
    message,
    aiBinding: refs.aiBinding,
    shotEdit: refs.shotEdit,
    project: () => refs.project.value,
    storyboard: () => helpers.findStoryboard(refs.episodeId.value),
    projectElementTotal: helpers.projectElementTotal,
    targets: helpers.targets,
    saveScript: helpers.saveScript,
    episodeId: () => refs.episodeId.value,
    shotTags: helpers.shotTags,
    storyboards: () => refs.scriptState.storyboards,
  });
}

export async function shiftShotFilesFlow({ fromNo, delta, removeNo = null } = {}, handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  try {
    const result = await handlers.shiftFiles({
      projectId: project.id,
      episodeId: handlers.episodeId(),
      fromNo,
      delta,
      removeNo,
    });
    if (result && result.ok === false) handlers.warning(result.error || 'Local video file sync failed');
  } catch (error) {
    handlers.warning('Local video file sync failed: ' + (error.message || error));
  }
}

export function createShiftShotFilesContext(handlers = {}) {
  return {
    project: handlers.project,
    episodeId: handlers.episodeId,
    shiftFiles: (payload) => handlers.api.post('/api/video/shot-files/shift', payload),
    warning: handlers.message.warning,
  };
}

export function createShotEditListContext(handlers = {}) {
  return {
    ...handlers.message,
    storyboard: handlers.storyboard,
    hasActiveShotEdit: () => !!handlers.shotEdit.key,
    shots: handlers.shots,
    hydratePending: handlers.hydratePending,
    hasActiveShotAtOrAfter: handlers.hasActiveShotAtOrAfter,
    shiftShotVideoMeta: handlers.shiftShotVideoMeta,
    shotVideos: () => handlers.shotVideos,
    shotStatus: () => handlers.shotStatus,
    episodeId: handlers.episodeId,
    shiftRuntimeShotVideo: handlers.shiftRuntimeShotVideo,
    remapVideoQueueShotNos: handlers.remapVideoQueueShotNos,
    cancelShotEdit: handlers.cancelShotEdit,
    saveScript: handlers.saveScript,
    shiftShotFiles: handlers.shiftShotFiles,
    nextTick: handlers.nextTick,
    startShotEdit: handlers.startShotEdit,
  };
}

export function createShotEditListRuntimeContext({ message, refs = {}, helpers = {} } = {}) {
  return {
    message,
    storyboard: () => helpers.findStoryboard(refs.episodeId.value),
    shotEdit: refs.shotEdit,
    shots: () => refs.currentShots.value,
    hydratePending: helpers.hydratePending,
    hasActiveShotAtOrAfter: helpers.hasActiveShotAtOrAfter,
    shiftShotVideoMeta: helpers.shiftShotVideoMeta,
    shotVideos: refs.shotVideos,
    shotStatus: refs.shotStatus,
    episodeId: () => refs.episodeId.value,
    shiftRuntimeShotVideo: helpers.shiftRuntimeShotVideo,
    remapVideoQueueShotNos: helpers.remapVideoQueueShotNos,
    cancelShotEdit: helpers.cancelShotEdit,
    saveScript: helpers.saveScript,
    shiftShotFiles: helpers.shiftShotFiles,
    nextTick: helpers.nextTick,
    startShotEdit: helpers.startShotEdit,
  };
}

export function createDeleteShotContext(handlers = {}) {
  return {
    ...createShotEditListContext(handlers),
    confirmDelete: handlers.confirmDelete,
    removeQueuedShotNo: handlers.removeQueuedShotNo,
  };
}

export function createDeleteShotRuntime({ getContext, context, message, refs = {}, helpers = {} } = {}) {
  const resolveContext = typeof getContext === 'function'
    ? getContext
    : typeof context === 'function'
      ? context
      : () => context || createShotEditListRuntimeContext({ message, refs, helpers });
  return (shot) => deleteShotFlow(shot, createDeleteShotContext({
    ...resolveContext(),
    confirmDelete: helpers.confirmDelete,
    removeQueuedShotNo: helpers.removeQueuedShotNo,
  }));
}

export async function deleteShotFlow(shot, handlers = {}) {
  const storyboard = handlers.storyboard();
  if (!storyboard || !shot) return;
  if (handlers.hasActiveShotEdit()) return handlers.warning('请先保存或取消当前正在编辑的镜头');
  const shots = handlers.shots();
  if (shots.length <= 1) return handlers.warning('至少保留一个分镜');
  const oldNo = Number(shot.no);
  if (!Number.isFinite(oldNo)) return handlers.warning('无法识别当前分镜编号');
  const lockedWouldMove = Object.entries(storyboard.shotMeta || {}).some(([no, meta]) => (
    meta?.locked === true && Number(no) >= oldNo
  ));
  if (lockedWouldMove) return handlers.warning('删除会移动已锁定镜头，请先解锁相关镜头');
  await handlers.hydratePending();
  if (handlers.hasActiveShotAtOrAfter(oldNo)) {
    return handlers.warning('当前或后续镜头有已提交/生成中的视频，请先清除追踪或等完成后再删除分镜');
  }
  const confirmed = await handlers.confirmDelete(shot);
  if (!confirmed) return;

  const remaining = shots.filter((item) => item.index !== shot.index);
  storyboard.content = remaining.map((item, index) => `分镜${index + 1}：\n${String(item.body || '').trim()}`).join('\n\n');

  removeShotMapKey(storyboard.manualTags, oldNo);
  removeShotMapKey(storyboard.excludedTags, oldNo);
  removeShotMapKey(storyboard.shotVideos, oldNo);
  removeShotMapKey(storyboard.shotMeta, oldNo);
  storyboard.manualTags = shiftShotMap(storyboard.manualTags, oldNo + 1, -1) || {};
  storyboard.excludedTags = shiftShotMap(storyboard.excludedTags, oldNo + 1, -1) || {};
  storyboard.shotVideos = shiftShotMap(storyboard.shotVideos, oldNo + 1, -1, handlers.shiftShotVideoMeta) || {};
  storyboard.shotMeta = shiftShotMap(storyboard.shotMeta, oldNo + 1, -1) || {};

  removeRuntimeShotKey(handlers.shotVideos(), handlers.episodeId(), oldNo);
  removeRuntimeShotKey(handlers.shotStatus(), handlers.episodeId(), oldNo);
  shiftRuntimeShotMap(handlers.shotVideos(), handlers.episodeId(), oldNo + 1, -1, handlers.shiftRuntimeShotVideo);
  shiftRuntimeShotMap(handlers.shotStatus(), handlers.episodeId(), oldNo + 1, -1);
  handlers.removeQueuedShotNo(oldNo);
  handlers.remapVideoQueueShotNos(handlers.episodeId(), oldNo + 1, -1);

  handlers.cancelShotEdit();
  handlers.saveScript();
  handlers.shiftShotFiles(oldNo + 1, -1, oldNo);
  handlers.success(`已删除镜头 ${shot.no}`);
}

export async function insertShotAfterFlow(shot, handlers = {}, options = {}) {
  const storyboard = handlers.storyboard();
  if (!storyboard) return;
  if (handlers.hasActiveShotEdit()) return handlers.warning('请先保存或取消当前正在编辑的镜头');
  const afterNo = Number(shot?.no || handlers.shots().length || 0);
  if (!Number.isFinite(afterNo)) return handlers.warning('无法识别当前分镜编号');
  const newNo = afterNo + 1;
  const lockedWouldMove = Object.entries(storyboard.shotMeta || {}).some(([no, meta]) => (
    meta?.locked === true && Number(no) >= newNo
  ));
  if (lockedWouldMove) return handlers.warning('添加会移动已锁定镜头，请先解锁相关镜头');
  await handlers.hydratePending();
  if (handlers.hasActiveShotAtOrAfter(newNo)) {
    return handlers.warning('后续镜头有已提交或生成中的视频，请先清除追踪或等完成后再添加分镜');
  }

  const inheritedPrefix = normalizeShotHeaderPrefix(storyboard.videoPromptPrefix);
  const insertBody = options.insertBody != null ? String(options.insertBody) : (inheritedPrefix || defaultShotBody());
  // 拆分场景：先把当前镜头的正文换成「上半段」，再在本镜头后插入「下半段」。
  const baseContent = options.currentBody != null
    ? replaceShotBodyInStoryboardContent(storyboard.content, shot, options.currentBody)
    : storyboard.content;
  storyboard.content = renumberShotText(baseContent, newNo, insertBody);
  storyboard.manualTags = shiftShotMap(storyboard.manualTags, newNo, 1) || {};
  storyboard.excludedTags = shiftShotMap(storyboard.excludedTags, newNo, 1) || {};
  storyboard.shotVideos = shiftShotMap(storyboard.shotVideos, newNo, 1, handlers.shiftShotVideoMeta) || {};
  storyboard.shotMeta = shiftShotMap(storyboard.shotMeta, newNo, 1) || {};
  const withDuration = (map, no, seconds) => (
    Number.isFinite(Number(seconds))
      ? { ...(map || {}), [no]: { ...(map?.[no] || {}), duration: Math.round(Number(seconds)) } }
      : map
  );
  storyboard.shotMeta = withDuration(storyboard.shotMeta, afterNo, options.currentSeconds);
  storyboard.shotMeta = withDuration(storyboard.shotMeta, newNo, options.insertSeconds);
  shiftRuntimeShotMap(handlers.shotVideos(), handlers.episodeId(), newNo, 1, handlers.shiftRuntimeShotVideo);
  shiftRuntimeShotMap(handlers.shotStatus(), handlers.episodeId(), newNo, 1);
  handlers.remapVideoQueueShotNos(handlers.episodeId(), newNo, 1);
  handlers.cancelShotEdit();
  handlers.saveScript();
  handlers.shiftShotFiles(newNo, 1);
  handlers.nextTick(() => {
    const nextShot = handlers.shots().find((item) => String(item.no) === String(newNo));
    if (nextShot) handlers.startShotEdit(nextShot);
  });
  handlers.success(options.successMessage || `已在镜头 ${afterNo} 后添加镜头 ${newNo}`);
}

// 把新镜头插到「第 N 镜之前」——insertShotAfterFlow 的姊妹函数，用于"插到最前面做开场"这类需求。
// 与 after 版的关键差异：这里**不改写任何镜头的时长**。after 版是给"拆分镜头"用的，会把上下两段的
// 秒数显式写回；而"前插一个全新镜头"应该让新镜头的时长来自它自己的时间码，原有镜头在平移中保留原设置。
export async function insertShotBeforeFlow(shot, handlers = {}, options = {}) {
  const storyboard = handlers.storyboard();
  if (!storyboard) return;
  if (handlers.hasActiveShotEdit()) return handlers.warning('请先保存或取消当前正在编辑的镜头');
  const insertAtNo = Number(shot?.no);
  if (!Number.isFinite(insertAtNo) || insertAtNo < 1) return handlers.warning('无法识别当前分镜编号');
  const lockedWouldMove = Object.entries(storyboard.shotMeta || {}).some(([no, meta]) => (
    meta?.locked === true && Number(no) >= insertAtNo
  ));
  if (lockedWouldMove) return handlers.warning('插入会移动已锁定镜头，请先解锁相关镜头');
  await handlers.hydratePending();
  if (handlers.hasActiveShotAtOrAfter(insertAtNo)) {
    return handlers.warning('后续镜头有已提交或生成中的视频，请先清除追踪或等完成后再插入分镜');
  }

  const inheritedPrefix = normalizeShotHeaderPrefix(storyboard.videoPromptPrefix);
  const insertBody = options.insertBody != null ? String(options.insertBody) : (inheritedPrefix || defaultShotBody());
  storyboard.content = renumberShotText(storyboard.content, insertAtNo, insertBody);
  storyboard.manualTags = shiftShotMap(storyboard.manualTags, insertAtNo, 1) || {};
  storyboard.excludedTags = shiftShotMap(storyboard.excludedTags, insertAtNo, 1) || {};
  storyboard.shotVideos = shiftShotMap(storyboard.shotVideos, insertAtNo, 1, handlers.shiftShotVideoMeta) || {};
  storyboard.shotMeta = shiftShotMap(storyboard.shotMeta, insertAtNo, 1) || {};
  shiftRuntimeShotMap(handlers.shotVideos(), handlers.episodeId(), insertAtNo, 1, handlers.shiftRuntimeShotVideo);
  shiftRuntimeShotMap(handlers.shotStatus(), handlers.episodeId(), insertAtNo, 1);
  handlers.remapVideoQueueShotNos(handlers.episodeId(), insertAtNo, 1);
  handlers.cancelShotEdit();
  handlers.saveScript();
  handlers.shiftShotFiles(insertAtNo, 1);
  handlers.nextTick(() => {
    const inserted = handlers.shots().find((item) => String(item.no) === String(insertAtNo));
    if (inserted) handlers.startShotEdit(inserted);
  });
  handlers.success(options.successMessage || `已在镜头 ${insertAtNo} 前插入新镜头 ${insertAtNo}`);
}

// 把超长镜头（如 30 秒）按时间码块拆成两段等长镜头，各段时间码从 0 秒重标，
// 下半段沿用同一场景并自动生成承接上半段结尾的「承接定帧」，便于换成只支持 15 秒的模型。
// 镜头完全没有时间码时（自定义分镜提示词常见），退化为按段落均分地「拆内容」：
// 两段各自沿用原时长设置，不重标时间码，所以不会凭空编造时长。
export async function splitShotIntoTwoHalvesFlow(shot, handlers = {}) {
  const body = normalizeShotEditBody(shot?.body);
  const maxSeconds = Math.max(4, Math.round(Number(handlers.maxSeconds) || 15));
  const byTimeCode = canSplitShotBody(body, { maxSeconds });
  const byParagraph = !byTimeCode && canSplitShotByParagraphs(body);
  if (!byTimeCode && !byParagraph) {
    handlers.warning?.(`这个镜头不足两个时间码块，或时长没有超过 ${maxSeconds} 秒；正文也没有可拆分的段落`);
    return null;
  }
  const split = byTimeCode ? splitShotBodyInHalf(body) : splitShotBodyByParagraphs(body);
  if (!split) {
    handlers.warning?.('这个镜头无法拆分');
    return null;
  }
  const confirmed = await handlers.confirm?.({
    byParagraph,
    shotNo: shot?.no,
    totalSeconds: split.totalSeconds,
    firstSeconds: split.firstSeconds,
    secondSeconds: split.secondSeconds,
    blockCount: split.blockCount,
    paragraphCount: split.paragraphCount,
  });
  if (!confirmed) return null;
  await insertShotAfterFlow(shot, handlers, byTimeCode
    ? {
      currentBody: split.first,
      insertBody: split.second,
      currentSeconds: split.firstSeconds,
      insertSeconds: split.secondSeconds,
      successMessage: `镜头 ${shot?.no} 已拆成两个约 ${split.firstSeconds} 秒的镜头，可直接用 ${maxSeconds} 秒模型提交`,
    }
    : {
      // 不传 currentSeconds/insertSeconds：没有时间码就不该替用户猜时长，两段沿用原镜头时长设置。
      currentBody: split.first,
      insertBody: split.second,
      successMessage: `镜头 ${shot?.no} 已按段落拆成两个镜头（原镜头没有时间码，两段时长沿用默认值，请各自确认）`,
    });
  return split;
}

export function shotEditKey(episodeId, shot) {
  return `${episodeId}:${shot?.no}:${shot?.index || 0}`;
}

export function isShotEditingState(editState, episodeId, shot) {
  return editState.key === shotEditKey(episodeId, shot);
}

export function startShotEditState(editState, episodeId, shot) {
  editState.key = shotEditKey(episodeId, shot);
  editState.text = shot?.body || '';
}

export function cancelShotEditState(editState) {
  editState.key = '';
  editState.text = '';
}

export const AI_ELEMENT_BINDING_TIMEOUT_MS = 30 * 60 * 1000;
const LEADING_SHOT_HEADER_RE = /^(?:\u5206\u955c\s*\d+\s*[\uFF1A:]|\u3010(?:\u5206\u955c|\u955c\u5934)\s*\d+\u3011)[ \t]*(?:\r?\n)?/;

export function normalizeShotEditBody(value) {
  let body = String(value || '').trim();
  let match = body.match(LEADING_SHOT_HEADER_RE);
  while (match) {
    body = body.slice(match[0].length).trim();
    match = body.match(LEADING_SHOT_HEADER_RE);
  }
  return body;
}

export function replaceShotBodyInStoryboardContent(content, shot, nextBody) {
  const body = normalizeShotEditBody(nextBody);
  if (shot?.fallback) return body;
  const source = String(content || '');
  const header = source.slice(shot.start, shot.headEnd).trimEnd();
  const before = source.slice(0, shot.start);
  const after = source.slice(shot.end);
  const separator = after && !after.startsWith('\n') ? '\n\n' : '';
  return `${before}${header}\n${body}${separator}${after}`;
}

// 分镜编辑框有 12~24 行，往往比视口还高。只看元素自身的可见比例，就必须把整个
// 编辑框都滚出屏幕才会触发自动保存；改用元素高度与视口高度里较小的那个作基准。
export const SHOT_EDIT_AUTOSAVE_VISIBLE_RATIO = 0.35;
export const SHOT_EDIT_AUTOSAVE_THRESHOLDS = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1];

export function shotEditVisibleRatio(entry) {
  if (!entry) return 0;
  const visible = Number(entry.intersectionRect?.height) || 0;
  const elementHeight = Number(entry.boundingClientRect?.height) || 0;
  const viewportHeight = Number(entry.rootBounds?.height) || 0;
  const bases = [elementHeight, viewportHeight].filter((value) => value > 0);
  if (!bases.length) return entry.isIntersecting ? 1 : 0;
  return visible / Math.min(...bases);
}

export function shouldAutoSaveShotEdit(entry, threshold = SHOT_EDIT_AUTOSAVE_VISIBLE_RATIO) {
  if (!entry) return false;
  if (!entry.isIntersecting) return true;
  return shotEditVisibleRatio(entry) < threshold;
}

export function saveShotEditFlow(shot, editState, handlers = {}) {
  const storyboard = handlers.storyboard();
  if (!storyboard || !isShotEditingState(editState, handlers.episodeId(), shot)) return false;
  if (storyboard.shotMeta?.[String(shot?.no)]?.locked === true) {
    handlers.warning('该镜头已锁定，请先解锁');
    return false;
  }
  const nextBody = normalizeShotEditBody(editState.text);
  // 新插入的分镜正文本来就是空的，原样失焦属于「什么都没改」，直接退出编辑态。
  if (nextBody === normalizeShotEditBody(shot?.body)) {
    cancelShotEditState(editState);
    return false;
  }
  // 编辑框只在失焦或滚动出屏时自动保存，没有显式保存按钮。
  // 清空正文不能落盘（会打乱分镜编号），但也不能把用户锁在编辑态里，所以恢复原文并退出。
  if (!nextBody) {
    cancelShotEditState(editState);
    handlers.warning('分镜内容不能为空，已恢复原内容');
    return false;
  }
  storyboard.content = replaceShotBodyInStoryboardContent(storyboard.content, shot, nextBody);
  cancelShotEditState(editState);
  handlers.saveScript();
  handlers.success(`分镜 ${shot.no} 已保存`);
  return true;
}

export function createShotCardActionsRuntime({ api, message, messageBox, refs = {}, helpers = {}, globals = {} } = {}) {
  const projectElementTotalForCurrentProject = () => projectElementTotal(refs.project.value);
  const aiBindingTargets = ({ shot = null, fromNo = null, toNo = null } = {}) => (
    shotsInNumberRange(refs.currentShots.value, { shot, fromNo, toNo }).filter((item) => !helpers.isShotLocked?.(item))
  );

  const runAiElementBinding = ({ shot = null, fromNo = null, toNo = null, scope = 'all' } = {}) => (
    runAiElementBindingFlow({ shot, fromNo, toNo, scope }, createAiElementBindingRuntimeContext({
      api,
      message,
      refs: {
        aiBinding: refs.aiBinding,
        shotEdit: refs.shotEdit,
        project: refs.project,
        episodeId: refs.episodeId,
        scriptState: refs.scriptState,
      },
      helpers: {
        findStoryboard: helpers.findStoryboard,
        projectElementTotal: projectElementTotalForCurrentProject,
        targets: aiBindingTargets,
        saveScript: helpers.saveScriptNow,
        shotTags: helpers.shotTags,
        isShotLocked: helpers.isShotLocked,
      },
    }))
  );

  const openAiBindRangeDialog = () => openAiBindRangeDialogFlow(refs.aiBindRangeDialog, refs.currentShots.value, {
    isRunning: () => refs.aiBinding.running,
    warning: message.warning,
  });

  const confirmAiBindRange = () => confirmAiBindRangeFlow(refs.aiBindRangeDialog, {
    runBinding: runAiElementBinding,
    warning: message.warning,
  });

  const shotEditKeyForCurrentEpisode = (shot) => shotEditKey(refs.episodeId.value, shot);
  const isShotEditing = (shot) => isShotEditingState(refs.shotEdit, refs.episodeId.value, shot);
  let shotEditObserver = null;
  let activeShotEditor = null;
  const shotEditorOriginalHtml = new WeakMap();
  const stopShotEditAutoSave = () => {
    shotEditObserver?.disconnect?.();
    shotEditObserver = null;
  };
  const shotEditorText = (editor) => String(editor?.innerText ?? '').replace(/\u00a0/g, ' ');
  const updateShotEditText = (eventOrEditor) => {
    const editor = eventOrEditor?.currentTarget || eventOrEditor || activeShotEditor;
    if (!refs.shotEdit.key || !editor) return refs.shotEdit.text;
    refs.shotEdit.text = shotEditorText(editor);
    return refs.shotEdit.text;
  };
  const saveShotEdit = (shot) => {
    const wasEditing = isShotEditing(shot);
    if (wasEditing) updateShotEditText(activeShotEditor);
    const saved = saveShotEditFlow(shot, refs.shotEdit, {
      storyboard: () => helpers.findStoryboard(refs.episodeId.value),
      episodeId: () => refs.episodeId.value,
      saveScript: helpers.saveScriptDebounced,
      warning: message.warning,
      success: message.success,
    });
    if (wasEditing && !isShotEditing(shot)) {
      stopShotEditAutoSave();
      if (activeShotEditor) {
        if (!saved && shotEditorOriginalHtml.has(activeShotEditor)) {
          activeShotEditor.innerHTML = shotEditorOriginalHtml.get(activeShotEditor);
        }
        shotEditorOriginalHtml.delete(activeShotEditor);
      }
      activeShotEditor = null;
    }
    return saved;
  };
  const startShotEditAutoSave = (editor) => {
    stopShotEditAutoSave();
    const Observer = globals.window?.IntersectionObserver;
    if (!editor || typeof Observer !== 'function') return;
    let wasVisible = false;
    shotEditObserver = new Observer((entries) => {
      const entry = entries[entries.length - 1];
      if (!shouldAutoSaveShotEdit(entry)) {
        if (entry?.isIntersecting) wasVisible = true;
        return;
      }
      if (!wasVisible) return;
      const activeShot = refs.currentShots.value.find((item) => isShotEditing(item));
      if (activeShot) saveShotEdit(activeShot);
      else stopShotEditAutoSave();
    }, { threshold: SHOT_EDIT_AUTOSAVE_THRESHOLDS });
    shotEditObserver.observe(editor);
  };
  const activateShotEditor = (editor, { focus = false, text = null } = {}) => {
    if (!editor) return;
    activeShotEditor = editor;
    if (!shotEditorOriginalHtml.has(editor)) {
      shotEditorOriginalHtml.set(editor, editor.innerHTML);
      if (text != null) editor.textContent = String(text);
    }
    startShotEditAutoSave(editor);
    if (focus && globals.document?.activeElement !== editor) editor.focus?.({ preventScroll: true });
  };
  const startShotEdit = (shot, editor = null) => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (storyboard?.shotMeta?.[String(shot?.no)]?.locked === true) {
      return message.warning('该镜头已锁定，请先解锁');
    }
    if (!isShotEditing(shot)) startShotEditState(refs.shotEdit, refs.episodeId.value, shot);
    if (editor) {
      activateShotEditor(editor, { text: refs.shotEdit.text });
      return true;
    }
    helpers.nextTick?.(() => {
      const inlineEditor = globals.document?.querySelector?.('.shot-card.is-editing .shot-body[contenteditable="plaintext-only"]');
      activateShotEditor(inlineEditor, { focus: true, text: refs.shotEdit.text });
    });
    return true;
  };
  const finishShotEdit = (shot, event) => {
    updateShotEditText(event);
    return saveShotEdit(shot);
  };
  const cancelShotEdit = (editor = activeShotEditor) => {
    if (editor && shotEditorOriginalHtml.has(editor)) {
      editor.innerHTML = shotEditorOriginalHtml.get(editor);
      shotEditorOriginalHtml.delete(editor);
    }
    stopShotEditAutoSave();
    cancelShotEditState(refs.shotEdit);
    activeShotEditor = null;
    editor?.blur?.();
  };

  const focusElement = (tag) => {
    refs.category.value = tag.cat;
    refs.elementsDrawer.value = true;
  };

  const editElementBindingName = (tag) => editElementBindingNameFlow(tag, createEditElementBindingNameRuntimeContext({
    api,
    message,
    refs: { project: refs.project },
    ui: { prompt: messageBox.prompt },
  }));

  const buildShotPromptBodyForHeader = (shot, openerFrameName = '') => (
    buildShotPromptBody(shot, refs.shotHeaderPrefix.value, openerFrameName)
  );

  return {
    projectElementTotal: projectElementTotalForCurrentProject,
    aiBindingTargets,
    runAiElementBinding,
    openAiBindRangeDialog,
    confirmAiBindRange,
    shotEditKey: shotEditKeyForCurrentEpisode,
    isShotEditing,
    startShotEdit,
    updateShotEditText,
    finishShotEdit,
    cancelShotEdit,
    saveShotEdit,
    focusElement,
    editElementBindingName,
    buildShotPromptBody: buildShotPromptBodyForHeader,
  };
}

export function shotCopyText(shot) {
  return `分镜${shot?.no}：${shot?.title ? ' ' + shot.title : ''}\n${shot?.body || ''}`.trim();
}

async function copyTextToClipboard(text, globals = {}) {
  const nav = globals.navigator || globalThis.navigator;
  if (nav?.clipboard?.writeText) {
    await nav.clipboard.writeText(text);
    return;
  }
  const doc = globals.document || globalThis.document;
  const textarea = doc.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  doc.body.appendChild(textarea);
  textarea.select();
  doc.execCommand('copy');
  doc.body.removeChild(textarea);
}

export async function copyShotFlow(shot, handlers = {}) {
  try {
    await copyTextToClipboard(shotCopyText(shot), handlers);
    handlers.success(`已复制镜头 ${shot.no} 提示词`);
  } catch {
    handlers.error('复制失败，请手动选择文本');
  }
}

export function createCopyShotRuntime({ message, globals = {} } = {}) {
  return (shot) => copyShotFlow(shot, {
    navigator: globals.navigator,
    document: globals.document,
    success: message.success,
    error: message.error,
  });
}

export function createShotWorkspaceRuntime({ api, message, ui = {}, refs = {}, helpers = {}, computed } = {}) {
  const parseShotsForHeader = (text, storyboard = null) => parseShots(text, {
    headerPrefix: normalizeShotHeaderPrefix(storyboard?.videoPromptPrefix) || refs.shotHeaderPrefix.value,
  });
  const currentShots = computed(() => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (!storyboard) return [];
    return applyShotTimelineMeta(
      parseShotsForHeader(storyboard.content, storyboard),
      storyboard,
      Number(refs.config?.video?.duration) || 15,
      Number(refs.config?.video?.duration) || 15,
    );
  });
  const completedShotVideoCount = computed(() => {
    const prefix = `${refs.episodeId.value}:`;
    return currentShots.value.reduce((total, shot) => {
      const key = `${prefix}${shot.no}`;
      return total + (!refs.shotStatus[key] && refs.shotVideos[key] ? 1 : 0);
    }, 0);
  });
  const pendingShotVideoCount = computed(() => {
    const prefix = `${refs.episodeId.value}:`;
    return currentShots.value.reduce((total, shot) => (
      total + (
        ['queued', 'generating'].includes(refs.shotStatus[`${prefix}${shot.no}`])
        && refs.shotProgress?.[`${prefix}${shot.no}`]?.canCancel !== false
          ? 1
          : 0
      )
    ), 0);
  });

  const shiftedShotVideoUrl = (episodeId, no) => {
    const project = refs.project.value;
    if (!project) return '';
    return `/video/${encodeURIComponent(project.id)}/${encodeURIComponent(String(episodeId))}/${encodeURIComponent(String(no))}.mp4?t=${Date.now()}`;
  };

  const shiftShotVideoMeta = (value, no) => {
    if (!value || typeof value !== 'object') return value;
    return { ...value, videoUrl: value.videoUrl ? shiftedShotVideoUrl(refs.episodeId.value, no) : value.videoUrl };
  };

  const shiftRuntimeShotVideo = (value, no) => (
    typeof value === 'string' && value.startsWith('/video/')
      ? shiftedShotVideoUrl(refs.episodeId.value, no)
      : value
  );

  const remapVideoQueueShotNos = (episodeId, fromNo, delta) => {
    for (const item of refs.videoQueue.items) {
      const n = Number(item.no);
      if (String(refs.episodeId.value) === String(episodeId) && Number.isFinite(n) && n >= fromNo) {
        item.no = String(n + delta);
      }
    }
  };

  const removeQueuedShotNo = (shotNo) => {
    for (let i = refs.videoQueue.items.length - 1; i >= 0; i--) {
      if (String(refs.videoQueue.items[i].no) === String(shotNo)) refs.videoQueue.items.splice(i, 1);
    }
    if (!refs.videoQueue.items.length) helpers.cancelVideoQueueStartTimer();
  };

  const hasActiveShotAtOrAfter = (fromNo) => {
    const prefix = `${refs.episodeId.value}:`;
    return Object.entries(refs.shotStatus).some(([key, status]) => {
      if (!key.startsWith(prefix)) return false;
      if (status !== 'queued' && status !== 'generating') return false;
      const n = Number(key.slice(prefix.length));
      return Number.isFinite(n) && n >= fromNo;
    });
  };

  const shiftShotFiles = (fromNo, delta, removeNo = null) => shiftShotFilesFlow({ fromNo, delta, removeNo }, createShiftShotFilesContext({
    api,
    message,
    project: () => refs.project.value,
    episodeId: () => refs.episodeId.value,
  }));

  const shotEditListContext = () => createShotEditListRuntimeContext({
    message,
    refs: {
      episodeId: refs.episodeId,
      shotEdit: refs.shotEdit,
      currentShots,
      shotVideos: refs.shotVideos,
      shotStatus: refs.shotStatus,
    },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      hydratePending: helpers.hydratePending,
      hasActiveShotAtOrAfter,
      shiftShotVideoMeta,
      shiftRuntimeShotVideo,
      remapVideoQueueShotNos,
      cancelShotEdit: helpers.cancelShotEdit,
      saveScript: helpers.saveScript,
      shiftShotFiles,
      nextTick: helpers.nextTick,
      startShotEdit: helpers.startShotEdit,
    },
  });

  const insertShotAfter = (shot, options = {}) => insertShotAfterFlow(shot, createShotEditListContext(shotEditListContext()), options);
  const insertShotBefore = (shot, options = {}) => insertShotBeforeFlow(shot, createShotEditListContext(shotEditListContext()), options);
  // 拆分基线固定 15s，与全局默认时长解耦：用户把默认时长调大到 30 时，30s 长镜头依然要能拆。
  //（原来读 config.video.duration 当阈值，默认时长一调大按钮就消失，用户找不到。）
  const SPLIT_BASELINE_SECONDS = 15;
  const canSplitShot = (shot) => canSplitShotBody(normalizeShotEditBody(shot?.body), { maxSeconds: SPLIT_BASELINE_SECONDS });
  // 镜头完全没有时间码时的兜底出口：按段落拆内容（时长沿用原设置，不重标时间码）。
  const canSplitShotByParagraph = (shot) => canSplitShotByParagraphs(normalizeShotEditBody(shot?.body));
  // 拆分后每段的秒数按正文字段时间码算，不能用被上限截断过的提交时长，否则按钮上的数字会偏小。
  const shotSplitTarget = (shot) => shotSplitTargetSeconds(normalizeShotEditBody(shot?.body));
  const splitShotIntoTwoHalves = (shot) => splitShotIntoTwoHalvesFlow(shot, {
    ...createShotEditListContext(shotEditListContext()),
    maxSeconds: SPLIT_BASELINE_SECONDS,
    confirm: (info) => ui.confirmSplit(info),
  });

  // 每镜的参考视频：直接作为"视频参考"传给支持它的模型（即梦 / Seedance / LibTV 等）。
  // 记录写在 shotMeta[镜头号] 上，所以插入/删除镜头时会跟着镜头一起平移。
  const patchShotMetaRefVideo = (shotNo, patch) => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (!storyboard) return;
    if (!storyboard.shotMeta || typeof storyboard.shotMeta !== 'object') storyboard.shotMeta = {};
    const key = String(shotNo);
    const meta = storyboard.shotMeta[key] && typeof storyboard.shotMeta[key] === 'object' ? storyboard.shotMeta[key] : {};
    const next = { ...meta, ...patch };
    for (const field of ['refVideoPath', 'refVideoName', 'refVideoDuration', 'refVideoUpdatedAt']) {
      if (patch[field] === null) delete next[field];
    }
    storyboard.shotMeta[key] = next;
    helpers.saveScript();
  };

  const setShotRefVideo = async (shotNo, file) => {
    const projectId = String(refs.project?.value?.id || '');
    const episodeId = String(refs.episodeId?.value || '');
    if (!projectId || !episodeId || !file) return null;
    try {
      const params = new URLSearchParams({
        projectId,
        episodeId,
        shotNo: String(shotNo),
        name: file.name || '参考视频',
      });
      const result = await api.upload(`/api/video/shot-ref-video?${params.toString()}`, file);
      patchShotMetaRefVideo(shotNo, {
        refVideoPath: String(result?.refVideo?.path || ''),
        refVideoName: String(result?.refVideo?.name || file.name || '参考视频'),
        refVideoDuration: Number(result?.refVideo?.durationSeconds) || 0,
        refVideoUpdatedAt: new Date().toISOString(),
      });
      message.success('已挂上参考视频，生成这一镜时会当视频参考一起提交');
      return result;
    } catch (error) {
      message.error(error?.message || '参考视频导入失败');
      return null;
    }
  };

  const onPickShotRefVideo = async (event, shotNo) => {
    const file = event?.target?.files?.[0] || null;
    if (event?.target) event.target.value = '';
    if (!file) return null;
    return setShotRefVideo(shotNo, file);
  };

  const clearShotRefVideo = async (shotNo) => {
    const projectId = String(refs.project?.value?.id || '');
    const episodeId = String(refs.episodeId?.value || '');
    if (!projectId || !episodeId) return false;
    try {
      await api.post('/api/video/shot-ref-video/remove', { projectId, episodeId, shotNo: String(shotNo) });
      patchShotMetaRefVideo(shotNo, {
        refVideoPath: null, refVideoName: null, refVideoDuration: null, refVideoUpdatedAt: null,
      });
      message.success('已清除该镜的参考视频');
      return true;
    } catch (error) {
      message.error(error?.message || '清除参考视频失败');
      return false;
    }
  };
  const deleteShot = createDeleteShotRuntime({
    getContext: shotEditListContext,
    helpers: {
      confirmDelete: (target) => ui.confirmDelete(target),
      removeQueuedShotNo,
    },
  });

  const shotManualTags = (no) => storyboardTagList(helpers.findStoryboard(refs.episodeId.value), 'manualTags', no);
  const shotExcludedTags = (no) => storyboardTagList(helpers.findStoryboard(refs.episodeId.value), 'excludedTags', no);
  const isExcluded = (no, cat, name) => hasStoryboardTag(helpers.findStoryboard(refs.episodeId.value), 'excludedTags', no, cat, name);
  const isManualTagged = (no, cat, name) => hasStoryboardTag(helpers.findStoryboard(refs.episodeId.value), 'manualTags', no, cat, name);

  const flattenedTagElements = computed(() => flatProjectElements(refs.project.value));
  const shotElementTagCache = new WeakMap();
  const shotAudioTagCache = new WeakMap();
  const shotElementTags = (shot) => {
    if (!shot || typeof shot !== 'object') return [];
    const elements = flattenedTagElements.value;
    const projectId = refs.project.value?.id || '';
    // Per-shot revision: only serialise this shot's manual/excluded entries so a
    // tag change on shot A does not cold-start the WeakMap cache for shots B–Z.
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const shotKey = String(shot.no);
    const lockSnapshot = storyboard?.shotMeta?.[shotKey]?.lockSnapshot;
    if (isValidShotLockSnapshot(lockSnapshot)) return cloneShotLockTags(lockSnapshot.tags);
    const perShotRevision = JSON.stringify([
      storyboard?.manualTags?.[shotKey] ?? null,
      storyboard?.excludedTags?.[shotKey] ?? null,
    ]);
    const cached = shotElementTagCache.get(shot);
    if (cached?.elements === elements && cached.revision === perShotRevision && cached.projectId === projectId) return cached.tags;
    const tags = buildShotElementTags(shot, {
      elements,
      projectId,
      manualTags: shotManualTags(shot.no),
      excludedTags: shotExcludedTags(shot.no),
    });
    shotElementTagCache.set(shot, { elements, revision: perShotRevision, projectId, tags });
    return tags;
  };

  const shotAudioTags = (shot) => {
    const tags = shotElementTags(shot);
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const audioBindings = shotAudioBindingState(storyboard, shot?.no);
    const bindingRevision = JSON.stringify(audioBindings);
    const cached = shotAudioTagCache.get(tags);
    if (cached?.bindingRevision === bindingRevision) return cached.audioTags;
    const audioTags = shotAudioTagsForProject(refs.project.value?.id || '', tags, {
      project: refs.project.value,
      audioBindings,
    });
    shotAudioTagCache.set(tags, { bindingRevision, audioTags });
    return audioTags;
  };
  const regenerateShotElementImage = (tag, shot) => {
    if (helpers.isShotLocked?.(shot)) return message.warning('该镜头已锁定，请先解锁');
    if (typeof helpers.regenerateShotElementImage !== 'function') {
      return message.warning('当前版本暂不支持在分镜中重新生成图片');
    }
    return helpers.regenerateShotElementImage(tag);
  };
  const shotAudioOptions = computed(() => characterAudioOptionsForProject(refs.project.value));
  const filteredShotAudioOptions = computed(() => {
    const query = String(refs.addTagPanel.audioSearchQuery || '').trim().toLowerCase();
    if (!query) return shotAudioOptions.value;
    return shotAudioOptions.value.filter((item) => [item.name, item.displayName, item.voiceName]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()
      .includes(query));
  });
  const shotAudioBinding = (no) => shotAudioBindingState(
    helpers.findStoryboard(refs.episodeId.value),
    no,
  );
  const isShotAudioBound = (no, name) => shotAudioTags(
    currentShots.value.find((shot) => String(shot?.no) === String(no)) || { no },
  ).some((item) => item.name === name);
  const writeShotAudioBinding = (no, nextState) => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (!storyboard) return false;
    if (!storyboard.shotMeta || typeof storyboard.shotMeta !== 'object') storyboard.shotMeta = {};
    const key = String(no);
    const currentMeta = storyboard.shotMeta[key] && typeof storyboard.shotMeta[key] === 'object'
      ? storyboard.shotMeta[key]
      : {};
    const manual = [...new Set((nextState.manual || []).map((name) => String(name || '').trim()).filter(Boolean))];
    const excluded = [...new Set((nextState.excluded || []).map((name) => String(name || '').trim()).filter(Boolean))];
    const nextMeta = { ...currentMeta };
    if (manual.length || excluded.length) nextMeta.audioBindings = { manual, excluded };
    else delete nextMeta.audioBindings;
    storyboard.shotMeta[key] = nextMeta;
    return true;
  };
  const addShotAudioTag = (no, name) => {
    if (helpers.isShotLocked?.(no)) return message.warning('该镜头已锁定，请先解锁');
    const normalized = String(name || '').trim();
    if (!normalized || !shotAudioOptions.value.some((item) => item.name === normalized)) {
      return message.warning('该人物没有可用的配音参考音频');
    }
    const state = shotAudioBinding(no);
    state.excluded = state.excluded.filter((item) => item !== normalized);
    const automatic = shotElementTags(currentShots.value.find((shot) => String(shot?.no) === String(no)) || { no })
      .some((tag) => tag.cat === 'character' && tag.hasVoiceAudio && (tag.voiceOwnerName || tag.name) === normalized);
    if (!automatic && !state.manual.includes(normalized)) state.manual.push(normalized);
    if (!automatic) state.manual = [...new Set(state.manual)];
    if (!writeShotAudioBinding(no, state)) return false;
    saveElementBindings();
    return true;
  };
  const removeShotAudioTag = (no, name) => {
    if (helpers.isShotLocked?.(no)) return message.warning('该镜头已锁定，请先解锁');
    const normalized = String(name || '').trim();
    if (!normalized) return false;
    const state = shotAudioBinding(no);
    state.manual = state.manual.filter((item) => item !== normalized);
    if (!state.excluded.includes(normalized)) state.excluded.push(normalized);
    if (!writeShotAudioBinding(no, state)) return false;
    saveElementBindings();
    return true;
  };
  const toggleShotAudio = (no, name) => (
    isShotAudioBound(no, name)
      ? removeShotAudioTag(no, name)
      : addShotAudioTag(no, name)
  );
  const openShotAudioPicker = (shot) => {
    refs.addTagPanel.shotNo = String(shot?.no ?? '');
    refs.addTagPanel.audioSearchQuery = '';
  };
  const shotPickerKey = (shot, picker) => (
    `${String(refs.episodeId?.value ?? '')}:${String(shot?.no ?? '')}:${picker}`
  );
  const isShotPickerVisible = (shot, picker) => (
    refs.addTagPanel.activePicker === shotPickerKey(shot, picker)
  );
  const setShotPickerVisible = (shot, picker, visible) => {
    const key = shotPickerKey(shot, picker);
    if (visible) refs.addTagPanel.activePicker = key;
    else if (refs.addTagPanel.activePicker === key) refs.addTagPanel.activePicker = '';
  };
  const openAddTag = (shot) => openAddTagPanel(refs.addTagPanel, shot);
  const filteredAddTagElements = computed(() => filteredAddTagElementsForPanel(refs.project.value, refs.addTagPanel));
  let elementBindingSaveQueue = Promise.resolve();
  const saveElementBindings = () => {
    const save = typeof helpers.saveScriptNow === 'function' ? helpers.saveScriptNow : helpers.saveScript;
    if (typeof save !== 'function') return elementBindingSaveQueue;
    elementBindingSaveQueue = elementBindingSaveQueue
      .catch(() => null)
      .then(() => save());
    elementBindingSaveQueue.catch((error) => message.error(`元素绑定保存失败：${error?.message || error}`));
    return elementBindingSaveQueue;
  };
  const openCharacterLookPicker = (shot) => {
    if (helpers.isShotLocked?.(shot)) return message.warning('该镜头已锁定人物与元素，请先解锁');
    refs.addTagPanel.shotNo = String(shot?.no ?? '');
    refs.addTagPanel.lookSearchQuery = '';
    const groups = characterLookGroupsForPanel(refs.project.value, refs.addTagPanel);
    const selectedOwner = shotManualTags(shot?.no).find(
      (item) => item.cat === 'character' && item.source === 'look' && item.ownerName,
    )?.ownerName;
    const taggedOwners = new Set(shotElementTags(shot)
      .filter((item) => item.cat === 'character')
      .map((item) => String(item.ownerName || item.name || '').split('·')[0].trim())
      .filter(Boolean));
    refs.addTagPanel.lookOwnerName = selectedOwner
      || groups.find((group) => taggedOwners.has(group.name))?.name
      || groups[0]?.name
      || '';
  };
  const characterLookGroups = computed(() => characterLookGroupsForPanel(refs.project.value, refs.addTagPanel));
  const activeCharacterLookGroup = computed(() => (
    characterLookGroups.value.find((group) => group.name === refs.addTagPanel.lookOwnerName)
    || characterLookGroups.value[0]
    || null
  ));
  const selectCharacterLookOwner = (ownerName) => {
    if (characterLookGroups.value.some((group) => group.name === ownerName)) {
      refs.addTagPanel.lookOwnerName = ownerName;
    }
  };
  const characterLookImageUrl = (look) => (look?.hasImage
    ? `/img/${encodeURIComponent(refs.project.value?.id || '')}/character/${encodeURIComponent(look.imageBase || look.name || '')}.png${imageVersionQuery(look)}`
    : '');
  const selectedCharacterLook = (no, ownerName) => shotManualTags(no).find(
    (item) => item.cat === 'character' && item.source === 'look' && item.ownerName === ownerName,
  )?.name || '';
  const batchCharacterLookGroups = computed(() => characterLookGroupsForPanel(refs.project.value, {}));
  const activeBatchCharacterLookGroup = computed(() => (
    batchCharacterLookGroups.value.find((group) => group.name === refs.batchCharacterLookDialog.ownerName)
    || null
  ));
  const activeBatchCharacterLook = computed(() => (
    activeBatchCharacterLookGroup.value?.looks.find((look) => look.name === refs.batchCharacterLookDialog.lookName)
    || null
  ));
  const batchCharacterLookOwnerImageUrl = (group) => characterLookImageUrl(
    group?.looks?.find((look) => look.hasImage),
  );
  const batchCharacterLookAffectedCount = computed(() => {
    const range = normalizeShotNoRange(
      refs.batchCharacterLookDialog.fromNo,
      refs.batchCharacterLookDialog.toNo,
    );
    if (!range) return 0;
    return currentShots.value.filter((shot) => {
      const no = Number(shot?.no);
      return Number.isFinite(no) && no >= range.fromNo && no <= range.toNo && !helpers.isShotLocked?.(shot);
    }).length;
  });
  const selectDefaultBatchCharacterLook = (ownerName) => {
    const group = batchCharacterLookGroups.value.find((item) => item.name === ownerName);
    refs.batchCharacterLookDialog.lookName = group?.looks.find((look) => look.hasImage)?.name || '__auto__';
  };
  const changeBatchCharacterLookOwner = (ownerName) => {
    refs.batchCharacterLookDialog.ownerName = ownerName;
    selectDefaultBatchCharacterLook(ownerName);
  };
  const openBatchCharacterLookDialog = () => {
    const bounds = shotNoBounds(currentShots.value);
    if (!bounds) return message.warning('当前集还没有可设置造型的分镜');
    const groups = batchCharacterLookGroups.value;
    if (!groups.length) return message.warning('元素库中还没有可选择造型的人物');
    const ownerName = groups.some((group) => group.name === refs.batchCharacterLookDialog.ownerName)
      ? refs.batchCharacterLookDialog.ownerName
      : groups[0].name;
    refs.batchCharacterLookDialog.ownerName = ownerName;
    refs.batchCharacterLookDialog.fromNo = bounds.fromNo;
    refs.batchCharacterLookDialog.toNo = bounds.toNo;
    selectDefaultBatchCharacterLook(ownerName);
    refs.batchCharacterLookDialog.visible = true;
  };
  const confirmBatchCharacterLook = () => {
    const dialog = refs.batchCharacterLookDialog;
    const range = normalizeShotNoRange(dialog.fromNo, dialog.toNo);
    if (!range) return message.warning('请输入有效的镜号范围');
    const group = batchCharacterLookGroups.value.find((item) => item.name === dialog.ownerName);
    if (!group) return message.warning('请选择人物');
    const restoreAutomatic = dialog.lookName === '__auto__';
    const look = restoreAutomatic ? null : group.looks.find((item) => item.name === dialog.lookName);
    if (!restoreAutomatic && !look) return message.warning('请选择有效的人物造型');
    if (look && !look.hasImage) return message.warning('该造型还没有图片，请先在元素库生成或上传');
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const lockedInRange = currentShots.value.filter((shot) => {
      const no = Number(shot?.no);
      return Number.isFinite(no) && no >= range.fromNo && no <= range.toNo && helpers.isShotLocked?.(shot);
    }).length;
    const result = applyStoryboardCharacterLookRange(storyboard, currentShots.value.filter((shot) => !helpers.isShotLocked?.(shot)), {
      ...range,
      ownerName: group.name,
      look,
    }, flatProjectElements(refs.project.value));
    if (lockedInRange) message.info(`已跳过 ${lockedInRange} 个已锁定镜头`);
    if (!result.total) return message.warning('该范围内没有可修改的未锁定分镜');
    dialog.visible = false;
    if (!result.changed) return message.info('所选范围已经是当前设置');
    saveElementBindings();
    if (look) {
      const lookLabel = look.assetKind === 'main' ? '主形态' : (look.lookLabel || look.matchName || look.displayName || '造型');
      return message.success(`已将${group.displayName}的${lookLabel}应用到当前集 ${result.total} 个镜头`);
    }
    return message.success(`已恢复当前集 ${result.total} 个镜头中${group.displayName}的自动匹配`);
  };
  const openSceneAreaPicker = (shot) => {
    refs.addTagPanel.shotNo = String(shot?.no ?? '');
    refs.addTagPanel.sceneSearchQuery = '';
  };
  const sceneAreaGroups = computed(() => sceneAreaGroupsForPanel(refs.project.value, refs.addTagPanel));
  const storyboardSceneImageUrl = (area) => (area?.hasImage
    ? `/img/${encodeURIComponent(refs.project.value?.id || '')}/scene/${encodeURIComponent(area.imageBase || area.name || '')}.png${imageVersionQuery(area)}`
    : '');
  const selectedSceneArea = (no, ownerName) => shotManualTags(no).find((item) => {
    if (item.cat !== 'scene') return false;
    const element = flattenedTagElements.value.find((candidate) => candidate.cat === 'scene' && candidate.name === item.name);
    return element?.ownerName === ownerName;
  })?.name || '';

  const previousShotForReuse = (shot) => {
    const shots = currentShots.value;
    let index = shots.indexOf(shot);
    if (index < 0) index = shots.findIndex((item) => String(item.no) === String(shot?.no));
    return index > 0 ? shots[index - 1] : null;
  };

  const previousShotElementCount = (shot) => {
    const previousShot = previousShotForReuse(shot);
    return previousShot ? shotElementTags(previousShot).length : 0;
  };

  const previousShotHasOpenerFrame = (shot) => {
    const previousShot = previousShotForReuse(shot);
    if (!previousShot) return false;
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    return storyboard?.openerFrames?.[String(previousShot.no)]?.fromShotNo != null;
  };

  const previousShotReuseSummary = (shot) => {
    const parts = [];
    const elementCount = previousShotElementCount(shot);
    if (elementCount) parts.push(`${elementCount} 个元素素材`);
    if (previousShotHasOpenerFrame(shot)) parts.push('首帧');
    return parts.join('和');
  };

  const previousShotSetupFields = (shot) => {
    const previousShot = previousShotForReuse(shot);
    return previousShot ? extractShotSetupFields(previousShot.body).fields : [];
  };

  const previousShotSetupFieldCount = (shot) => previousShotSetupFields(shot).length;

  const previousShotSetupSummary = (shot) => previousShotSetupFields(shot)
    .map((field) => field.label)
    .join('、');

  const reusePreviousShotElements = (shot) => {
    if (helpers.isShotLocked?.(shot)) return message.warning('该镜头已锁定人物与元素，请先解锁');
    const previousShot = previousShotForReuse(shot);
    if (!previousShot) return message.warning('第一镜没有可复用的上一镜元素');
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const previousTags = shotElementTags(previousShot);
    const hasPreviousOpenerFrame = storyboard?.openerFrames?.[String(previousShot.no)]?.fromShotNo != null;
    if (!previousTags.length && !hasPreviousOpenerFrame) return message.info(`镜头 ${previousShot.no} 还没有匹配元素或首帧`);
    const result = reuseStoryboardShotElements(storyboard, shot.no, previousTags, shotElementTags(shot));
    const openerResult = reuseStoryboardShotOpenerFrame(storyboard, shot.no, previousShot.no);
    if (result.changed || openerResult.changed) {
      saveElementBindings();
      const reused = [];
      if (result.total) reused.push(`${result.total} 个元素素材`);
      if (openerResult.reused) reused.push('首帧');
      return message.success(`已完全复用镜头 ${previousShot.no} 的${reused.join('和')}`);
    }
    return message.info(`本镜${previousShotReuseSummary(shot)}已经与上一镜一致`);
  };

  const reusePreviousShotSetup = (shot) => {
    const previousShot = previousShotForReuse(shot);
    if (!previousShot) return message.warning('第一镜没有可复用的上一镜场景与站位');
    if (refs.shotEdit.key) return message.warning('请先保存或取消当前正在编辑的镜头');
    if (helpers.isShotLocked?.(shot)) return message.warning('该镜头已锁定，请先解锁');
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (!storyboard) return false;
    if (storyboard.shotMeta?.[String(shot?.no)]?.locked === true) {
      return message.warning('该镜头已锁定，请先解锁');
    }
    const result = reuseShotSetupFields(previousShot.body, shot.body, {
      headerPrefix: storyboard.videoPromptPrefix,
    });
    if (!result.total) return message.info(`镜头 ${previousShot.no} 没有可复用的场景、人物、站位或道具字段`);
    if (!result.changed) return message.info('本镜场景与人物站位已经与上一镜一致');
    storyboard.content = replaceShotBodyInStoryboardContent(storyboard.content, shot, result.body);
    helpers.saveScript();
    return message.success(`已复用镜头 ${previousShot.no} 的${result.labels.join('、')}，本镜画面内容保持不变`);
  };

  const toggleManualTag = (cat, name) => {
    if (helpers.isShotLocked?.(refs.addTagPanel.shotNo)) return message.warning('该镜头已锁定人物与元素，请先解锁');
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (toggleStoryboardManualTag(storyboard, refs.addTagPanel.shotNo, cat, name)) saveElementBindings();
  };

  const selectCharacterLook = (look) => {
    if (!look?.hasImage) return message.warning('该造型还没有图片，请先在元素库生成或上传');
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (helpers.isShotLocked?.(refs.addTagPanel.shotNo)) return message.warning('该镜头已锁定人物与元素，请先解锁');
    const elements = flatProjectElements(refs.project.value);
    if (setStoryboardCharacterLook(storyboard, refs.addTagPanel.shotNo, look, elements)) saveElementBindings();
  };

  const selectSceneArea = (area) => {
    if (!area?.hasImage) return message.warning('该场景区域还没有图片，请先在元素库生成或上传');
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (helpers.isShotLocked?.(refs.addTagPanel.shotNo)) return message.warning('该镜头已锁定人物与元素，请先解锁');
    const elements = flatProjectElements(refs.project.value);
    if (setStoryboardSceneArea(storyboard, refs.addTagPanel.shotNo, area, elements)) saveElementBindings();
  };

  const removeManualTag = (no, cat, name) => {
    if (helpers.isShotLocked?.(no)) return message.warning('该镜头已锁定人物与元素，请先解锁');
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (removeStoryboardTag(storyboard, no, cat, name)) saveElementBindings();
  };

  return {
    parseShots: parseShotsForHeader,
    currentShots,
    completedShotVideoCount,
    pendingShotVideoCount,
    shiftedShotVideoUrl,
    shiftShotVideoMeta,
    shiftRuntimeShotVideo,
    remapVideoQueueShotNos,
    removeQueuedShotNo,
    hasActiveShotAtOrAfter,
    shiftShotFiles,
    shotEditListContext,
    insertShotAfter,
    insertShotBefore,
    canSplitShot,
    canSplitShotByParagraph,
    shotSplitTarget,
    splitShotIntoTwoHalves,
    setShotRefVideo,
    onPickShotRefVideo,
    clearShotRefVideo,
    deleteShot,
    shotElementTags,
    shotAudioTags,
    shotAudioOptions,
    filteredShotAudioOptions,
    shotAudioBinding,
    isShotAudioBound,
    addShotAudioTag,
    removeShotAudioTag,
    toggleShotAudio,
    openShotAudioPicker,
    shotPickerPopperOptions: SHOT_PICKER_POPPER_OPTIONS,
    isShotPickerVisible,
    setShotPickerVisible,
    shotManualTags,
    shotExcludedTags,
    isExcluded,
    isManualTagged,
    openAddTag,
    filteredAddTagElements,
    openCharacterLookPicker,
    characterLookGroups,
    activeCharacterLookGroup,
    selectCharacterLookOwner,
    characterLookImageUrl,
    selectedCharacterLook,
    batchCharacterLookGroups,
    activeBatchCharacterLookGroup,
    activeBatchCharacterLook,
    batchCharacterLookOwnerImageUrl,
    batchCharacterLookAffectedCount,
    changeBatchCharacterLookOwner,
    openBatchCharacterLookDialog,
    confirmBatchCharacterLook,
    openSceneAreaPicker,
    sceneAreaGroups,
    storyboardSceneImageUrl,
    selectedSceneArea,
    previousShotForReuse,
    previousShotElementCount,
    previousShotHasOpenerFrame,
    previousShotReuseSummary,
    previousShotSetupFieldCount,
    previousShotSetupSummary,
    reusePreviousShotElements,
    reusePreviousShotSetup,
    toggleManualTag,
    selectCharacterLook,
    selectSceneArea,
    removeManualTag,
    regenerateShotElementImage,
    shotBodyHtml: (() => {
      // Cache rendered HTML per shot object. The cache entry is keyed on the
      // tags array reference returned by shotElementTags — when tags change the
      // reference changes, naturally busting the entry without a separate timer.
      const cache = new WeakMap();
      return (shot) => {
        if (!shot) return '';
        const tags = shotElementTags(shot);
        const body = shot.body ?? '';
        const cached = cache.get(shot);
        if (cached && cached.tags === tags && cached.body === body) return cached.html;
        const characterNames = tags
          .filter((t) => t.cat === 'character')
          .flatMap((t) => [t.displayName, t.name, t.alias])
          .filter(Boolean);
        const html = renderShotBodyHtml(body, { characterNames });
        cache.set(shot, { tags, body, html });
        return html;
      };
    })(),
  };
}

export function createShotCardRuntime({ api, message, messageBox, ui = {}, refs = {}, helpers = {}, computed, ref, globals = {} } = {}) {
  const isShotLocked = (shotOrNo) => {
    const no = typeof shotOrNo === 'object' ? shotOrNo?.no : shotOrNo;
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    return storyboard?.shotMeta?.[String(no)]?.locked === true;
  };
  const workspace = createShotWorkspaceRuntime({
    api,
    message,
    computed,
    ui,
    refs: {
      project: refs.project,
      config: refs.config,
      episodeId: refs.episodeId,
      shotHeaderPrefix: refs.shotHeaderPrefix,
      shotEdit: refs.shotEdit,
      shotVideos: refs.shotVideos,
      shotStatus: refs.shotStatus,
      shotProgress: refs.shotProgress,
      videoQueue: refs.videoQueue,
      addTagPanel: refs.addTagPanel,
      batchCharacterLookDialog: refs.batchCharacterLookDialog,
    },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      hydratePending: () => helpers.hydratePending(),
      cancelShotEdit: () => cardActions.cancelShotEdit(),
      saveScript: helpers.saveScript,
      saveScriptNow: helpers.saveScriptNow,
      cancelVideoQueueStartTimer: () => helpers.cancelVideoQueueStartTimer(),
      nextTick: helpers.nextTick,
      startShotEdit: (shot) => cardActions.startShotEdit(shot),
      isShotLocked,
      regenerateShotElementImage: helpers.regenerateShotElementImage,
    },
  });

  const introClip = createIntroClipRuntime({ api, message, ref, computed, refs });

  // 参考反推 / 衔接合成：需要 shotUtils 里的纯文本函数，用注入的方式给，避免两个模块循环 import。
  const referenceStudio = createReferenceStudioRuntime({
    api,
    message,
    ref,
    computed,
    refs,
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
      saveScriptNow: helpers.saveScriptNow,
      parseShots,
      replaceShotBodyInStoryboardContent,
      applyCarryPatch: applyCarryPatchToBody,
    },
    insertShotBefore: workspace.insertShotBefore,
    insertShotAfter: workspace.insertShotAfter,
  });

  const cardActions = createShotCardActionsRuntime({
    api,
    message,
    messageBox,
    globals,
    refs: {
      aiBinding: refs.aiBinding,
      aiBindRangeDialog: refs.aiBindRangeDialog,
      shotEdit: refs.shotEdit,
      project: refs.project,
      episodeId: refs.episodeId,
      scriptState: refs.scriptState,
      currentShots: workspace.currentShots,
      category: refs.category,
      elementsDrawer: refs.elementsDrawer,
      shotHeaderPrefix: refs.shotHeaderPrefix,
    },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScriptNow: helpers.saveScriptNow,
      saveScriptDebounced: helpers.saveScript,
      shotTags: workspace.shotElementTags,
      isShotLocked,
      nextTick: helpers.nextTick,
    },
  });

  const appliedShotHeaderPrefix = computed(() => (
    normalizeShotHeaderPrefix(helpers.findStoryboard(refs.episodeId.value)?.videoPromptPrefix)
  ));
  const applyShotHeaderPrefix = (mode = 'add') => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (!storyboard) return;
    const draft = normalizeShotHeaderPrefix(refs.shotHeaderPrefix.value);
    const applied = normalizeShotHeaderPrefix(storyboard.videoPromptPrefix);
    if (!draft) return message.warning('请先输入要添加的视频提示词前缀');
    if (mode === 'add' && applied && applied !== draft) {
      return message.warning('本集已有前缀，请使用“替换全部”');
    }
    if (mode === 'replace' && !applied) {
      return message.warning('本集还没有已添加的前缀，请先使用“添加到全部”');
    }
    storyboard.content = updateStoryboardShotPrefix(storyboard.content, {
      previousPrefix: mode === 'replace' ? applied : '',
      nextPrefix: draft,
    });
    storyboard.videoPromptPrefix = draft;
    refs.shotHeaderPrefix.value = draft;
    helpers.saveSettings?.();
    helpers.saveScript();
    message.success(`${mode === 'replace' ? '已替换' : '已添加到'}本集 ${workspace.currentShots.value.length} 个分镜`);
  };
  const clearShotHeaderPrefix = async () => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    const applied = normalizeShotHeaderPrefix(storyboard?.videoPromptPrefix);
    if (!storyboard || !applied) return message.warning('本集没有可删除的已添加前缀');
    try {
      await messageBox.confirm('将从本集所有分镜中删除已添加的前缀，分镜正文会保留。', '删除全部前缀', {
        type: 'warning',
        confirmButtonText: '删除全部',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
    storyboard.content = updateStoryboardShotPrefix(storyboard.content, { previousPrefix: applied });
    storyboard.videoPromptPrefix = '';
    refs.shotHeaderPrefix.value = '';
    helpers.saveSettings?.();
    helpers.saveScript();
    message.success(`已从本集 ${workspace.currentShots.value.length} 个分镜中删除前缀`);
  };
  // 跨章节应用：把前缀写到 scriptState 里全部章节的分镜剧本（saveScriptNow 按变更增量持久化）。
  // 已是同前缀的章节跳过；已有不同前缀的章节在确认后整集替换。
  const addShotHeaderPrefixToAllEpisodes = async () => {
    const draft = normalizeShotHeaderPrefix(refs.shotHeaderPrefix.value);
    if (!draft) return message.warning('请先输入要添加的视频提示词前缀');
    const storyboards = Array.isArray(refs.scriptState.storyboards) ? refs.scriptState.storyboards : [];
    if (!storyboards.length) return message.warning('没有可应用的分镜剧本');
    let replaceCount = 0;
    for (const storyboard of storyboards) {
      if (!storyboard || !String(storyboard.content || '').trim()) continue;
      const applied = normalizeShotHeaderPrefix(storyboard.videoPromptPrefix);
      if (applied && applied !== draft) replaceCount += 1;
    }
    try {
      const replaceNote = replaceCount ? `，其中 ${replaceCount} 个章节已有不同前缀、将被替换` : '';
      await messageBox.confirm(
        `将把该前缀应用到全部 ${storyboards.length} 个章节的分镜剧本${replaceNote}。`,
        '应用到所有章节',
        { type: 'warning', confirmButtonText: '应用到全部章节', cancelButtonText: '取消' },
      );
    } catch {
      return;
    }
    let touchedEpisodes = 0;
    let touchedShots = 0;
    for (const storyboard of storyboards) {
      if (!storyboard || !String(storyboard.content || '').trim()) continue;
      const applied = normalizeShotHeaderPrefix(storyboard.videoPromptPrefix);
      if (applied === draft) continue;
      const nextContent = updateStoryboardShotPrefix(storyboard.content, {
        previousPrefix: applied,
        nextPrefix: draft,
      });
      if (nextContent === storyboard.content) continue;
      storyboard.content = nextContent;
      storyboard.videoPromptPrefix = draft;
      touchedEpisodes += 1;
      touchedShots += parseShots(storyboard.content).length;
    }
    if (!touchedEpisodes) return message.warning('所有章节都已是该前缀，无需重复添加');
    refs.shotHeaderPrefix.value = draft;
    helpers.saveSettings?.();
    await helpers.saveScriptNow?.();
    message.success(`已应用到 ${touchedEpisodes} 个章节共 ${touchedShots} 个分镜`);
  };

  const timeline = createShotTimelineRuntime({
    api,
    message,
    messageBox,
    computed,
    globals,
    refs: {
      timeline: refs.shotTimeline,
      project: refs.project,
      episodeId: refs.episodeId,
      scriptState: refs.scriptState,
      shotEdit: refs.shotEdit,
      shotVideos: refs.shotVideos,
      shotStatus: refs.shotStatus,
      videoQueue: refs.videoQueue,
      currentShots: workspace.currentShots,
      defaultDuration: () => Number(refs.config?.video?.duration) || 15,
      maxDuration: () => Number(refs.config?.video?.duration) || 15,
    },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      parseShots: workspace.parseShots,
      shotElementTags: workspace.shotElementTags,
      shotAudioTags: workspace.shotAudioTags,
      isShotLocked,
      shiftedShotVideoUrl: workspace.shiftedShotVideoUrl,
      shiftShotVideoMeta: workspace.shiftShotVideoMeta,
      shiftRuntimeShotVideo: workspace.shiftRuntimeShotVideo,
      hasActiveShotAtOrAfter: workspace.hasActiveShotAtOrAfter,
      hydratePending: helpers.hydratePending,
      saveScriptNow: helpers.saveScriptNow,
      cancelShotEdit: cardActions.cancelShotEdit,
      nextTick: helpers.nextTick,
    },
  });

  const shotPromptRevealKey = (shot) => `${refs.project.value?.id || ''}:${refs.episodeId.value}:${String(shot?.no ?? '').trim()}`;
  const isShotPromptRevealed = (shot) => refs.shotPromptReveal[shotPromptRevealKey(shot)] === true;
  const toggleShotPromptReveal = (shot) => {
    const key = shotPromptRevealKey(shot);
    if (refs.shotPromptReveal[key] === true) delete refs.shotPromptReveal[key];
    else refs.shotPromptReveal[key] = true;
  };
  const clearShotPromptReveals = () => {
    for (const key of Object.keys(refs.shotPromptReveal)) delete refs.shotPromptReveal[key];
  };

  return {
    ...workspace,
    ...cardActions,
    ...timeline,
    ...introClip,
    ...referenceStudio,
    appliedShotHeaderPrefix,
    addShotHeaderPrefixToAll: () => applyShotHeaderPrefix('add'),
    replaceShotHeaderPrefixForAll: () => applyShotHeaderPrefix('replace'),
    addShotHeaderPrefixToAllEpisodes,
    clearShotHeaderPrefix,
    isShotPromptRevealed,
    toggleShotPromptReveal,
    clearShotPromptReveals,
  };
}

export function createShotStageWatchersRuntime({ watch, refs = {}, helpers = {} } = {}) {
  watch(() => refs.scriptUi.stage, (stage) => {
    if (stage === 'storyboard' && !helpers.findEpisode(refs.episodeId.value)) {
      const first = refs.scriptState.episodes.find((episode) => helpers.findStoryboard(episode.id)) || refs.scriptState.episodes[0];
      if (first) refs.episodeId.value = first.id;
    }
  });
  watch(refs.episodeId, () => {
    try {
      helpers.cancelShotEdit();
      helpers.hydrateShotVideos();
      helpers.loadVideoBar();
      helpers.hydratePending();
    } catch {
      // Ignore transient setup races while dependent runtimes are being wired.
    }
  });
}

export function normalizeOpenerFrameName(value) {
  return String(value || '').trim().slice(0, 40);
}

export function shotOpenerFrameDisplayName(meta, fallbackPrefix = '开场帧') {
  if (!meta) return '';
  return normalizeOpenerFrameName(meta.name || meta.label) || `${fallbackPrefix}·镜${meta.fromShotNo}尾`;
}

export async function editShotOpenerFrameNameFlow(no, handlers = {}) {
  const storyboard = handlers.storyboard();
  const meta = storyboard?.openerFrames?.[String(no)];
  if (!meta) return;
  const name = await handlers.promptName(normalizeOpenerFrameName(meta.name || meta.label) || '开场参考图');
  if (name === null) return;
  meta.name = normalizeOpenerFrameName(name) || '开场参考图';
  meta.updatedAt = new Date().toISOString();
  handlers.saveScript();
  handlers.success(`开场帧已改名为：${meta.name}`);
}

export function createEditShotOpenerFrameNameContext({ message, messageBox, refs = {}, helpers = {} } = {}) {
  return {
    success: message.success,
    storyboard: () => helpers.findStoryboard(refs.episodeId.value),
    promptName: (inputValue) => messageBox.prompt(
      '这个名字会同步到开场帧标签、参考图说明和视频平台上传的参考图名称。',
      '修改开场帧名称',
      {
        confirmButtonText: '保存',
        cancelButtonText: '取消',
        inputValue,
        inputPattern: /\S/,
        inputErrorMessage: '名称不能为空',
      }
    ).then((result) => result.value).catch(() => null),
    saveScript: helpers.saveScript,
  };
}

export function createShotOpenerFrameMeta(fromShotNo, url, name = '', updatedAt = new Date().toISOString()) {
  const meta = { fromShotNo: String(fromShotNo), url, updatedAt };
  const frameName = normalizeOpenerFrameName(name);
  if (frameName) meta.name = frameName;
  return meta;
}

export function formatTailFrameTime(value) {
  const number = Math.max(0, Number(value) || 0);
  const min = Math.floor(number / 60);
  const sec = (number % 60).toFixed(2).padStart(5, '0');
  return `${min}:${sec}`;
}

export function openTailFramePickerFlow(no, handlers = {}) {
  if (!handlers.project()) return false;
  const from = handlers.previousShotNo(no);
  if (from == null) {
    handlers.warning('这是第一个分镜，没有上一镜可选尾帧');
    return false;
  }
  const videoUrl = handlers.shotVideoUrl(from);
  if (!videoUrl) {
    handlers.warning(`上一镜（镜头 ${from}）还没有视频，无法选择尾帧`);
    return false;
  }
  const existing = handlers.shotOpenerFrame(no);
  handlers.assignPicker({
    visible: true,
    targetShotNo: no,
    fromShotNo: from,
    videoUrl,
    frameName: normalizeOpenerFrameName(existing?.name || existing?.label) || '本段开场状态参考图',
    currentTime: 0,
    duration: 0,
    saving: false,
  });
  handlers.loadVideo();
  return true;
}

export async function capturePrevTailFrameFlow(no, handlers = {}) {
  const project = handlers.project();
  if (!project) return false;
  const from = handlers.previousShotNo(no);
  if (from == null) {
    handlers.warning('这是第一个分镜，没有上一镜可取尾帧');
    return false;
  }
  if (!handlers.shotVideoUrl(from)) {
    handlers.warning(`上一镜（镜头 ${from}）还没有视频，无法截取尾帧`);
    return false;
  }
  try {
    const result = await handlers.extractTailFrame({
      projectId: project.id,
      episodeId: handlers.episodeId(),
      shotNo: from,
    });
    if (!result?.ok || !result.url) throw new Error(result?.error || '截取失败');
    handlers.setShotOpenerFrame(no, from, result.url, handlers.autoTailFrameName());
    handlers.success(`已取镜头 ${from} 尾帧作为镜头 ${no} 的开场参考图`);
    return true;
  } catch (error) {
    handlers.error('截取尾帧失败：' + (error.message || error));
    return false;
  }
}

export function createOpenTailFramePickerContext({ message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    project: () => refs.project.value,
    previousShotNo: helpers.previousShotNo,
    shotVideoUrl: helpers.shotVideoUrl,
    shotOpenerFrame: helpers.shotOpenerFrame,
    assignPicker: (state) => { Object.assign(refs.picker, state); },
    loadVideo: () => helpers.nextTick(() => refs.video.value?.load?.()),
  };
}

export function createCapturePrevTailFrameContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    project: () => refs.project.value,
    previousShotNo: helpers.previousShotNo,
    shotVideoUrl: helpers.shotVideoUrl,
    episodeId: () => refs.episodeId.value,
    extractTailFrame: (payload) => api.post('/api/video/extract-tail-frame', payload),
    setShotOpenerFrame: helpers.setShotOpenerFrame,
    autoTailFrameName: helpers.autoTailFrameName,
  };
}

export async function saveTailFramePickerFlow(handlers = {}) {
  const project = handlers.project();
  if (!project) return;
  const video = handlers.video();
  if (!video || !video.videoWidth || !video.videoHeight) {
    handlers.warning('视频画面还没有加载完成');
    return;
  }
  try {
    handlers.setSaving(true);
    await handlers.waitForSeek(video);
    video.pause?.();
    const canvas = handlers.createCanvas();
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL('image/png');
    const picker = handlers.picker();
    const result = await handlers.saveTailFrame({
      projectId: project.id,
      episodeId: handlers.episodeId(),
      shotNo: picker.fromShotNo,
      imageDataUrl,
    });
    if (!result?.ok || !result.url) throw new Error(result?.error || '保存失败');
    handlers.setShotOpenerFrame(picker.targetShotNo, picker.fromShotNo, result.url, picker.frameName);
    handlers.setVisible(false);
    handlers.success(`已把“${normalizeOpenerFrameName(picker.frameName) || '开场参考图'}”设为镜头 ${picker.targetShotNo} 的开场参考图`);
  } catch (error) {
    handlers.error('保存手选尾帧失败：' + (error.message || error));
  } finally {
    handlers.setSaving(false);
  }
}

export function createSaveTailFramePickerContext({ api, message, refs = {}, helpers = {} } = {}) {
  return {
    ...message,
    project: () => refs.project.value,
    video: () => refs.video.value,
    picker: () => refs.picker,
    episodeId: () => refs.episodeId.value,
    waitForSeek: helpers.waitForSeek,
    createCanvas: helpers.createCanvas,
    saveTailFrame: (payload) => api.post('/api/video/manual-tail-frame', payload),
    setShotOpenerFrame: helpers.setShotOpenerFrame,
    setVisible: (value) => { refs.picker.visible = value; },
    setSaving: (value) => { refs.picker.saving = value; },
  };
}

export function onTailFramePickerLoadedState(video, picker) {
  if (!video) return;
  picker.duration = Number.isFinite(video.duration) ? video.duration : 0;
  const nearEnd = picker.duration ? Math.max(0, picker.duration - 0.5) : 0;
  if (nearEnd) video.currentTime = nearEnd;
  picker.currentTime = video.currentTime || nearEnd;
}

export function updateTailFramePickerTimeState(video, picker) {
  if (!video) return;
  picker.currentTime = Number(video.currentTime) || 0;
}

export function seekTailFramePickerState(video, picker, value) {
  if (!video) return;
  const max = Number.isFinite(video.duration) ? video.duration : picker.duration;
  const time = Math.max(0, Math.min(max || 0, Number(value) || 0));
  video.currentTime = time;
  picker.currentTime = time;
}

export function waitForTailFrameSeek(video) {
  if (!video?.seeking) return Promise.resolve();
  return new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
}

export function openerFramePromptPrefix(opener) {
  const frameName = normalizeOpenerFrameName(opener) || '开场参考图';
  const referenceName = /参考图$/u.test(frameName) ? frameName : `${frameName}参考图`;
  return `@Image1 是${referenceName}，作为本段视频的开场画面/起幅状态。生成时必须先从这张图的画面状态开始，保持人物站位、姿态、表情、道具位置、场景、光影和镜头方向连续，再按本段分镜推进。`;
}

export function withOpenerFramePrompt(prompt, opener) {
  const cleanPrompt = String(prompt || '').trim();
  if (!opener) return cleanPrompt;
  if (/第一张参考图是|@Image\d+\s*是(?:[「“][^」”]+[」”]|[^，]+)，作为本段视频的开场画面\/起幅状态|【本段开场状态】|本段开场状态说明/.test(cleanPrompt)) return cleanPrompt;
  return `${openerFramePromptPrefix(opener)}\n\n${cleanPrompt}`.trim();
}

export function shotPromptAlreadyHasHeader(body, header) {
  const cleanHeader = normalizeShotHeaderPrefix(header);
  if (!cleanHeader) return true;
  if (shotBodyHasPrefix(body, cleanHeader)) return true;
  if (cleanHeader.includes('\n')) return false;
  return String(body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .includes(cleanHeader);
}

export function buildShotPromptBody(shot, header = '', openerFrameName = '') {
  const body = String(shot?.body || '').trim();
  const cleanHeader = String(header || '').trim();
  const prefix = shotPromptAlreadyHasHeader(body, cleanHeader) ? '' : `${cleanHeader}\n`;
  return withOpenerFramePrompt(`${prefix}${body}`.trim(), openerFrameName);
}

export function previousShotNo(shots, no) {
  const list = Array.isArray(shots) ? shots : [];
  const index = list.findIndex((shot) => String(shot.no) === String(no));
  return index > 0 ? list[index - 1].no : null;
}

export function createTailFrameActionsRuntime({ api, message, messageBox, refs = {}, helpers = {}, globals = {} } = {}) {
  const autoTailFrameName = helpers.autoTailFrameName || (() => '本段开场状态参考图');
  const shotOpenerFrame = (no, episodeId = refs.episodeId.value) => {
    const storyboard = helpers.findStoryboard(episodeId);
    const meta = storyboard?.openerFrames?.[String(no)];
    return meta && meta.fromShotNo != null ? meta : null;
  };

  const shotOpenerFrameName = (no, episodeId = refs.episodeId.value) => shotOpenerFrameDisplayName(shotOpenerFrame(no, episodeId));

  const setShotOpenerFrame = (no, fromShotNo, url, name = '', options = {}) => {
    const episodeId = options.episodeId ?? refs.episodeId.value;
    const meta = createShotOpenerFrameMeta(fromShotNo, url, name);
    if (options.projectId != null && String(options.projectId) !== String(refs.project.value?.id || '')) return meta;
    const storyboard = helpers.findStoryboard(episodeId);
    if (!storyboard) return meta;
    if (!storyboard.openerFrames || typeof storyboard.openerFrames !== 'object') storyboard.openerFrames = {};
    storyboard.openerFrames[String(no)] = meta;
    if (options.save !== false) helpers.saveScript();
    return meta;
  };

  const clearShotOpenerFrame = (no) => {
    const storyboard = helpers.findStoryboard(refs.episodeId.value);
    if (storyboard?.openerFrames?.[String(no)]) {
      delete storyboard.openerFrames[String(no)];
      helpers.saveScript();
    }
  };

  const editShotOpenerFrameName = (no) => editShotOpenerFrameNameFlow(no, createEditShotOpenerFrameNameContext({
    message,
    messageBox,
    refs: { episodeId: refs.episodeId },
    helpers: {
      findStoryboard: helpers.findStoryboard,
      saveScript: helpers.saveScript,
    },
  }));

  const prevShotNo = (no) => previousShotNo(refs.currentShots.value, no);
  const openTailFramePicker = (no) => openTailFramePickerFlow(no, createOpenTailFramePickerContext({
    message,
    refs: { project: refs.project, picker: refs.picker, video: refs.video },
    helpers: { previousShotNo: prevShotNo, shotVideoUrl: helpers.shotVideoUrl, shotOpenerFrame, nextTick: helpers.nextTick },
  }));

  const onTailFramePickerLoaded = () => onTailFramePickerLoadedState(refs.video.value, refs.picker);
  const onTailFramePickerTimeUpdate = () => updateTailFramePickerTimeState(refs.video.value, refs.picker);
  const seekTailFramePicker = (value) => seekTailFramePickerState(refs.video.value, refs.picker, value);

  const saveTailFramePicker = () => saveTailFramePickerFlow(createSaveTailFramePickerContext({
    api,
    message,
    refs: { project: refs.project, video: refs.video, picker: refs.picker, episodeId: refs.episodeId },
    helpers: {
      waitForSeek: waitForTailFrameSeek,
      createCanvas: () => globals.document.createElement('canvas'),
      setShotOpenerFrame,
    },
  }));

  const capturePrevTailFrame = (no) => capturePrevTailFrameFlow(no, createCapturePrevTailFrameContext({
    api,
    message,
    refs: { project: refs.project, episodeId: refs.episodeId },
    helpers: {
      previousShotNo: prevShotNo,
      shotVideoUrl: helpers.shotVideoUrl,
      setShotOpenerFrame,
      autoTailFrameName,
    },
  }));

  return {
    shotOpenerFrame,
    shotOpenerFrameName,
    setShotOpenerFrame,
    clearShotOpenerFrame,
    editShotOpenerFrameName,
    openTailFramePicker,
    onTailFramePickerLoaded,
    onTailFramePickerTimeUpdate,
    seekTailFramePicker,
    saveTailFramePicker,
    prevShotNo,
    capturePrevTailFrame,
  };
}
