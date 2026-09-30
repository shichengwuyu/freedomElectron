import { DATA_DIR } from './config.js';
import path from 'path';

import { readJsonFile, writeJsonAtomic } from './lib/atomicJson.js';

const MARKET_FILE = path.join(DATA_DIR, 'novel-market.json');
const CACHE_TTL_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const memoryCache = new Map();

const MARKET_SOURCE_DEFINITIONS = [
  { id: 'fanqie', label: '番茄小说', shortLabel: '番茄', group: 'cn-novel', groupLabel: '国内网文', syncMode: 'live', sourceUrl: 'https://fanqienovel.com/rank' },
  { id: 'qidian', label: '起点中文网', shortLabel: '起点', group: 'cn-novel', groupLabel: '国内网文', syncMode: 'live', sourceUrl: 'https://m.qidian.com/rank/yuepiao' },
  { id: 'qqread', label: 'QQ 阅读', shortLabel: 'QQ阅读', group: 'cn-novel', groupLabel: '国内网文', syncMode: 'live', sourceUrl: 'https://book.qq.com/book-rank' },
  { id: 'qimao', label: '七猫小说', shortLabel: '七猫', group: 'cn-novel', groupLabel: '国内网文', syncMode: 'manual', sourceUrl: 'https://www.qimao.com/', note: '官网当前限制服务端访问，可从 App 或官网复制榜单文本后拆书。' },
  { id: 'jjwxc', label: '晋江文学城', shortLabel: '晋江', group: 'cn-novel', groupLabel: '国内网文', syncMode: 'manual', sourceUrl: 'https://www.jjwxc.net/', note: '公开页面编码与榜单结构不稳定，暂以榜单文本导入保证数据准确。' },
  { id: 'hongguo', label: '红果短剧', shortLabel: '红果', group: 'drama', groupLabel: '短剧 / 漫剧', syncMode: 'live', sourceUrl: 'https://hongguoduanju.com/' },
  { id: 'huolong', label: '火龙漫剧', shortLabel: '火龙漫剧', group: 'drama', groupLabel: '短剧 / 漫剧', syncMode: 'manual', sourceUrl: 'https://sj.qq.com/appdetail/com.tencent.kairos', note: '火龙漫剧目前只在 App 内展示内容趋势，没有公开网页榜单或开放接口。' },
  { id: 'goodnovel', label: 'GoodNovel', shortLabel: 'GoodNovel', group: 'overseas', groupLabel: '海外网文', syncMode: 'live', sourceUrl: 'https://www.goodnovel.com/rankings' },
  { id: 'dreame', label: 'Dreame', shortLabel: 'Dreame', group: 'overseas', groupLabel: '海外网文', syncMode: 'live', sourceUrl: 'https://www.dreame.com/' },
  { id: 'webnovel', label: 'WebNovel', shortLabel: 'WebNovel', group: 'overseas', groupLabel: '海外网文', syncMode: 'manual', sourceUrl: 'https://www.webnovel.com/ranking/novel', note: '官方排行榜启用了浏览器验证，暂不绕过保护，可导入公开榜单文本进行研究。' },
];
const MARKET_SOURCE_BY_ID = new Map(MARKET_SOURCE_DEFINITIONS.map((source) => [source.id, source]));

export function listNovelMarketSources({ includeManual = false } = {}) {
  return MARKET_SOURCE_DEFINITIONS
    .filter((source) => includeManual || source.syncMode === 'live')
    .map((source) => ({ ...source }));
}

function nowIso() {
  return new Date().toISOString();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 0));
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function jsonStringField(html, field) {
  const match = String(html || '').match(new RegExp(`"${field}":"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return '';
  try { return JSON.parse(`"${match[1]}"`); } catch { return match[1]; }
}

function containsPrivateUse(text) {
  return /[\uE000-\uF8FF]/.test(String(text || ''));
}

function absoluteUrl(value, origin) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  try { return new URL(raw, origin).toString(); } catch { return ''; }
}

function parseWordCount(value) {
  const text = String(value || '').replace(/,/g, '').trim();
  const number = Number(text.match(/[\d.]+/)?.[0]) || 0;
  if (/亿/.test(text)) return Math.round(number * 100_000_000);
  if (/万/.test(text)) return Math.round(number * 10_000);
  return Math.round(number);
}

export function parseFanqieCategoryTags(value) {
  const raw = String(value || '').trim();
  if (!raw || containsPrivateUse(raw)) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return [...new Set(parsed
        .map((item) => String(item?.Name || item?.name || '').trim())
        .filter((name) => name && !containsPrivateUse(name)))]
        .slice(0, 8);
    }
  } catch { /* 旧详情页可能直接返回单个分类名 */ }
  return raw.length <= 24 && !/[\[\]{}]/.test(raw) ? [raw] : [];
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function pooledMap(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try { results[index] = await worker(items[index], index); } catch { results[index] = null; }
    }
  });
  await Promise.all(runners);
  return results.filter(Boolean);
}

function normalizeMarketItem(item = {}, index = 0) {
  const source = MARKET_SOURCE_BY_ID.has(String(item.source || '')) ? String(item.source) : 'fanqie';
  return {
    id: String(item.id || item.bookId || item.seriesId || '').trim(),
    source,
    rank: Math.max(1, Number(item.rank) || index + 1),
    title: String(item.title || '').trim().slice(0, 160),
    author: String(item.author || '').trim().slice(0, 100),
    intro: String(item.intro || '').trim().slice(0, 3000),
    tags: (Array.isArray(item.tags) ? item.tags : []).map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 12),
    wordCount: Math.max(0, Number(item.wordCount) || 0),
    episodeCount: Math.max(0, Number(item.episodeCount) || 0),
    metric: String(item.metric || '').trim().slice(0, 120),
    coverUrl: String(item.coverUrl || '').trim().slice(0, 2000),
    detailUrl: String(item.detailUrl || '').trim().slice(0, 2000),
  };
}

async function fanqieBookDetail(bookId, rank) {
  const detailUrl = `https://fanqienovel.com/page/${bookId}`;
  const html = await fetchText(detailUrl);
  const titleTag = decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '');
  const title = jsonStringField(html, 'bookName') || titleTag.split('完整版')[0].trim();
  let intro = jsonStringField(html, 'abstract');
  if (containsPrivateUse(intro)) intro = '';
  const author = jsonStringField(html, 'author');
  const category = jsonStringField(html, 'categoryV2') || jsonStringField(html, 'category');
  return normalizeMarketItem({
    id: bookId,
    source: 'fanqie',
    rank,
    title,
    author: containsPrivateUse(author) ? '' : author,
    intro,
    tags: parseFanqieCategoryTags(category),
    wordCount: Number(jsonStringField(html, 'wordNumber')) || 0,
    coverUrl: jsonStringField(html, 'thumbUri'),
    detailUrl,
  }, rank - 1);
}

async function fetchFanqieRanking(limit = 12) {
  const pageUrl = 'https://fanqienovel.com/rank';
  const html = await fetchText(pageUrl);
  const ids = [];
  for (const match of html.matchAll(/"bookId":"(\d+)"/g)) {
    if (!ids.includes(match[1])) ids.push(match[1]);
    if (ids.length >= limit) break;
  }
  if (!ids.length) throw new Error('番茄榜单没有返回可验证的书籍 ID');
  const items = await pooledMap(ids, 4, (id, index) => fanqieBookDetail(id, index + 1));
  if (!items.length) throw new Error('番茄详情页暂时无法读取');
  return {
    source: 'fanqie',
    sourceLabel: '番茄小说',
    listLabel: '官方排行榜',
    sourceUrl: pageUrl,
    fetchedAt: nowIso(),
    verified: true,
    items,
  };
}

export function parseQidianRankingHtml(html, limit = 12) {
  const items = [];
  for (const match of String(html || '').matchAll(/<a\s+href=["']\/\/m\.qidian\.com\/book\/(\d+)\/["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const body = match[2];
    const title = stripTags(body.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || '');
    if (!title) continue;
    const rank = Number(stripTags(body.match(/class=["'][^"']*_ranking_[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')) || items.length + 1;
    const intro = stripTags(body.match(/class=["'][^"']*_bookDesc_[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const meta = stripTags(body.match(/class=["'][^"']*_subTitle_[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '').split('·').map((part) => part.trim()).filter(Boolean);
    const metric = stripTags(body.match(/class=["'][^"']*_bookTitleR_[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    items.push(normalizeMarketItem({
      id: match[1], source: 'qidian', rank, title, intro,
      author: meta[0] || '',
      tags: meta[1] ? [meta[1]] : [],
      wordCount: parseWordCount(meta.find((part) => /字/.test(part)) || ''),
      metric,
      coverUrl: absoluteUrl(body.match(/data-src=["']([^"']+)["']/i)?.[1] || '', 'https://m.qidian.com/'),
      detailUrl: `https://m.qidian.com/book/${match[1]}/`,
    }, items.length));
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchQidianRanking(limit = 12) {
  const pageUrl = 'https://m.qidian.com/rank/yuepiao';
  const items = parseQidianRankingHtml(await fetchText(pageUrl), limit);
  if (!items.length) throw new Error('起点月票榜没有返回可验证条目');
  return { source: 'qidian', sourceLabel: '起点中文网', listLabel: '官方月票榜', sourceUrl: pageUrl, fetchedAt: nowIso(), verified: true, items };
}

export function parseQqReadRankingHtml(html, limit = 12) {
  const chunks = String(html || '').split(/<div class=["']book-large rank-book["'][^>]*>/i).slice(1);
  const items = [];
  for (const chunk of chunks) {
    const id = chunk.match(/href=["']\/\/book\.qq\.com\/book-detail\/(\d+)["']/i)?.[1] || '';
    const title = stripTags(chunk.match(/<h4[^>]*class=["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i)?.[1] || '');
    if (!id || !title) continue;
    const intro = stripTags(chunk.match(/<p[^>]*class=["']intro["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] || '');
    const author = stripTags(chunk.match(/book-writer\/\d+[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
    const category = stripTags(chunk.match(/book-cate\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] || '').replace(/^·/, '').trim();
    const status = stripTags(chunk.match(/<span[^>]*>\s*·?\s*(连载|完本)\s*<\/span>/i)?.[1] || '');
    const wordText = stripTags(chunk.match(/<span[^>]*>\s*·?\s*([\d.]+\s*[万亿]?字)\s*<\/span>/i)?.[1] || '');
    items.push(normalizeMarketItem({
      id, source: 'qqread', rank: items.length + 1, title, author, intro,
      tags: [category, status].filter(Boolean),
      wordCount: parseWordCount(wordText),
      detailUrl: `https://book.qq.com/book-detail/${id}`,
    }, items.length));
    if (items.length >= limit) break;
  }
  return items;
}

async function fetchQqReadRanking(limit = 12) {
  const pageUrl = 'https://book.qq.com/book-rank';
  const items = parseQqReadRankingHtml(await fetchText(pageUrl), limit);
  if (!items.length) throw new Error('QQ 阅读热门榜没有返回可验证条目');
  return { source: 'qqread', sourceLabel: 'QQ 阅读', listLabel: '官方热门榜', sourceUrl: pageUrl, fetchedAt: nowIso(), verified: true, items };
}

function hongguoHomepageItems(html, limit) {
  const items = [];
  const seen = new Set();
  const fullHtml = String(html || '');
  const hotIndex = fullHtml.indexOf('热门短剧');
  const sourceHtml = hotIndex >= 0 ? fullHtml.slice(hotIndex) : fullHtml;
  for (const match of sourceHtml.matchAll(/<a[^>]+href=["']\/detail\?series_id=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const id = match[1];
    if (seen.has(id)) continue;
    const paragraphs = [...match[2].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((item) => stripTags(item[1])).filter(Boolean);
    const episodeText = paragraphs.find((text) => /^全\d+集$/.test(text)) || '';
    const title = paragraphs.find((text) => text !== episodeText && text.length >= 2) || '';
    if (!title) continue;
    const allText = stripTags(match[2]);
    const tags = [...match[2].matchAll(/<(?:span|div)[^>]*>([^<>]{2,12})<\/(?:span|div)>/gi)]
      .map((item) => stripTags(item[1]))
      .filter((text) => text && text !== title && text !== episodeText && allText.includes(text));
    seen.add(id);
    items.push(normalizeMarketItem({
      id,
      source: 'hongguo',
      rank: items.length + 1,
      title,
      tags: [...new Set(tags)],
      episodeCount: Number(episodeText.match(/\d+/)?.[0]) || 0,
      detailUrl: `https://hongguoduanju.com/detail?series_id=${id}`,
    }, items.length));
    if (items.length >= limit) break;
  }
  return items;
}

async function enrichHongguoItem(item) {
  const html = await fetchText(item.detailUrl);
  const descriptions = [...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)/gi)]
    .map((match) => decodeHtml(match[1])).filter((text) => text.length > 30);
  const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => stripTags(match[1]));
  const intro = descriptions[0] || paragraphs.find((text) => text.length > 60 && !/下载安装|许可证|ICP备/.test(text)) || '';
  return normalizeMarketItem({ ...item, intro }, item.rank - 1);
}

async function fetchHongguoRanking(limit = 12) {
  const pageUrl = 'https://hongguoduanju.com/';
  const html = await fetchText(pageUrl);
  const baseItems = hongguoHomepageItems(html, limit);
  if (!baseItems.length) throw new Error('红果官网没有返回公开热门内容');
  const enriched = await pooledMap(baseItems, 4, enrichHongguoItem);
  const enrichedById = new Map(enriched.map((item) => [item.id, item]));
  const items = baseItems.map((item) => enrichedById.get(item.id) || item);
  return {
    source: 'hongguo',
    sourceLabel: '红果短剧',
    listLabel: '官方热门短剧',
    sourceUrl: pageUrl,
    fetchedAt: nowIso(),
    verified: true,
    items,
  };
}

function embeddedJson(html, startMarker, endMarker) {
  const text = String(html || '');
  const start = text.indexOf(startMarker);
  if (start < 0) return null;
  const contentStart = start + startMarker.length;
  const end = text.indexOf(endMarker, contentStart);
  if (end < 0) return null;
  try { return JSON.parse(text.slice(contentStart, end)); } catch { return null; }
}

export function parseGoodNovelRankingHtml(html, limit = 12) {
  const state = embeddedJson(html, 'window.__INITIAL_STATE__=', ';(function()');
  const books = Array.isArray(state?.HomeDataModule?.books) ? state.HomeDataModule.books : [];
  return books.slice(0, limit).map((book, index) => normalizeMarketItem({
    id: book.bookId || book.sourceId,
    source: 'goodnovel',
    rank: index + 1,
    title: book.bookName,
    author: book.pseudonym,
    intro: book.introduction,
    tags: [...(book.genreNames || []), ...(book.newTagsNames || [])],
    wordCount: book.totalWords,
    metric: [book.ratings ? `${book.ratings}分` : '', book.viewCountDisplay ? `${book.viewCountDisplay}阅读` : ''].filter(Boolean).join(' · '),
    coverUrl: book.cover,
    detailUrl: `https://www.goodnovel.com/book/${book.bookResourceUrl || book.bookId || ''}`,
  }, index)).filter((item) => item.id && item.title);
}

async function fetchGoodNovelRanking(limit = 12) {
  const pageUrl = 'https://www.goodnovel.com/rankings';
  const items = parseGoodNovelRankingHtml(await fetchText(pageUrl), limit);
  if (!items.length) throw new Error('GoodNovel 高分榜没有返回可验证条目');
  return { source: 'goodnovel', sourceLabel: 'GoodNovel', listLabel: '官方高分榜', sourceUrl: pageUrl, fetchedAt: nowIso(), verified: true, items };
}

function dreameStoryUrl(book = {}) {
  const slug = String(book.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `https://www.dreame.com/story/${book.bid}${slug ? `-${slug}` : ''}`;
}

export function parseDreameRankingHtml(html, limit = 12) {
  const match = String(html || '').match(/<script id=["']__NEXT_DATA__["'] type=["']application\/json["']>([\s\S]*?)<\/script>/i);
  let data = null;
  try { data = match?.[1] ? JSON.parse(match[1]) : null; } catch { data = null; }
  const rankData = data?.props?.pageProps?.staticBookList?.rankData;
  const ranking = (Array.isArray(rankData) ? rankData : []).find((item) => /best\s*selling/i.test(item?.name || ''))
    || (Array.isArray(rankData) ? rankData[0] : null);
  return (Array.isArray(ranking?.data) ? ranking.data : []).slice(0, limit).map((book, index) => normalizeMarketItem({
    id: book.bid,
    source: 'dreame',
    rank: index + 1,
    title: book.name,
    intro: book.descr,
    tags: ['English'],
    metric: ranking?.name || '',
    coverUrl: book.cover_url,
    detailUrl: dreameStoryUrl(book),
  }, index)).filter((item) => item.id && item.title);
}

async function fetchDreameRanking(limit = 12) {
  const pageUrl = 'https://www.dreame.com/';
  const items = parseDreameRankingHtml(await fetchText(pageUrl), limit);
  if (!items.length) throw new Error('Dreame 畅销榜没有返回可验证条目');
  return { source: 'dreame', sourceLabel: 'Dreame', listLabel: '官方 Best Selling', sourceUrl: pageUrl, fetchedAt: nowIso(), verified: true, items };
}

function manualSourceSnapshot(source) {
  return {
    source: source.id,
    sourceLabel: source.label,
    listLabel: '榜单文本导入',
    sourceUrl: source.sourceUrl,
    fetchedAt: nowIso(),
    verified: false,
    manual: true,
    note: source.note || '该来源暂时没有可稳定读取的公开网页榜单。',
    items: [],
  };
}

function readStore() {
  const stored = readJsonFile(MARKET_FILE, null);
  return stored && typeof stored === 'object'
    ? { version: 1, snapshots: stored.snapshots || {}, studies: Array.isArray(stored.studies) ? stored.studies : [] }
    : { version: 1, snapshots: {}, studies: [] };
}

function saveSnapshot(snapshot) {
  const store = readStore();
  store.snapshots[snapshot.source] = snapshot;
  writeJsonAtomic(MARKET_FILE, store);
}

export async function getNovelMarketRanking(source = 'fanqie', { refresh = false, limit = 12 } = {}) {
  const safeSource = MARKET_SOURCE_BY_ID.has(String(source || '')) ? String(source) : 'fanqie';
  const definition = MARKET_SOURCE_BY_ID.get(safeSource);
  if (definition.syncMode === 'manual') return manualSourceSnapshot(definition);
  const cached = memoryCache.get(safeSource) || readStore().snapshots[safeSource];
  const age = cached?.fetchedAt ? Date.now() - new Date(cached.fetchedAt).getTime() : Infinity;
  if (!refresh && cached && age < CACHE_TTL_MS) return { ...cached, cached: true };
  try {
    const safeLimit = Math.max(5, Math.min(30, Number(limit) || 12));
    const fetchers = {
      fanqie: fetchFanqieRanking,
      qidian: fetchQidianRanking,
      qqread: fetchQqReadRanking,
      hongguo: fetchHongguoRanking,
      goodnovel: fetchGoodNovelRanking,
      dreame: fetchDreameRanking,
    };
    const snapshot = await fetchers[safeSource](safeLimit);
    memoryCache.set(safeSource, snapshot);
    saveSnapshot(snapshot);
    return { ...snapshot, cached: false };
  } catch (error) {
    if (cached) return { ...cached, cached: true, stale: true, warning: error.message };
    throw error;
  }
}

export function saveNovelMarketStudy(study) {
  const store = readStore();
  const saved = {
    id: String(study.id || `study_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    novelId: String(study.novelId || ''),
    sourceItems: (Array.isArray(study.sourceItems) ? study.sourceItems : []).map(normalizeMarketItem).slice(0, 20),
    analysis: study.analysis && typeof study.analysis === 'object' ? study.analysis : {},
    createdAt: study.createdAt || nowIso(),
  };
  store.studies = [saved, ...store.studies.filter((item) => item.id !== saved.id)].slice(0, 100);
  writeJsonAtomic(MARKET_FILE, store);
  return saved;
}

export function listNovelMarketStudies(novelId) {
  return readStore().studies.filter((study) => !novelId || study.novelId === String(novelId)).slice(0, 20);
}
