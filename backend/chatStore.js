import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

const CHAT_DIR = path.join(DATA_DIR, '.chat');
const CHAT_DB_PATH = path.join(CHAT_DIR, 'chat.sqlite3');
export const MAX_CHAT_PROMPT_CONTENT_CHARS = 200000;
let dbInstance = null;

function now() { return Date.now(); }
function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function json(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}
function stringify(value, fallback = '{}') {
  try { return JSON.stringify(value ?? {}); } catch { return fallback; }
}

function db() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(CHAT_DIR, { recursive: true });
  const database = new DatabaseSync(CHAT_DB_PATH);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      status TEXT NOT NULL DEFAULT 'active',
      folder TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      skill_ids_json TEXT NOT NULL DEFAULT '[]',
      pinned INTEGER NOT NULL DEFAULT 0,
      temporary INTEGER NOT NULL DEFAULT 0,
      draft TEXT NOT NULL DEFAULT '',
      prompt_id TEXT NOT NULL DEFAULT '',
      model_profile_id TEXT NOT NULL DEFAULT 'auto',
      compare_model_profile_id TEXT NOT NULL DEFAULT '',
      compare_enabled INTEGER NOT NULL DEFAULT 0,
      temperature REAL NOT NULL DEFAULT 0.65,
      response_style TEXT NOT NULL DEFAULT 'complete',
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      auto_compress INTEGER NOT NULL DEFAULT 1,
      memory_summary TEXT NOT NULL DEFAULT '',
      compressed_count INTEGER NOT NULL DEFAULT 0,
      parent_conversation_id TEXT NOT NULL DEFAULT '',
      branch_from_message_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_chat_conversations_status_updated ON chat_conversations(status, pinned DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'complete',
      error TEXT NOT NULL DEFAULT '',
      parent_message_id TEXT NOT NULL DEFAULT '',
      version_group TEXT NOT NULL DEFAULT '',
      version_index INTEGER NOT NULL DEFAULT 1,
      active_version INTEGER NOT NULL DEFAULT 1,
      starred INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES chat_conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_created ON chat_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_version_group ON chat_messages(version_group, version_index);

    CREATE TABLE IF NOT EXISTS chat_prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
  `);
  const conversationColumns = new Set(database.prepare('PRAGMA table_info(chat_conversations)').all().map((column) => column.name));
  if (!conversationColumns.has('skill_ids_json')) {
    database.exec("ALTER TABLE chat_conversations ADD COLUMN skill_ids_json TEXT NOT NULL DEFAULT '[]'");
  }
  const count = Number(database.prepare('SELECT COUNT(*) AS n FROM chat_prompts').get()?.n || 0);
  if (!count) {
    const insert = database.prepare('INSERT INTO chat_prompts (id,name,content,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?)');
    const t = now();
    insert.run('prompt_default', '默认助手', '你是一个可靠、清晰、有判断力的 AI 助手。完整逐项执行用户要求，不得因内容较多、篇幅、工作量或字数原因擅自精简、摘要或省略；除非用户明确要求简洁，否则应交付完整结果。复杂问题使用清晰结构，必要时给出例子。', 1, t, t);
    insert.run('prompt_concise', '简洁回答', '请用尽可能简洁的方式回答，优先给出结论，再补充必要依据。避免重复和冗长铺垫。', 0, t, t);
    insert.run('prompt_deep', '深度分析', '请进行深入、系统、审慎的分析。明确前提、推理链路、不同观点、风险与结论。', 0, t, t);
    insert.run('prompt_writing', '写作助手', '你是一位优秀的中文写作助手。重视结构、节奏、措辞和可读性，主动指出表达上的改进空间。', 0, t, t);
    insert.run('prompt_code', '编程助手', '你是一位严谨的高级软件工程师。优先给出正确、可运行、易维护的方案，解释关键取舍并提醒边界情况。', 0, t, t);
  }
  const responsePolicyVersion = Number(database.prepare("SELECT value FROM chat_meta WHERE key='response_policy_version'").get()?.value || 0);
  if (responsePolicyVersion < 1) {
    const legacyDefaultPrompt = '你是一个可靠、清晰、有判断力的 AI 助手。直接回答问题，避免空泛复述；复杂问题使用清晰结构，必要时给出例子。';
    const completeDefaultPrompt = '你是一个可靠、清晰、有判断力的 AI 助手。完整逐项执行用户要求，不得因内容较多、篇幅、工作量或字数原因擅自精简、摘要或省略；除非用户明确要求简洁，否则应交付完整结果。复杂问题使用清晰结构，必要时给出例子。';
    database.prepare("UPDATE chat_conversations SET response_style='complete' WHERE response_style='balanced'").run();
    database.prepare("UPDATE chat_prompts SET content=?,updated_at=? WHERE id='prompt_default' AND content=?").run(completeDefaultPrompt, now(), legacyDefaultPrompt);
    database.prepare("INSERT INTO chat_meta (key,value) VALUES ('response_policy_version','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  }
  dbInstance = database;
  return database;
}

function conversationRow(row) {
  if (!row) return null;
  return {
    id: row.id, title: row.title, status: row.status, folder: row.folder,
    tags: json(row.tags_json, []), skillIds: json(row.skill_ids_json, []), pinned: !!row.pinned, temporary: !!row.temporary,
    draft: row.draft, promptId: row.prompt_id, modelProfileId: row.model_profile_id,
    compareModelProfileId: row.compare_model_profile_id, compareEnabled: !!row.compare_enabled,
    temperature: Number(row.temperature), responseStyle: row.response_style,
    memoryEnabled: !!row.memory_enabled, autoCompress: !!row.auto_compress,
    memorySummary: row.memory_summary, compressedCount: Number(row.compressed_count) || 0,
    parentConversationId: row.parent_conversation_id, branchFromMessageId: row.branch_from_message_id,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), deletedAt: Number(row.deleted_at),
  };
}

function messageRow(row) {
  if (!row) return null;
  return {
    id: row.id, conversationId: row.conversation_id, role: row.role, content: row.content,
    model: row.model, status: row.status, error: row.error, parentMessageId: row.parent_message_id,
    versionGroup: row.version_group, versionIndex: Number(row.version_index) || 1,
    activeVersion: !!row.active_version, starred: !!row.starred,
    metadata: json(row.metadata_json, {}), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  };
}

export function listChatConversations({ status = 'active', q = '', folder = '' } = {}) {
  const clauses = ['status = ?'];
  const args = [status];
  if (q) { clauses.push('(title LIKE ? OR id IN (SELECT conversation_id FROM chat_messages WHERE content LIKE ?))'); args.push(`%${q}%`, `%${q}%`); }
  if (folder) { clauses.push('folder = ?'); args.push(folder); }
  return db().prepare(`SELECT * FROM chat_conversations WHERE ${clauses.join(' AND ')} ORDER BY pinned DESC, updated_at DESC`).all(...args).map(conversationRow);
}

export function getChatConversation(conversationId) {
  return conversationRow(db().prepare('SELECT * FROM chat_conversations WHERE id = ?').get(conversationId));
}

export function createChatConversation(input = {}) {
  const conversationId = id('chat');
  const t = now();
  db().prepare(`INSERT INTO chat_conversations (
    id,title,status,folder,tags_json,skill_ids_json,pinned,temporary,draft,prompt_id,model_profile_id,compare_model_profile_id,
    compare_enabled,temperature,response_style,memory_enabled,auto_compress,memory_summary,compressed_count,
    parent_conversation_id,branch_from_message_id,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    conversationId, String(input.title || '新对话').slice(0, 120), 'active', String(input.folder || '').slice(0, 80),
    stringify(Array.isArray(input.tags) ? input.tags.slice(0, 20) : [], '[]'),
    stringify(Array.isArray(input.skillIds) ? [...new Set(input.skillIds.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 50) : [], '[]'),
    input.pinned ? 1 : 0, input.temporary ? 1 : 0,
    String(input.draft || '').slice(0, 200000), String(input.promptId || 'prompt_default'), String(input.modelProfileId || 'auto'),
    String(input.compareModelProfileId || ''), input.compareEnabled ? 1 : 0, Number(input.temperature ?? 0.65),
    String(input.responseStyle || 'complete'), input.memoryEnabled !== false ? 1 : 0, input.autoCompress !== false ? 1 : 0,
    String(input.memorySummary || '').slice(0, 20000), Number(input.compressedCount) || 0,
    String(input.parentConversationId || ''), String(input.branchFromMessageId || ''), t, t,
  );
  return getChatConversation(conversationId);
}

const CONVERSATION_COLUMNS = {
  title: 'title', status: 'status', folder: 'folder', pinned: 'pinned', temporary: 'temporary', draft: 'draft',
  promptId: 'prompt_id', modelProfileId: 'model_profile_id', compareModelProfileId: 'compare_model_profile_id',
  compareEnabled: 'compare_enabled', temperature: 'temperature', responseStyle: 'response_style',
  memoryEnabled: 'memory_enabled', autoCompress: 'auto_compress', memorySummary: 'memory_summary',
  compressedCount: 'compressed_count', deletedAt: 'deleted_at',
};

export function updateChatConversation(conversationId, patch = {}) {
  const sets = [];
  const args = [];
  for (const [key, column] of Object.entries(CONVERSATION_COLUMNS)) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (['pinned','temporary','compareEnabled','memoryEnabled','autoCompress'].includes(key)) value = value ? 1 : 0;
    if (key === 'title') value = String(value || '新对话').slice(0, 120);
    if (key === 'folder') value = String(value || '').slice(0, 80);
    if (key === 'draft') value = String(value || '').slice(0, 200000);
    if (key === 'memorySummary') value = String(value || '').slice(0, 20000);
    sets.push(`${column} = ?`); args.push(value);
  }
  if (patch.tags !== undefined) { sets.push('tags_json = ?'); args.push(stringify(Array.isArray(patch.tags) ? patch.tags.slice(0, 20) : [], '[]')); }
  if (patch.skillIds !== undefined) {
    const skillIds = Array.isArray(patch.skillIds)
      ? [...new Set(patch.skillIds.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, 50)
      : [];
    sets.push('skill_ids_json = ?'); args.push(stringify(skillIds, '[]'));
  }
  if (!sets.length) return getChatConversation(conversationId);
  sets.push('updated_at = ?'); args.push(now(), conversationId);
  db().prepare(`UPDATE chat_conversations SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return getChatConversation(conversationId);
}

export function setChatConversationStatus(conversationId, status) {
  return updateChatConversation(conversationId, { status, deletedAt: status === 'trash' ? now() : 0 });
}

export function purgeChatConversation(conversationId) {
  return db().prepare('DELETE FROM chat_conversations WHERE id = ?').run(conversationId).changes > 0;
}

export function removeChatSkillReferences(skillId) {
  const target = String(skillId || '').trim();
  if (!target) return 0;
  let changed = 0;
  const update = db().prepare('UPDATE chat_conversations SET skill_ids_json = ?, updated_at = ? WHERE id = ?');
  for (const row of db().prepare('SELECT id, skill_ids_json FROM chat_conversations').all()) {
    const skillIds = json(row.skill_ids_json, []);
    if (!Array.isArray(skillIds) || !skillIds.includes(target)) continue;
    update.run(stringify(skillIds.filter((id) => id !== target), '[]'), now(), row.id);
    changed += 1;
  }
  return changed;
}

export function getChatMessages(conversationId, { includeVersions = false } = {}) {
  const versionFilter = includeVersions ? '' : "AND (role != 'assistant' OR active_version = 1)";
  return db().prepare(`SELECT * FROM chat_messages WHERE conversation_id = ? ${versionFilter} ORDER BY created_at, rowid, version_index`).all(conversationId).map(messageRow);
}

export function getChatMessage(messageId) {
  return messageRow(db().prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId));
}

export function createChatMessage(conversationId, input = {}) {
  const messageId = input.id || id('msg');
  const t = Number(input.createdAt) || now();
  const updatedAt = now();
  const group = String(input.versionGroup || (input.role === 'assistant' ? id('ver') : ''));
  const versionIndex = Number(input.versionIndex) || 1;
  if (input.role === 'assistant' && group) db().prepare('UPDATE chat_messages SET active_version = 0 WHERE conversation_id = ? AND version_group = ?').run(conversationId, group);
  db().prepare(`INSERT INTO chat_messages (
    id,conversation_id,role,content,model,status,error,parent_message_id,version_group,version_index,active_version,starred,metadata_json,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    messageId, conversationId, input.role === 'assistant' ? 'assistant' : 'user', String(input.content || '').slice(0, 1000000),
    String(input.model || ''), String(input.status || 'complete'), String(input.error || ''), String(input.parentMessageId || ''), group,
    versionIndex, input.activeVersion === false ? 0 : 1, input.starred ? 1 : 0, stringify(input.metadata || {}), t, updatedAt,
  );
  db().prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(updatedAt, conversationId);
  return getChatMessage(messageId);
}

export function updateChatMessage(messageId, patch = {}) {
  const sets = []; const args = [];
  const columns = { content: 'content', model: 'model', status: 'status', error: 'error', activeVersion: 'active_version', starred: 'starred' };
  for (const [key,column] of Object.entries(columns)) {
    if (patch[key] === undefined) continue;
    let value = patch[key];
    if (key === 'content') value = String(value || '').slice(0, 1000000);
    if (key === 'activeVersion' || key === 'starred') value = value ? 1 : 0;
    sets.push(`${column} = ?`); args.push(value);
  }
  if (patch.metadata !== undefined) { sets.push('metadata_json = ?'); args.push(stringify(patch.metadata)); }
  if (!sets.length) return getChatMessage(messageId);
  sets.push('updated_at = ?'); args.push(now(), messageId);
  db().prepare(`UPDATE chat_messages SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return getChatMessage(messageId);
}

export function deleteChatMessage(messageId, { truncate = false } = {}) {
  const message = getChatMessage(messageId);
  if (!message) return false;
  const database = db();
  database.exec('BEGIN');
  try {
    if (truncate) database.prepare('DELETE FROM chat_messages WHERE conversation_id = ? AND created_at >= ?').run(message.conversationId, message.createdAt);
    else database.prepare('DELETE FROM chat_messages WHERE id = ?').run(messageId);
    database.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(now(), message.conversationId);
    database.exec('COMMIT');
    return true;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function createAssistantVersion(sourceMessageId, input = {}) {
  const source = getChatMessage(sourceMessageId);
  if (!source || source.role !== 'assistant') throw new Error('Assistant message not found');
  const group = source.versionGroup || id('ver');
  if (!source.versionGroup) db().prepare('UPDATE chat_messages SET version_group = ? WHERE id = ?').run(group, source.id);
  const max = Number(db().prepare('SELECT MAX(version_index) AS n FROM chat_messages WHERE version_group = ?').get(group)?.n || 0);
  return createChatMessage(source.conversationId, { ...input, role: 'assistant', parentMessageId: source.parentMessageId, versionGroup: group, versionIndex: max + 1, createdAt: source.createdAt });
}

export function listMessageVersions(messageId) {
  const source = getChatMessage(messageId);
  if (!source?.versionGroup) return source ? [source] : [];
  return db().prepare('SELECT * FROM chat_messages WHERE version_group = ? ORDER BY version_index').all(source.versionGroup).map(messageRow);
}

export function activateMessageVersion(messageId) {
  const source = getChatMessage(messageId);
  if (!source?.versionGroup) return source;
  const database = db();
  database.prepare('UPDATE chat_messages SET active_version = 0 WHERE version_group = ?').run(source.versionGroup);
  database.prepare('UPDATE chat_messages SET active_version = 1 WHERE id = ?').run(messageId);
  return getChatMessage(messageId);
}

export function branchChatConversation(conversationId, fromMessageId, title = '') {
  const source = getChatConversation(conversationId);
  const from = getChatMessage(fromMessageId);
  if (!source || !from || from.conversationId !== conversationId) throw new Error('Branch source not found');
  const branch = createChatConversation({
    ...source, title: title || `${source.title} · 分支`, parentConversationId: conversationId, branchFromMessageId: fromMessageId,
    status: 'active', pinned: false, temporary: false,
  });
  const messages = getChatMessages(conversationId).filter((item) => item.createdAt <= from.createdAt);
  for (const item of messages) createChatMessage(branch.id, { ...item, id: undefined, versionGroup: '', versionIndex: 1 });
  return branch;
}

export function searchChatContent(q, { limit = 100 } = {}) {
  const query = String(q || '').trim();
  if (!query) return [];
  return db().prepare(`SELECT m.id AS message_id,m.conversation_id,m.role,m.content,m.created_at,c.title
    FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id
    WHERE c.status != 'trash' AND (m.content LIKE ? OR c.title LIKE ?)
    ORDER BY m.created_at DESC LIMIT ?`).all(`%${query}%`, `%${query}%`, Math.min(Number(limit) || 100, 500)).map((row) => ({
      messageId: row.message_id, conversationId: row.conversation_id, role: row.role,
      content: row.content, title: row.title, createdAt: Number(row.created_at),
    }));
}

export function listChatPrompts() {
  return db().prepare('SELECT * FROM chat_prompts ORDER BY is_default DESC, updated_at DESC').all().map((row) => ({
    id: row.id, name: row.name, content: row.content, isDefault: !!row.is_default, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }));
}
export function createChatPrompt(input = {}) {
  const promptId = id('prompt'); const t = now();
  db().prepare('INSERT INTO chat_prompts (id,name,content,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(promptId, String(input.name || '新提示词').slice(0,80), String(input.content || '').slice(0, MAX_CHAT_PROMPT_CONTENT_CHARS), 0, t, t);
  return listChatPrompts().find((item) => item.id === promptId);
}
export function updateChatPrompt(promptId, patch = {}) {
  const current = listChatPrompts().find((item) => item.id === promptId); if (!current) return null;
  if (patch.isDefault) { db().prepare('UPDATE chat_prompts SET is_default = 0').run(); }
  db().prepare('UPDATE chat_prompts SET name=?,content=?,is_default=?,updated_at=? WHERE id=?').run(
    String(patch.name ?? current.name).slice(0,80), String(patch.content ?? current.content).slice(0, MAX_CHAT_PROMPT_CONTENT_CHARS), patch.isDefault ?? current.isDefault ? 1 : 0, now(), promptId,
  );
  return listChatPrompts().find((item) => item.id === promptId);
}
export function deleteChatPrompt(promptId) {
  if (promptId === 'prompt_default') return false;
  db().prepare("UPDATE chat_conversations SET prompt_id='prompt_default' WHERE prompt_id=?").run(promptId);
  return db().prepare('DELETE FROM chat_prompts WHERE id=?').run(promptId).changes > 0;
}

export function exportChatConversation(conversationId) {
  const conversation = getChatConversation(conversationId);
  if (!conversation) return null;
  return { version: 1, exportedAt: now(), conversation, messages: getChatMessages(conversationId, { includeVersions: true }) };
}

export function importChatConversation(payload = {}) {
  const source = payload.conversation || payload;
  const conversation = createChatConversation({ ...source, title: source.title || '导入的对话', status: 'active', temporary: false });
  for (const item of Array.isArray(payload.messages) ? payload.messages : []) {
    createChatMessage(conversation.id, { ...item, id: undefined, versionGroup: '', versionIndex: 1 });
  }
  return conversation;
}

export function closeChatStore() {
  if (!dbInstance) return;
  dbInstance.close();
  dbInstance = null;
}

export { CHAT_DB_PATH };
