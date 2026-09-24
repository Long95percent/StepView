/**
 * 日记的共用纯函数。
 *
 * 这一层不碰数据库、不碰 localStorage：前端与 Electron 主进程都要用它来规范化输入、
 * 计算"哪一天"、以及决定检索走全文索引还是回退模糊匹配，保证两边行为一致。
 */

export const DIARY_STATUSES = Object.freeze(["active", "archived", "trashed"]);
export const DIARY_TARGET_TYPES = Object.freeze(["node", "branch", "task"]);
export const DIARY_LINK_ROLES = Object.freeze(["primary", "context", "evidence"]);
export const DIARY_SOURCES = Object.freeze(["manual", "node-note-import", "agent"]);

/** FTS5 的 trigram 分词器至少要 3 个字符才能命中。 */
export const DIARY_MATCH_MIN_LENGTH = 3;
export const DIARY_TITLE_MAX_LENGTH = 120;
export const DIARY_CONTENT_MAX_LENGTH = 20000;
export const DIARY_TAG_MAX_LENGTH = 32;
export const DIARY_TAG_LIMIT = 24;

export class DiaryInputError extends Error {
  constructor(message, { field = null } = {}) {
    super(message);
    this.name = "DiaryInputError";
    this.code = "DIARY_INPUT_INVALID";
    this.field = field;
  }
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) throw new DiaryInputError(`${field} 只能是 ${allowed.join(" / ")}。`, { field });
  return value;
}

/**
 * 某个瞬间在指定时区里属于哪一天（YYYY-MM-DD）。
 *
 * 日记的"哪一天"必须按用户自己的时区算：晚上 11 点写的日记不该因为 UTC 而算到第二天。
 */
export function dayKeyFromInstant(instant, timezone = "UTC") {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new DiaryInputError(`时间格式不正确：${instant}`, { field: "occurredAt" });

  const zone = String(timezone || "UTC").trim() || "UTC";
  try {
    // en-CA 的短日期格式正好是 YYYY-MM-DD。
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    if (/^\d{4}-\d{2}-\d{2}$/.test(parts)) return parts;
  } catch {
    throw new DiaryInputError(`时区不正确：${timezone}`, { field: "timezone" });
  }
  throw new DiaryInputError(`时区不正确：${timezone}`, { field: "timezone" });
}

/** 标签规范化：去空白、去重（忽略大小写）、限长限量。 */
export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const seen = new Set();
  const normalized = [];
  for (const raw of list) {
    const name = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(name.slice(0, DIARY_TAG_MAX_LENGTH));
    if (normalized.length >= DIARY_TAG_LIMIT) break;
  }
  return normalized;
}

/** 关联规范化：同一条日记对同一个目标只保留一条关联。 */
export function normalizeLinks(links) {
  const list = Array.isArray(links) ? links : [];
  const seen = new Set();
  const normalized = [];
  for (const link of list) {
    const targetType = String(link?.targetType || "").trim();
    const targetId = String(link?.targetId || "").trim();
    if (!targetType || !targetId) continue;
    if (!DIARY_TARGET_TYPES.includes(targetType)) throw new DiaryInputError(`关联目标类型不支持：${targetType}`, { field: "links" });
    const role = DIARY_LINK_ROLES.includes(link?.role) ? link.role : "context";
    const key = `${targetType}:${targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      targetType,
      targetId,
      role,
      taskId: link?.taskId ? String(link.taskId) : null,
      createdBy: link?.createdBy === "agent" ? "agent" : "user",
    });
  }
  return normalized;
}

/**
 * 校验并规范化一条日记输入。
 *
 * 标题和正文至少要有一样：允许"只写一句话"的日记，但不允许存一条空白记录。
 */
export function normalizeDiaryInput(input = {}, { now = new Date() } = {}) {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();
  if (!title && !content) throw new DiaryInputError("日记至少要写点东西：标题或正文不能都是空的。", { field: "content" });
  if (title.length > DIARY_TITLE_MAX_LENGTH) throw new DiaryInputError(`标题最多 ${DIARY_TITLE_MAX_LENGTH} 个字。`, { field: "title" });
  if (content.length > DIARY_CONTENT_MAX_LENGTH) throw new DiaryInputError(`正文最多 ${DIARY_CONTENT_MAX_LENGTH} 个字。`, { field: "content" });

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  if (Number.isNaN(occurredAt.getTime())) throw new DiaryInputError(`时间格式不正确：${input.occurredAt}`, { field: "occurredAt" });
  const timezone = String(input.timezone || "UTC").trim() || "UTC";

  return {
    occurredAt: occurredAt.toISOString(),
    occurredDay: dayKeyFromInstant(occurredAt, timezone),
    timezone,
    title,
    content,
    status: input.status === undefined ? "active" : requireOneOf(input.status, DIARY_STATUSES, "status"),
    source: input.source === undefined ? "manual" : requireOneOf(input.source, DIARY_SOURCES, "source"),
    tags: normalizeTags(input.tags),
    links: normalizeLinks(input.links),
  };
}

/**
 * 规划一次检索。
 *
 * 三个字以上且每个词都够长才走全文索引；否则回退 LIKE。
 * 混合的原因是 trigram 分词器对两字查询无解，而中文里两字查询非常常见（"焦虑"、"考研"）。
 */
export function planDiarySearch(query) {
  const value = String(query ?? "").trim();
  if (!value) return { mode: "empty", terms: [] };
  const terms = value.split(/\s+/).filter(Boolean);
  if (terms.every((term) => [...term].length >= DIARY_MATCH_MIN_LENGTH)) {
    // 全文索引：每个词都要出现，词内部按字面匹配（引号翻倍做转义）。
    return { mode: "match", terms, expression: terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" AND ") };
  }
  // 回退 LIKE：词与词之间是"都要出现"，而不是要求整串原样相邻——否则"数据库 重构"会一个字都搜不到。
  const escaped = terms.map((term) => term.replace(/[\\%_]/g, (match) => `\\${match}`));
  return { mode: "like", terms: escaped, patterns: escaped.map((term) => `%${term}%`) };
}

/** 列表和 Agent 上下文里用的短摘要。 */
export function summarizeDiaryEntry(entry, { length = 120 } = {}) {
  const text = String(entry?.content || entry?.title || "").replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  return `${text.slice(0, length)}…`;
}
