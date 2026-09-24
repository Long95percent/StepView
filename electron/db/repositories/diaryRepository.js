import { randomUUID } from "node:crypto";
import { planDiarySearch, summarizeDiaryEntry } from "../../../src/diaryCore.js";

export class DiaryRevisionConflictError extends Error {
  constructor(message, { diaryId = null, expectedRev = null, actualRev = null } = {}) {
    super(message);
    this.name = "DiaryRevisionConflictError";
    this.code = "DIARY_REVISION_CONFLICT";
    this.diaryId = diaryId;
    this.expectedRev = expectedRev;
    this.actualRev = actualRev;
  }
}

function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

function entryFromRow(row, tags = []) {
  if (!row) return null;
  return {
    diaryId: row.id,
    accountId: row.account_id,
    rev: Number(row.rev),
    occurredAt: row.occurred_at,
    occurredDay: row.occurred_day,
    timezone: row.timezone,
    title: row.title,
    content: row.content,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    tags,
  };
}

function linkFromRow(row) {
  return {
    linkId: row.id,
    diaryId: row.diary_id,
    targetType: row.target_type,
    targetId: row.target_id,
    taskId: row.task_id,
    role: row.role,
    createdBy: row.created_by,
    orphanedAt: row.orphaned_at,
    createdAt: row.created_at,
  };
}

/**
 * 日记仓储。
 *
 * 一条日记的写入会同时落在四个地方：条目本身、标签、画布关联、全文索引，外加一条变更日志。
 * 这些必须在同一个事务里完成，否则会出现"搜得到但打不开"或者"标签对不上"的脏数据。
 * 每次内容变化都会 rev + 1 并追加一条 diary_revisions，方便回答"这条日记什么时候被谁改过"。
 */
export function createDiaryRepository({ connection, accountId } = {}) {
  if (!connection?.db) throw new Error("Diary repository requires a database connection.");
  if (!accountId) throw new Error("Diary repository requires an accountId.");
  const { db } = connection;

  const insertEntryStatement = db.prepare(`
    INSERT INTO diary_entries (id, account_id, rev, occurred_at, occurred_day, timezone, title, content, status, source, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectEntryStatement = db.prepare("SELECT * FROM diary_entries WHERE id = ? AND account_id = ?");
  const updateEntryStatement = db.prepare(`
    UPDATE diary_entries
    SET rev = ?, occurred_at = ?, occurred_day = ?, timezone = ?, title = ?, content = ?, status = ?, source = ?, updated_at = ?, deleted_at = ?
    WHERE id = ? AND account_id = ? AND rev = ?
  `);
  const deleteEntryStatement = db.prepare("DELETE FROM diary_entries WHERE id = ? AND account_id = ?");

  const insertLinkStatement = db.prepare(`
    INSERT INTO diary_links (id, account_id, diary_id, target_type, target_id, task_id, role, created_by, orphaned_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectLinksStatement = db.prepare("SELECT * FROM diary_links WHERE diary_id = ? AND account_id = ? ORDER BY created_at ASC");
  const deleteLinksStatement = db.prepare("DELETE FROM diary_links WHERE diary_id = ? AND account_id = ?");
  const selectLinksForTargetStatement = db.prepare(
    "SELECT * FROM diary_links WHERE account_id = ? AND target_type = ? AND target_id = ? ORDER BY created_at ASC",
  );
  const orphanLinksStatement = db.prepare(
    "UPDATE diary_links SET orphaned_at = ? WHERE account_id = ? AND target_type = ? AND target_id = ? AND orphaned_at IS NULL",
  );

  const selectTagsStatement = db.prepare(
    "SELECT t.name FROM diary_entry_tags et JOIN diary_tags t ON t.id = et.tag_id WHERE et.diary_id = ? ORDER BY t.name ASC",
  );
  const selectTagsForEntriesStatement = db.prepare(
    "SELECT et.diary_id, t.name FROM diary_entry_tags et JOIN diary_tags t ON t.id = et.tag_id WHERE et.diary_id IN (SELECT value FROM json_each(?)) ORDER BY t.name ASC",
  );
  const selectTagByNameStatement = db.prepare("SELECT id FROM diary_tags WHERE account_id = ? AND name = ?");
  const insertTagStatement = db.prepare("INSERT INTO diary_tags (id, account_id, name, created_at) VALUES (?, ?, ?, ?)");
  const deleteEntryTagsStatement = db.prepare("DELETE FROM diary_entry_tags WHERE diary_id = ?");
  const insertEntryTagStatement = db.prepare("INSERT OR IGNORE INTO diary_entry_tags (diary_id, tag_id) VALUES (?, ?)");
  const listTagsStatement = db.prepare(`
    SELECT t.name AS name, COUNT(et.diary_id) AS count
    FROM diary_tags t
    LEFT JOIN diary_entry_tags et ON et.tag_id = t.id
    LEFT JOIN diary_entries e ON e.id = et.diary_id AND e.status != 'trashed'
    GROUP BY t.id, t.name
    ORDER BY t.name ASC
  `);

  const insertRevisionStatement = db.prepare(
    "INSERT INTO diary_revisions (id, account_id, diary_id, rev, reason, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const selectRevisionsStatement = db.prepare(
    "SELECT * FROM diary_revisions WHERE diary_id = ? AND account_id = ? ORDER BY rev DESC LIMIT ?",
  );

  const selectImportMarkerStatement = db.prepare("SELECT value_json FROM kv WHERE key = ?");
  const upsertImportMarkerStatement = db.prepare(`
    INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `);

  const listImportedNodeIdsStatement = db.prepare(`
    SELECT DISTINCT l.target_id AS target_id
    FROM diary_links l JOIN diary_entries e ON e.id = l.diary_id
    WHERE l.account_id = ? AND l.target_type = 'node' AND e.source = 'node-note-import'
  `);

  const insertFtsStatement = db.prepare("INSERT INTO diary_fts (diary_id, account_id, title, content) VALUES (?, ?, ?, ?)");
  const updateFtsStatement = db.prepare("UPDATE diary_fts SET title = ?, content = ? WHERE diary_id = ?");
  const deleteFtsStatement = db.prepare("DELETE FROM diary_fts WHERE diary_id = ?");

  function readEntry(id) {
    const row = selectEntryStatement.get(String(id), accountId);
    if (!row) return null;
    return entryFromRow(row, selectTagsStatement.all(row.id).map((tag) => tag.name));
  }

  function tagsForEntries(diaryIds) {
    if (diaryIds.length === 0) return new Map();
    const map = new Map();
    for (const row of selectTagsForEntriesStatement.all(JSON.stringify(diaryIds))) {
      if (!map.has(row.diary_id)) map.set(row.diary_id, []);
      map.get(row.diary_id).push(row.name);
    }
    return map;
  }

  function syncTags(diaryId, tags, nowIso) {
    deleteEntryTagsStatement.run(diaryId);
    for (const name of tags) {
      let tagId = selectTagByNameStatement.get(accountId, name)?.id;
      if (!tagId) {
        tagId = makeId("diary-tag");
        try {
          insertTagStatement.run(tagId, accountId, name, nowIso);
        } catch (error) {
          if (!String(error.message).includes("UNIQUE")) throw error;
          tagId = selectTagByNameStatement.get(accountId, name)?.id;
        }
      }
      if (tagId) insertEntryTagStatement.run(diaryId, tagId);
    }
  }

  function syncLinks(diaryId, links, nowIso) {
    deleteLinksStatement.run(diaryId, accountId);
    for (const link of links) {
      insertLinkStatement.run(
        makeId("diary-link"),
        accountId,
        diaryId,
        link.targetType,
        link.targetId,
        link.taskId ?? null,
        link.role || "context",
        link.createdBy || "user",
        null,
        nowIso,
      );
    }
  }

  function appendRevision(diaryId, rev, payload, { reason = "", now = new Date() } = {}) {
    insertRevisionStatement.run(makeId("diary-rev"), accountId, diaryId, rev, String(reason || ""), JSON.stringify(payload), now.toISOString());
  }

  /**
   * 新建一条日记。`normalized` 必须已经过 src/diaryCore.js 的 normalizeDiaryInput。
   */
  function create(normalized, { reason = "create", now = new Date() } = {}) {
    const nowIso = now.toISOString();
    const diaryId = makeId("diary");
    const record = {
      diaryId,
      accountId,
      rev: 1,
      occurredAt: normalized.occurredAt,
      occurredDay: normalized.occurredDay,
      timezone: normalized.timezone,
      title: normalized.title,
      content: normalized.content,
      status: normalized.status,
      source: normalized.source,
      createdAt: nowIso,
      updatedAt: nowIso,
      deletedAt: normalized.status === "trashed" ? nowIso : null,
      tags: normalized.tags,
    };

    connection.withTransaction(() => {
      insertEntryStatement.run(
        diaryId,
        accountId,
        record.rev,
        record.occurredAt,
        record.occurredDay,
        record.timezone,
        record.title,
        record.content,
        record.status,
        record.source,
        record.createdAt,
        record.updatedAt,
        record.deletedAt,
      );
      syncTags(diaryId, normalized.tags, nowIso);
      syncLinks(diaryId, normalized.links, nowIso);
      insertFtsStatement.run(diaryId, accountId, record.title, record.content);
      appendRevision(diaryId, record.rev, { ...record, links: normalized.links }, { reason, now });
    });

    return readEntry(diaryId);
  }

  /**
   * 更新一条日记。
   *
   * expectedRev 是乐观锁：调用方必须交回自己读到的版本号，版本对不上就直接报冲突，
   * 而不是默默把别人的修改盖掉。
   */
  function update(id, normalized, { expectedRev, reason = "update", now = new Date() } = {}) {
    const current = selectEntryStatement.get(String(id), accountId);
    if (!current) return null;
    if (expectedRev !== undefined && Number(expectedRev) !== Number(current.rev)) {
      throw new DiaryRevisionConflictError("这条日记已经被改过了，请刷新后再编辑。", {
        diaryId: id,
        expectedRev: Number(expectedRev),
        actualRev: Number(current.rev),
      });
    }

    const nowIso = now.toISOString();
    const nextRev = Number(current.rev) + 1;
    const status = normalized.status ?? current.status;
    const deletedAt = status === "trashed" ? current.deleted_at || nowIso : null;
    const record = {
      diaryId: String(id),
      accountId,
      rev: nextRev,
      occurredAt: normalized.occurredAt ?? current.occurred_at,
      occurredDay: normalized.occurredDay ?? current.occurred_day,
      timezone: normalized.timezone ?? current.timezone,
      title: normalized.title ?? current.title,
      content: normalized.content ?? current.content,
      status,
      source: normalized.source ?? current.source,
      createdAt: current.created_at,
      updatedAt: nowIso,
      deletedAt,
      tags: normalized.tags ?? selectTagsStatement.all(String(id)).map((tag) => tag.name),
    };

    connection.withTransaction(() => {
      const info = updateEntryStatement.run(
        record.rev,
        record.occurredAt,
        record.occurredDay,
        record.timezone,
        record.title,
        record.content,
        record.status,
        record.source,
        record.updatedAt,
        record.deletedAt,
        record.diaryId,
        accountId,
        Number(current.rev),
      );
      if (Number(info.changes || 0) !== 1) {
        throw new DiaryRevisionConflictError("这条日记已经被改过了，请刷新后再编辑。", {
          diaryId: id,
          expectedRev: Number(expectedRev ?? current.rev),
          actualRev: Number(current.rev),
        });
      }
      if (normalized.tags) syncTags(record.diaryId, normalized.tags, nowIso);
      if (normalized.links) syncLinks(record.diaryId, normalized.links, nowIso);
      updateFtsStatement.run(record.title, record.content, record.diaryId);
      appendRevision(record.diaryId, record.rev, record, { reason, now });
    });

    return readEntry(record.diaryId);
  }

  /** 改状态：归档、丢进回收站、从回收站恢复。 */
  function setStatus(id, status, { now = new Date(), reason = "status" } = {}) {
    const current = selectEntryStatement.get(String(id), accountId);
    if (!current) return null;
    return update(id, { status }, { expectedRev: Number(current.rev), reason, now });
  }

  function remove(id) {
    const info = deleteEntryStatement.run(String(id), accountId);
    if (Number(info.changes || 0) === 0) return false;
    deleteFtsStatement.run(String(id));
    return true;
  }

  const LIST_COLUMNS = "SELECT * FROM diary_entries WHERE account_id = ?";

  function buildListQuery(filter = {}) {
    const clauses = [LIST_COLUMNS];
    const params = [accountId];
    const status = filter.status === undefined ? "active" : filter.status;
    if (status && status !== "all") {
      clauses.push("AND status = ?");
      params.push(status);
    }
    if (filter.from) {
      clauses.push("AND occurred_day >= ?");
      params.push(String(filter.from));
    }
    if (filter.to) {
      clauses.push("AND occurred_day <= ?");
      params.push(String(filter.to));
    }
    if (filter.tag) {
      clauses.push(
        "AND id IN (SELECT et.diary_id FROM diary_entry_tags et JOIN diary_tags t ON t.id = et.tag_id WHERE t.name = ?)",
      );
      params.push(String(filter.tag));
    }
    if (filter.targetType && filter.targetId) {
      clauses.push(
        "AND id IN (SELECT diary_id FROM diary_links WHERE account_id = ? AND target_type = ? AND target_id = ?)",
      );
      params.push(accountId, String(filter.targetType), String(filter.targetId));
    }
    clauses.push("ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?");
    params.push(Math.max(1, Math.min(Number(filter.limit) || 50, 200)), Math.max(0, Number(filter.offset) || 0));
    return { sql: clauses.join(" "), params };
  }

  function list(filter = {}) {
    const { sql, params } = buildListQuery(filter);
    const rows = db.prepare(sql).all(...params);
    const tags = tagsForEntries(rows.map((row) => row.id));
    return rows.map((row) => entryFromRow(row, tags.get(row.id) || []));
  }

  /** 把所有日记的正文拼成一份"哪一天写了什么"的时间线，供 Agent 读。 */
  function timeline({ limit = 50, from = null, to = null } = {}) {
    return list({ limit, from, to }).map((entry) => ({
      diaryId: entry.diaryId,
      occurredDay: entry.occurredDay,
      title: entry.title,
      summary: summarizeDiaryEntry(entry),
      tags: entry.tags,
    }));
  }

  /**
   * 检索。
   *
   * 三个字以上走 FTS5（trigram 分词器），少于三个字回退 LIKE —— 中文两字查询在 trigram 下
   * 是搜不到的，只能靠模糊匹配兜底。
   */
  function search({ query, ...filter } = {}) {
    const plan = planDiarySearch(query);
    if (plan.mode === "empty") return list(filter);

    const status = filter.status === undefined ? "active" : filter.status;
    const limit = Math.max(1, Math.min(Number(filter.limit) || 50, 200));
    const offset = Math.max(0, Number(filter.offset) || 0);

    const clauses = [];
    const params = [];
    if (plan.mode === "match") {
      // FTS5 的 MATCH 左侧必须写表名，表被取别名后会报 "no such column"。
      clauses.push(
        "SELECT e.* FROM diary_fts JOIN diary_entries e ON e.id = diary_fts.diary_id WHERE diary_fts MATCH ? AND diary_fts.account_id = ?",
      );
      params.push(plan.expression, accountId);
    } else {
      clauses.push("SELECT e.* FROM diary_entries e WHERE e.account_id = ?");
      params.push(accountId);
      for (const pattern of plan.patterns) {
        clauses.push("AND (e.title LIKE ? ESCAPE '\\' OR e.content LIKE ? ESCAPE '\\')");
        params.push(pattern, pattern);
      }
    }
    if (status && status !== "all") {
      clauses.push("AND e.status = ?");
      params.push(status);
    }
    if (filter.tag) {
      clauses.push("AND e.id IN (SELECT et.diary_id FROM diary_entry_tags et JOIN diary_tags t ON t.id = et.tag_id WHERE t.name = ?)");
      params.push(String(filter.tag));
    }
    clauses.push("ORDER BY e.occurred_at DESC, e.id DESC LIMIT ? OFFSET ?");
    params.push(limit, offset);

    const rows = db.prepare(clauses.join(" ")).all(...params);
    const tags = tagsForEntries(rows.map((row) => row.id));
    return rows.map((row) => entryFromRow(row, tags.get(row.id) || []));
  }

  function listLinks(diaryId) {
    return selectLinksStatement.all(String(diaryId), accountId).map(linkFromRow);
  }

  function listLinksForTarget({ targetType, targetId }) {
    return selectLinksForTargetStatement.all(accountId, String(targetType), String(targetId)).map(linkFromRow);
  }

  /**
   * 画布上的节点/支线/任务被删掉时，关联不删，只打上 orphaned_at：
   * 日记本身是用户写的内容，不该因为画布结构变化而少半句话。
   */
  function markLinksOrphaned({ targetType, targetId, now = new Date() }) {
    return Number(orphanLinksStatement.run(now.toISOString(), accountId, String(targetType), String(targetId)).changes || 0);
  }

  function listTags() {
    return listTagsStatement.all().map((row) => ({ name: row.name, count: Number(row.count || 0) }));
  }

  function listRevisions(diaryId, { limit = 20 } = {}) {
    return selectRevisionsStatement.all(String(diaryId), accountId, Math.max(1, Math.min(Number(limit) || 20, 200))).map((row) => ({
      revisionId: row.id,
      diaryId: row.diary_id,
      rev: Number(row.rev),
      reason: row.reason,
      payload: JSON.parse(row.payload_json || "{}"),
      createdAt: row.created_at,
    }));
  }

  /**
   * 已经由"节点备注导入"生成过日记的节点 id。
   *
   * 覆盖所有状态：条目后来被归档、丢进回收站甚至删掉，都算"这个节点已经导过了"，
   * 免得用户删掉一条导入的日记之后，下次导入又把它变回来。
   */
  function importMarkerKey() {
    return `diary-import:node-notes:${accountId}`;
  }

  function readImportMarker() {
    const row = selectImportMarkerStatement.get(importMarkerKey());
    if (!row) return [];
    try {
      const parsed = JSON.parse(row.value_json);
      return Array.isArray(parsed?.nodeIds) ? parsed.nodeIds.map(String) : [];
    } catch {
      return [];
    }
  }

  function listImportedNodeIds() {
    const fromLinks = listImportedNodeIdsStatement.all(accountId).map((row) => row.target_id);
    return [...new Set([...readImportMarker(), ...fromLinks])];
  }

  /**
   * 记下"这些节点的备注已经导过了"。
   *
   * 光靠 diary_links 判断不够：用户把导入出来的日记删掉时，关联会跟着级联消失，
   * 下次导入又会把这条日记变回来。标记独立存在 kv 里，删除日记不会抹掉它。
   */
  function markNodeNotesImported(nodeIds, { now = new Date() } = {}) {
    const merged = [...new Set([...readImportMarker(), ...nodeIds.map(String)])];
    upsertImportMarkerStatement.run(importMarkerKey(), JSON.stringify({ nodeIds: merged }), now.toISOString());
    return merged.length;
  }

  function count({ status = "active" } = {}) {
    const row =
      status === "all"
        ? db.prepare("SELECT COUNT(*) AS count FROM diary_entries WHERE account_id = ?").get(accountId)
        : db.prepare("SELECT COUNT(*) AS count FROM diary_entries WHERE account_id = ? AND status = ?").get(accountId, status);
    return Number(row.count || 0);
  }

  return {
    create,
    get: readEntry,
    update,
    setStatus,
    remove,
    list,
    timeline,
    search,
    listLinks,
    listLinksForTarget,
    markLinksOrphaned,
    listTags,
    listRevisions,
    listImportedNodeIds,
    markNodeNotesImported,
    count,
  };
}
