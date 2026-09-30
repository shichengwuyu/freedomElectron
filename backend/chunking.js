// 智能文本分块策略
// 支持：按段落/场景边界分块、上下文重叠、分块结果缓存

import crypto from 'crypto';

// 内存缓存（生产环境可换成 Redis）
const chunkCache = new Map();
const MAX_CACHE_SIZE = 100;

/**
 * 生成文本的哈希作为缓存键
 */
function textHash(text, chunkSize, overlapSize) {
  const key = `${text.substring(0, 1000)}:${chunkSize}:${overlapSize}:${text.length}`;
  return crypto.createHash('md5').update(key).digest('hex');
}

/**
 * 智能文本分块
 * @param {string} text - 要分块的文本
 * @param {Object} options - 分块选项
 * @param {number} options.chunkSize - 每块的目标大小（字符数）
 * @param {number} options.overlapSize - 块之间的重叠大小（字符数）
 * @param {boolean} options.useCache - 是否使用缓存
 * @param {string} options.strategy - 分块策略：'paragraph'（段落）、'scene'（场景）、'sentence'（句子）
 * @returns {Array<{text: string, index: number, start: number, end: number}>}
 */
export function smartChunk(text, options = {}) {
  const {
    chunkSize = 10000,
    overlapSize = 500,
    useCache = true,
    strategy = 'paragraph'
  } = options;

  // 检查缓存
  if (useCache) {
    const hash = textHash(text, chunkSize, overlapSize);
    if (chunkCache.has(hash)) {
      return chunkCache.get(hash);
    }
  }

  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  // 如果文本小于块大小，直接返回
  if (clean.length <= chunkSize) {
    return [{
      text: clean,
      index: 0,
      start: 0,
      end: clean.length,
      overlap: { before: 0, after: 0 }
    }];
  }

  let chunks;
  switch (strategy) {
    case 'scene':
      chunks = chunkByScene(clean, chunkSize, overlapSize);
      break;
    case 'sentence':
      chunks = chunkBySentence(clean, chunkSize, overlapSize);
      break;
    case 'paragraph':
    default:
      chunks = chunkByParagraph(clean, chunkSize, overlapSize);
      break;
  }

  // 添加上下文重叠
  const chunksWithOverlap = addContextOverlap(chunks, clean, overlapSize);

  // 缓存结果
  if (useCache) {
    const hash = textHash(text, chunkSize, overlapSize);
    chunkCache.set(hash, chunksWithOverlap);

    // LRU 缓存淘汰
    if (chunkCache.size > MAX_CACHE_SIZE) {
      const firstKey = chunkCache.keys().next().value;
      chunkCache.delete(firstKey);
    }
  }

  return chunksWithOverlap;
}

/**
 * 按段落边界分块（现有策略的改进版本）
 */
function chunkByParagraph(text, chunkSize, overlapSize) {
  // 按双换行符分割段落
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let currentChunk = '';
  let currentStart = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraWithSep = i < paragraphs.length - 1 ? para + '\n\n' : para;

    // 如果单个段落超过块大小，需要进一步切分
    if (para.length > chunkSize) {
      // 先保存当前累积的内容
      if (currentChunk) {
        chunks.push({
          text: currentChunk.trim(),
          start: currentStart,
          end: currentStart + currentChunk.length
        });
        currentStart += currentChunk.length;
        currentChunk = '';
      }

      // 对超长段落按句子切分
      const sentenceChunks = chunkBySentence(para, chunkSize, 0);
      sentenceChunks.forEach(chunk => {
        chunks.push({
          text: chunk.text,
          start: currentStart + chunk.start,
          end: currentStart + chunk.end
        });
      });
      currentStart += para.length + 2;
    } else if (currentChunk.length + paraWithSep.length > chunkSize) {
      // 当前块已满，保存并开始新块
      if (currentChunk) {
        chunks.push({
          text: currentChunk.trim(),
          start: currentStart,
          end: currentStart + currentChunk.length
        });
        currentStart += currentChunk.length;
      }
      currentChunk = paraWithSep;
    } else {
      // 添加到当前块
      currentChunk += paraWithSep;
    }
  }

  // 保存最后一块
  if (currentChunk) {
    chunks.push({
      text: currentChunk.trim(),
      start: currentStart,
      end: currentStart + currentChunk.length
    });
  }

  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

/**
 * 按场景边界分块
 * 场景标记：第X章、## 、场景XX、等
 */
function chunkByScene(text, chunkSize, overlapSize) {
  // 场景分隔符模式
  const sceneMarkers = /(?:^|\n)(?:#{1,3}\s+.*|第[一二三四五六七八九十\d]+[章节回集].*|场景\s*\d+.*|ACT\s+\d+.*)/gi;

  const scenes = [];
  let lastIndex = 0;
  let match;

  // 重置正则
  sceneMarkers.lastIndex = 0;

  while ((match = sceneMarkers.exec(text)) !== null) {
    if (match.index > lastIndex) {
      scenes.push({
        text: text.slice(lastIndex, match.index).trim(),
        start: lastIndex,
        end: match.index
      });
    }
    lastIndex = match.index;
  }

  // 添加最后一个场景
  if (lastIndex < text.length) {
    scenes.push({
      text: text.slice(lastIndex).trim(),
      start: lastIndex,
      end: text.length
    });
  }

  // 如果场景太大，继续按段落切分
  const finalChunks = [];
  scenes.forEach(scene => {
    if (scene.text.length > chunkSize) {
      const subChunks = chunkByParagraph(scene.text, chunkSize, 0);
      subChunks.forEach(sub => {
        finalChunks.push({
          text: sub.text,
          start: scene.start + sub.start,
          end: scene.start + sub.end
        });
      });
    } else {
      finalChunks.push(scene);
    }
  });

  return finalChunks.map((chunk, index) => ({ ...chunk, index }));
}

/**
 * 按句子边界分块
 */
function chunkBySentence(text, chunkSize, overlapSize) {
  // 中文和英文句子结束符
  const sentenceEnds = /[。！？；.!?;]\s*/g;
  const sentences = [];
  let lastIndex = 0;
  let match;

  while ((match = sentenceEnds.exec(text)) !== null) {
    sentences.push({
      text: text.slice(lastIndex, sentenceEnds.lastIndex),
      start: lastIndex,
      end: sentenceEnds.lastIndex
    });
    lastIndex = sentenceEnds.lastIndex;
  }

  // 添加最后一句（如果有）
  if (lastIndex < text.length) {
    sentences.push({
      text: text.slice(lastIndex),
      start: lastIndex,
      end: text.length
    });
  }

  // 合并句子直到达到块大小
  const chunks = [];
  let currentChunk = '';
  let currentStart = 0;

  for (const sentence of sentences) {
    if (currentChunk.length + sentence.text.length > chunkSize && currentChunk) {
      chunks.push({
        text: currentChunk.trim(),
        start: currentStart,
        end: currentStart + currentChunk.length
      });
      currentStart += currentChunk.length;
      currentChunk = sentence.text;
    } else {
      currentChunk += sentence.text;
    }
  }

  if (currentChunk) {
    chunks.push({
      text: currentChunk.trim(),
      start: currentStart,
      end: currentStart + currentChunk.length
    });
  }

  return chunks.map((chunk, index) => ({ ...chunk, index }));
}

/**
 * 为分块添加上下文重叠
 */
function addContextOverlap(chunks, fullText, overlapSize) {
  if (!overlapSize || chunks.length <= 1) {
    return chunks.map(chunk => ({
      ...chunk,
      overlap: { before: 0, after: 0 }
    }));
  }

  return chunks.map((chunk, i) => {
    let beforeOverlap = 0;
    let afterOverlap = 0;
    let textWithOverlap = chunk.text;

    // 添加前面的重叠
    if (i > 0) {
      const prevEnd = chunks[i - 1].end;
      const overlapStart = Math.max(chunk.start - overlapSize, prevEnd - overlapSize);
      if (overlapStart < chunk.start) {
        const before = fullText.slice(overlapStart, chunk.start);
        textWithOverlap = before + textWithOverlap;
        beforeOverlap = before.length;
      }
    }

    // 添加后面的重叠
    if (i < chunks.length - 1) {
      const nextStart = chunks[i + 1].start;
      const overlapEnd = Math.min(chunk.end + overlapSize, nextStart);
      if (overlapEnd > chunk.end) {
        const after = fullText.slice(chunk.end, overlapEnd);
        textWithOverlap = textWithOverlap + after;
        afterOverlap = after.length;
      }
    }

    return {
      ...chunk,
      text: textWithOverlap,
      overlap: { before: beforeOverlap, after: afterOverlap },
      coreStart: beforeOverlap,
      coreEnd: beforeOverlap + (chunk.end - chunk.start)
    };
  });
}

/**
 * 清空分块缓存
 */
export function clearChunkCache() {
  chunkCache.clear();
}

/**
 * 获取缓存统计信息
 */
export function getChunkCacheStats() {
  return {
    size: chunkCache.size,
    maxSize: MAX_CACHE_SIZE,
    keys: Array.from(chunkCache.keys())
  };
}

/**
 * 向后兼容：简单分块函数（保持原有接口）
 */
export function chunkText(text, chunkSize = 10000) {
  const chunks = smartChunk(text, {
    chunkSize,
    overlapSize: 0,
    useCache: false,
    strategy: 'paragraph'
  });
  return chunks.map(c => c.text);
}
