// 把一个超长镜头（如 30 秒）按时间码块拆成两段等长的镜头，便于换成只支持 15 秒的模型。
// 纯文本变换，不调用模型：避免再遇到"文本模型拒答"把正文写坏的情况。
// 时间轴有两种写法：金牌分镜导演模板的 [0.0s-3.0s]（方括号）和常见自定义模板的 【0-4s】（全角书名号），
// 两种都必须识别。注意：不能锚定行首 —— 实际分镜里时间码常带前缀（例如 `"" 【0-4s】【近景 缓推】`）。
const TIME_BLOCK_RE = /(?:【\s*(\d+(?:\.\d+)?)\s*[sS秒]?\s*[-~–—]\s*(\d+(?:\.\d+)?)\s*[sS秒]?\s*】|\[\s*(\d+(?:\.\d+)?)\s*[sS秒]?\s*[-~–—]\s*(\d+(?:\.\d+)?)\s*[sS秒]?\s*\])/g;
const CARRY_LINE_RE = /^\s*【承接定帧】.*$/m;

// 时间轴后面紧跟的「（基准总时长15秒）」之类是写给模型看的说明，不是画面内容，拆段时要去掉。
function stripBlockAnnotation(text) {
  return String(text || '').replace(/^[（(][^）)]{0,60}[）)]\s*/, '').trim();
}

export function shotTimeBlocks(body) {
  const source = String(body || '').replace(/\r\n?/g, '\n');
  const marks = [];
  TIME_BLOCK_RE.lastIndex = 0;
  let match;
  while ((match = TIME_BLOCK_RE.exec(source)) !== null) {
    const curly = match[1] !== undefined;
    marks.push({
      start: match.index,
      headEnd: TIME_BLOCK_RE.lastIndex,
      from: Number(curly ? match[1] : match[3]),
      to: Number(curly ? match[2] : match[4]),
      brackets: curly ? ['【', '】'] : ['[', ']'],
    });
  }
  if (!marks.length) return { header: source.trim(), blocks: [], brackets: ['【', '】'], totalSeconds: 0 };
  return {
    header: source.slice(0, marks[0].start).trim(),
    blocks: marks.map((mark, index) => ({
      from: mark.from,
      to: mark.to,
      text: stripBlockAnnotation(source.slice(mark.headEnd, index + 1 < marks.length ? marks[index + 1].start : source.length)),
    })),
    brackets: marks[0].brackets,
    totalSeconds: marks[marks.length - 1].to,
  };
}

function blockLine(block, offset, scale, brackets = ['【', '】']) {
  const from = Math.max(0, Math.round((block.from - offset) * scale));
  const to = Math.max(from + 1, Math.round((block.to - offset) * scale));
  const [open, close] = brackets;
  // 沿用原镜头的时间轴写法，避免拆完之后格式跟模板对不上。
  const head = open === '[' ? `[${from}.0s-${to}.0s]` : `【${from}-${to}s】`;
  return `${head}${block.text ? ` ${block.text}` : ''}`;
}

function firstLine(text) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean)[0] || '';
}

const TAG_PREFIX_RE = /^(?:【[^】]{0,40}】|\[[^\]]{0,60}\])\s*/;
const CONTENT_LABEL_RE = /^(?:画面|镜头|场景|动作|运镜|景别|音效)\s*[：:]\s*/;

// 取时间段正文的画面落点：先循环剥掉行首的【景别 运镜】、[场景：…] 标签，再剥掉「画面:」这类内容标签。
// 原来一步到位的 /^[^：:]*[：:]/ 会把 [场景：官道] 里的冒号当分隔符，切出「官道] …」这种残缺尾巴。
function cleanSegmentLabel(text) {
  let out = String(text || '').trim();
  let tag = out.match(TAG_PREFIX_RE);
  while (tag) {
    out = out.slice(tag[0].length).trim();
    tag = out.match(TAG_PREFIX_RE);
  }
  return out.replace(CONTENT_LABEL_RE, '').trim();
}

// 返回 { first, second, firstSeconds, secondSeconds, totalSeconds }；无法拆分（不足两个时间码块）时返回 null。
export function splitShotBodyInHalf(body, { targetSeconds = null, mode = 'stretch' } = {}) {
  const { header, blocks, totalSeconds, brackets } = shotTimeBlocks(body);
  const fallbackTarget = Math.ceil(totalSeconds / 2);
  const target = Math.max(2, Math.round(Number(targetSeconds) || fallbackTarget));
  if (blocks.length < 2 || !(totalSeconds > target)) return null;

  const findSplitIndex = () => {
    let index = 0;
    for (let i = 0; i < blocks.length - 1; i += 1) {
      if (mode === 'stretch' ? blocks[i].to < totalSeconds / 2 : blocks[i].to <= target) index = i + 1;
    }
    return Math.min(Math.max(1, index), blocks.length - 1);
  };
  const splitIndex = findSplitIndex();
  const firstBlocks = blocks.slice(0, splitIndex);
  const secondBlocks = blocks.slice(splitIndex);
  const firstSpan = firstBlocks[firstBlocks.length - 1].to;
  const splitSeconds = firstSpan;
  const secondSpan = totalSeconds - splitSeconds;
  const firstScale = mode === 'stretch' ? target / firstSpan : 1;
  const secondScale = mode === 'stretch' ? target / secondSpan : 1;

  const first = [header, ...firstBlocks.map((block) => blockLine(block, 0, firstScale, brackets))].filter(Boolean).join('\n');

  // 第二段的承接定帧：用上半段最后一个时间码块的画面作为起点，替换掉原头部里描述"本镜头开头"的那行。
  const carrySource = cleanSegmentLabel(firstLine(firstBlocks[firstBlocks.length - 1].text)).slice(0, 140);
  const carryLine = carrySource ? `【承接定帧】承接上一镜头结尾：${carrySource}` : '';
  const secondHeader = carryLine && CARRY_LINE_RE.test(header)
    ? header.replace(CARRY_LINE_RE, carryLine)
    : [header, carryLine].filter(Boolean).join('\n');
  const second = [secondHeader, ...secondBlocks.map((block) => blockLine(block, splitSeconds, secondScale, brackets))].filter(Boolean).join('\n');

  return {
    first,
    second,
    firstSeconds: mode === 'stretch' ? target : Math.round(splitSeconds),
    secondSeconds: mode === 'stretch' ? target : Math.round(totalSeconds - splitSeconds),
    totalSeconds,
    splitAtSeconds: Math.round(splitSeconds * 10) / 10,
    blockCount: blocks.length,
  };
}

// 只有"比目标模型的时长上限还长、且时间码块足够"的镜头才需要拆（默认按 15 秒模型判断）。
export function canSplitShotBody(body, { maxSeconds = 15 } = {}) {
  const { blocks, totalSeconds } = shotTimeBlocks(body);
  return blocks.length >= 2 && totalSeconds > Math.max(4, Math.round(Number(maxSeconds) || 15));
}

export function shotSplitTargetSeconds(body) {
  return Math.ceil(shotTimeBlocks(body).totalSeconds / 2) || 0;
}

// 正文时间码总长 vs 本次实际提交时长：提交时长更短说明内容会被截断（全局「默认时长」同时是上限，
// 把上限调低会让没拆分的长镜头被静默砍短），这里给界面一个明确的提醒依据。
export function shotDurationMismatch(body, submitSeconds, { tolerance = 1 } = {}) {
  const { blocks, totalSeconds } = shotTimeBlocks(body);
  const submit = Number(submitSeconds);
  if (!blocks.length || !(totalSeconds > 0) || !Number.isFinite(submit)) return null;
  if (totalSeconds <= submit + tolerance) return null;
  return { textSeconds: totalSeconds, submitSeconds: submit, blocks: blocks.length, truncatedSeconds: totalSeconds - submit };
}

// ---------- 无时间码时的兜底拆分 ----------
// 自定义分镜提示词不保证每镜都写时间码（实测有整集完全没有时间段的），这些镜头按时间码拆不了。
// 这里按正文的段落边界均分，给用户一个手动出口。注意：这是「拆内容」不是「拆时间」——
// 两段各自沿用原镜头的时长设置，不重新标注时间码，所以不会凭空编造时长。

// 段落起点：时间段头/小节标题（【…】）、模型输出的段前标记（"" ）、音效行（[…]）、台词行（角色：）。
// 在这些行前切开，避免把一句台词和它紧跟的音效/动作拆到两段。
function isSegmentStartLine(line) {
  const text = String(line || '').trim();
  if (!text) return false;
  if (/^(?:【|\[|""|")/.test(text)) return true;
  return /^[^\s：:]{1,12}[：:]/.test(text);
}

export function shotParagraphLines(body) {
  const source = String(body || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];
  return source.split('\n').map((line) => line.trim()).filter(Boolean);
}

// 没有时间码（一个都没有）但正文够长、且能切出两段时才允许按段落拆。
// 只用 80 字作下限：和 storyboardCoverageService 里「分镜过短」的判定保持一致。
export function canSplitShotByParagraphs(body) {
  if (shotTimeBlocks(body).blocks.length !== 0) return false;
  const source = String(body || '').trim();
  if (source.length < 80) return false;
  return shotParagraphLines(source).length >= 2;
}

// 返回 { first, second, paragraphCount, splitAtLine }；无法按段落拆分时返回 null。
export function splitShotBodyByParagraphs(body) {
  if (!canSplitShotByParagraphs(body)) return null;
  const lines = shotParagraphLines(body);
  const total = lines.join('\n').length;

  // 先按累计字符数找到最接近中点的行边界，再在附近优先挪到“段落起点”行上。
  let midpointLine = -1;
  let acc = 0;
  for (let i = 0; i < lines.length - 1; i += 1) {
    acc += lines[i].length + 1;
    if (acc >= total / 2) { midpointLine = i + 1; break; }
  }
  if (midpointLine < 1) return null;

  let cut = midpointLine;
  outer: for (let distance = 0; distance <= 3; distance += 1) {
    for (const candidate of [midpointLine + distance, midpointLine - distance]) {
      if (candidate >= 1 && candidate <= lines.length - 1 && isSegmentStartLine(lines[candidate])) {
        cut = candidate;
        break outer;
      }
    }
  }

  const first = lines.slice(0, cut).join('\n').trim();
  const second = lines.slice(cut).join('\n').trim();
  if (!first || !second) return null;
  return { first, second, paragraphCount: lines.length, splitAtLine: cut };
}
