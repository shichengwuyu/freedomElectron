const IGNORED_SPEAKER_LABELS = new Set([
  '画面',
  '画面与动作',
  '动作',
  '镜头',
  '镜头特写',
  '场景',
  '场景名称',
  '场次',
  '时间',
  '地点',
  '人物',
  '角色',
  '登场人物',
  '时段',
  '内外景',
  '天气',
  '时长',
  '转场',
  '备注',
  '说明',
  '运镜',
  '景别',
  '构图',
  '音效',
  '音乐',
  '系统界面',
  '系统提示',
  '字幕',
  '黑幕字幕',
  '屏幕文字',
  '画面文字',
]);

function storyboardHeaderRegex() {
  return /^[ \t]*(?:(?:#{1,6})\s*|(?:[-+*>])\s+)?(?:\*\*|__|`{1,3})?[ \t]*(?:(?:分镜|镜头|剧情|生成段落)\s*(\d+)\s*[：:]|【(?:分镜|镜头|剧情|生成段落)\s*(\d+)】)[ \t]*(?:\*\*|__|`{1,3})?/gm;
}

function cleanMarkdownLine(value) {
  return String(value || '')
    .trim()
    .replace(/^[>\-+*]\s+/, '')
    .replace(/^(?:#{1,6})\s*/, '')
    .replace(/\*\*|__/g, '')
    .replace(/`+/g, '')
    .trim();
}

export function normalizeStoryboardComparableText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\*\*|__|`+/g, '')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function cleanDialogueText(value) {
  return String(value || '')
    .trim()
    .replace(/^[（(][^）)]{0,80}[）)]\s*/, '')
    .replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, '')
    .trim();
}

function dialogueFromLine(line) {
  const source = cleanMarkdownLine(line);
  if (!source) return null;

  let speaker = '';
  let text = '';
  const colon = source.match(/^([^：:\n]{1,32})\s*[：:]\s*(.+)$/u);
  if (colon) {
    speaker = colon[1].trim();
    text = colon[2].trim();
  } else {
    const parenthetical = source.match(/^([^\s（(：:]{1,24})\s*[（(][^）)]{0,80}[）)]\s*(.+)$/u);
    if (parenthetical) {
      speaker = parenthetical[1].trim();
      text = parenthetical[2].trim();
    } else {
      const spaced = source.match(/^([\p{L}\p{N}_·]{1,24})[ \t　]{2,}(.+)$/u);
      if (spaced) {
        speaker = spaced[1].trim();
        text = spaced[2].trim();
      }
    }
  }

  speaker = speaker.replace(/[（(].*$/, '').trim();
  if (!speaker || /^[【[]/.test(speaker) || IGNORED_SPEAKER_LABELS.has(speaker)) return null;
  text = cleanDialogueText(text);
  const comparable = normalizeStoryboardComparableText(text);
  if (comparable.length < 2) return null;
  return { speaker, text, comparable };
}

export function extractStoryboardSourceDialogues(sourceText) {
  const dialogues = [];
  for (const line of String(sourceText || '').split(/\r?\n/)) {
    const dialogue = dialogueFromLine(line);
    if (dialogue) dialogues.push(dialogue);
  }
  return dialogues;
}

function sourceBlocks(sourceText) {
  const source = String(sourceText || '').trim();
  if (!source) return [];
  const paragraphs = source.split(/\n\s*\n/).map((item) => cleanMarkdownLine(item)).filter(Boolean);
  const lines = source.split(/\r?\n/).map((item) => cleanMarkdownLine(item)).filter(Boolean);
  return paragraphs.length >= 2 ? paragraphs : lines;
}

export function analyzeStoryboardSource(sourceText) {
  const source = String(sourceText || '').trim();
  const blocks = sourceBlocks(source);
  const dialogues = extractStoryboardSourceDialogues(source);
  const dialogueChars = dialogues.reduce((sum, item) => sum + item.comparable.length, 0);
  const sceneCount = Math.max(
    0,
    (source.match(/(?:^|\n)\s*(?:第[一二三四五六七八九十百零〇0-9]+场|场景\s*[一二三四五六七八九十百零〇0-9]+)/g) || []).length,
  );
  const minimumShots = Math.max(
    1,
    Math.min(6, Math.max(
      sceneCount,
      Math.ceil(blocks.length / 12),
      Math.ceil(dialogueChars / 80),
      Math.ceil(source.length / 1100),
    )),
  );
  return {
    chars: source.length,
    beatCount: blocks.length,
    sceneCount,
    dialogues,
    dialogueChars,
    minimumShots,
    lastBeat: blocks.length ? blocks[blocks.length - 1].slice(-260) : '',
  };
}

export function recommendedStoryboardChunkSize(value, templateId = 'p') {
  const configured = Number(value);
  if (String(templateId || 'p') === 'p') {
    // Keep the P template at a predictable 4000-character segment size.
    // The global extraction chunk setting should not silently make storyboard
    // requests too large and reintroduce long stalls.
    return 4000;
  }
  if (!Number.isFinite(configured) || configured <= 0) return 7000;
  return Math.max(4000, Math.min(Math.floor(configured), 10000));
}

export function countStoryboardShots(text) {
  return [...String(text || '').matchAll(storyboardHeaderRegex())].length;
}

export function renumberStoryboardShots(text, startNo = 1) {
  let next = Math.max(1, Number(startNo) || 1);
  let count = 0;
  let out = String(text || '').trim().replace(storyboardHeaderRegex(), () => {
    count += 1;
    return `【镜头${next++}】`;
  });
  if (!count && out) {
    count = 1;
    out = `【镜头${next++}】\n${out}`;
  }
  return { text: out.trim(), nextNo: next, count };
}

function dialogueAppears(outputComparable, dialogueComparable) {
  if (!dialogueComparable) return true;
  if (outputComparable.includes(dialogueComparable)) return true;
  if (dialogueComparable.length < 16) return false;
  const fragmentLength = Math.min(14, Math.max(8, Math.floor(dialogueComparable.length / 3)));
  const head = dialogueComparable.slice(0, fragmentLength);
  const tail = dialogueComparable.slice(-fragmentLength);
  return outputComparable.includes(head) && outputComparable.includes(tail);
}

export function storyboardSegmentValidationError(text, options = {}) {
  const raw = String(text || '').trim();
  if (!raw) return '模型返回的分镜为空';
  if (raw.length < 80) return '模型返回的分镜过短，疑似没有完整生成';

  const shotCount = countStoryboardShots(raw);
  if (!shotCount) return '模型返回内容缺少可识别的分镜编号';

  const analysis = options.analysis || analyzeStoryboardSource(options.sourceText || '');
  const minimumShots = Math.max(1, Number(options.minimumShots) || analysis.minimumShots || 1);
  if (shotCount < minimumShots) {
    return `只生成了 ${shotCount} 个分镜，本段至少需要 ${minimumShots} 个分镜才能覆盖完整剧本`;
  }

  const tail = raw.slice(-1800);
  if (!/【(?:定格基准|定格画面|结尾帧锚定)】/.test(tail) && !/【本段结尾状态台账】/.test(tail)) {
    return '模型返回内容没有完整收束到最后一个镜头的定格基准';
  }

  if (analysis.dialogues?.length) {
    const outputComparable = normalizeStoryboardComparableText(raw);
    const missing = analysis.dialogues.filter((dialogue) => !dialogueAppears(outputComparable, dialogue.comparable));
    if (missing.length) {
      const preview = missing.slice(0, 2).map((item) => `${item.speaker}：${item.text}`).join('；');
      return `遗漏本段对白 ${missing.length} 句，例如：${preview}`;
    }
  }
  return '';
}

export function buildStoryboardCoverageGuard(sourceText, index, total, maxDuration = 15) {
  const analysis = analyzeStoryboardSource(sourceText);
  const configuredMaxDuration = Math.max(5, Math.min(500, Math.floor(Number(maxDuration) || 15)));
  const lines = [
    '【完整覆盖硬性要求】',
    `本段是第 ${index + 1}/${Math.max(1, Number(total) || 1)} 段剧本输入。必须从本段第一行处理到最后一行；不得因为篇幅、节奏或结尾标记省略本段尾部。`,
    `本段约有 ${analysis.beatCount} 个剧情节拍、${analysis.dialogues.length} 句对白/OS；至少输出 ${analysis.minimumShots} 个连续编号的【镜头X】。严禁把整段剧本塞进单一${configuredMaxDuration}秒镜头。`,
    `每个镜头的时间轴上限为 ${configuredMaxDuration} 秒；超过该时长必须拆分为下一个镜头，不得删减对白、OS 或动作。`,
    '所有原文对白、OS、画外音和屏幕/字幕信息都必须按原顺序进入分镜；无对白动作也必须用画面、动作、音效或转场承接。',
    '输出必须以最后一个镜头的【定格基准】完整收束；未写到本段最后剧情前不得停止。',
  ];
  if (analysis.lastBeat) lines.push(`【本段必须覆盖到的最后剧情落点】\n${analysis.lastBeat}`);
  return { text: lines.join('\n'), analysis };
}

export function storyboardRetryInstruction(error, sourceText) {
  const analysis = analyzeStoryboardSource(sourceText);
  return [
    `上一版分镜未通过完整性校验：${error?.message || error || '内容不完整'}。`,
    '请从本段第一行开始完整重写，不要续写上一版，也不要解释。',
    `至少输出 ${analysis.minimumShots} 个“【镜头X】”，逐句保留本段 ${analysis.dialogues.length} 句对白/OS，并一直覆盖到最后剧情落点。`,
    analysis.lastBeat ? `最后必须覆盖：${analysis.lastBeat}` : '',
  ].filter(Boolean).join('\n');
}
