import { randomUUID } from "node:crypto";

/**
 * 全局保留策略。
 *
 * 这是整个项目里唯一允许定义“数据留多久、留多少”的地方。
 * 业务模块不得自己写 DELETE 或 TTL，只能在下面这张表里加规则。
 *
 * 规则字段：
 *   id          规则标识，必须唯一，会写进执行记录
 *   table       目标表
 *   key         主键列，使用 keep 时必填
 *   where       过期条件，可用 :now（当前时间）和 :ttl（now - ttlDays）
 *   ttlDays     配合 :ttl 使用；不写 where 时默认按 created_at < :ttl 删除
 *   keep        限额规则 { limit, orderBy, filter, partitionBy }
 *   description 给人看的说明
 */
export const DEFAULT_APPROVAL_TTL_DAYS = 7;
export const DEFAULT_MAX_PENDING_APPROVALS = 20;
export const DEFAULT_MAX_SNAPSHOTS = 20;

/**
 * 审批记录的保留规则。
 *
 * 规则形状放在这里，调用方只提供数量和时间参数（比如某个 store 自己的上限）。
 * 语义与重构前一致：已决策的记录、以及超过 TTL 的记录都会被删；待确认的只按数量保留最新的若干条。
 */
export function buildApprovalRetentionRules({ kind = "board_change", maxPending = DEFAULT_MAX_PENDING_APPROVALS, ttlDays = DEFAULT_APPROVAL_TTL_DAYS } = {}) {
  const safeKind = String(kind);
  if (!/^[a-z_]+$/.test(safeKind)) throw new RetentionError(`非法的审批类型：${kind}`, { code: "RETENTION_INVALID_KIND" });
  return [
    {
      id: `approvals-expired:${safeKind}`,
      table: "approvals",
      where: `kind = '${safeKind}' AND (status != 'pending' OR created_at < :ttl)`,
      ttlDays,
    },
    {
      id: `approvals-overflow:${safeKind}`,
      table: "approvals",
      key: "id",
      keep: { limit: maxPending, orderBy: "created_at DESC, id DESC", filter: `kind = '${safeKind}' AND status = 'pending'` },
    },
  ];
}

export function buildSnapshotRetentionRules({ kind = "board", maxSnapshots = DEFAULT_MAX_SNAPSHOTS } = {}) {
  const safeKind = String(kind);
  if (!/^[a-z_]+$/.test(safeKind)) throw new RetentionError(`非法的快照类型：${kind}`, { code: "RETENTION_INVALID_KIND" });
  return [
    {
      id: `snapshots-overflow:${safeKind}`,
      table: "snapshots",
      key: "id",
      keep: { limit: maxSnapshots, orderBy: "created_at DESC, id DESC", filter: `kind = '${safeKind}'` },
    },
  ];
}

/** 全局清理时使用的默认规则。Phase 4 接入定时执行后生效。 */
export const RETENTION_RULES = Object.freeze([
  ...buildApprovalRetentionRules(),
  ...buildSnapshotRetentionRules(),
]);

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class RetentionError extends Error {
  constructor(message, { code = "RETENTION_INVALID", ruleId = null } = {}) {
    super(message);
    this.name = "RetentionError";
    this.code = code;
    this.ruleId = ruleId;
  }
}

function requireIdentifier(value, field, ruleId) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new RetentionError(`保留策略的 ${field} 不是合法标识符：${value}`, { code: "RETENTION_INVALID_IDENTIFIER", ruleId });
  }
  return value;
}

function requirePositiveInteger(value, field, ruleId) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RetentionError(`保留策略的 ${field} 必须是正整数：${value}`, { code: "RETENTION_INVALID_LIMIT", ruleId });
  }
  return value;
}

export function validateRetentionRules(rules = RETENTION_RULES) {
  const seen = new Set();
  for (const rule of rules) {
    const id = rule?.id;
    if (typeof id !== "string" || !id.trim()) throw new RetentionError("每条保留策略都需要 id。", { code: "RETENTION_MISSING_ID" });
    if (seen.has(id)) throw new RetentionError(`保留策略 id 重复：${id}`, { code: "RETENTION_DUPLICATE_ID", ruleId: id });
    seen.add(id);

    requireIdentifier(rule.table, "table", id);
    if (rule.key !== undefined) requireIdentifier(rule.key, "key", id);
    if (rule.where !== undefined && typeof rule.where !== "string") throw new RetentionError("where 必须是字符串。", { ruleId: id });
    if (rule.ttlDays !== undefined) requirePositiveInteger(rule.ttlDays, "ttlDays", id);

    if (rule.keep) {
      if (!rule.key) throw new RetentionError(`使用 keep 的规则必须声明 key：${id}`, { code: "RETENTION_MISSING_KEY", ruleId: id });
      requirePositiveInteger(rule.keep.limit, "keep.limit", id);
      if (typeof rule.keep.orderBy !== "string" || !rule.keep.orderBy.trim()) {
        throw new RetentionError(`keep.orderBy 不能为空：${id}`, { ruleId: id });
      }
      if (rule.keep.partitionBy !== undefined) requireIdentifier(rule.keep.partitionBy, "keep.partitionBy", id);
      if (rule.keep.filter !== undefined && typeof rule.keep.filter !== "string") {
        throw new RetentionError("keep.filter 必须是字符串。", { ruleId: id });
      }
    }

    if (!rule.where && !rule.ttlDays && !rule.keep) {
      throw new RetentionError(`保留策略什么都不做：${id}`, { code: "RETENTION_EMPTY_RULE", ruleId: id });
    }
  }
  return rules;
}

function buildExpiryPlan(rule, { now }) {
  if (!rule.where && rule.ttlDays === undefined) return null;
  const condition = rule.where || "created_at < :ttl";
  const named = {};
  if (condition.includes(":now")) named[":now"] = now.toISOString();
  if (condition.includes(":ttl")) {
    if (rule.ttlDays === undefined) {
      throw new RetentionError(`规则 ${rule.id} 的 where 用到了 :ttl，但没有声明 ttlDays。`, { code: "RETENTION_MISSING_TTL", ruleId: rule.id });
    }
    named[":ttl"] = new Date(now.getTime() - rule.ttlDays * 24 * 60 * 60 * 1000).toISOString();
  }
  return {
    label: "expired",
    sql: `DELETE FROM ${rule.table} WHERE ${condition}`,
    named,
  };
}

function buildKeepPlan(rule) {
  if (!rule.keep) return null;
  const { limit, orderBy, filter, partitionBy } = rule.keep;
  requirePositiveInteger(limit, "keep.limit", rule.id);
  const filterSql = filter ? ` AND (${filter})` : "";

  if (partitionBy) {
    return {
      label: "overflow",
      sql: `DELETE FROM ${rule.table} WHERE ${rule.key} IN (
        SELECT ${rule.key} FROM (
          SELECT ${rule.key}, ROW_NUMBER() OVER (PARTITION BY ${partitionBy} ORDER BY ${orderBy}) AS retention_rank
          FROM ${rule.table}
          WHERE 1 = 1${filterSql}
        ) WHERE retention_rank > ?
      )`,
      positional: [limit],
    };
  }

  return {
    label: "overflow",
    sql: `DELETE FROM ${rule.table} WHERE ${rule.key} IN (
      SELECT ${rule.key} FROM ${rule.table}
      WHERE 1 = 1${filterSql}
      ORDER BY ${orderBy}
      LIMIT -1 OFFSET ?
    )`,
    positional: [limit],
  };
}

function ensureRetentionRunsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS retention_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      removed_json TEXT
    );
  `);
}

export function runRetention({ connection, rules = RETENTION_RULES, now = new Date(), logger = console } = {}) {
  if (!connection?.db) throw new RetentionError("runRetention requires a database connection.");
  validateRetentionRules(rules);

  const db = connection.db;
  ensureRetentionRunsTable(db);

  const runId = `retention-${randomUUID()}`;
  const startedAt = now.toISOString();
  const results = [];

  for (const rule of rules) {
    if (!connection.tableExists(rule.table)) {
      results.push({ id: rule.id, table: rule.table, status: "skipped", reason: "table-missing", removed: 0 });
      continue;
    }

    const plans = [buildExpiryPlan(rule, { now }), buildKeepPlan(rule)].filter(Boolean);
    let removed = 0;
    try {
      removed = connection.withTransaction(() => {
        let total = 0;
        for (const plan of plans) {
          const statement = db.prepare(plan.sql);
          const info = plan.positional ? statement.run(...plan.positional) : statement.run(plan.named || {});
          total += Number(info.changes || 0);
        }
        return total;
      });
    } catch (error) {
      logger.warn?.(`保留策略 ${rule.id} 执行失败`, error);
      results.push({ id: rule.id, table: rule.table, status: "failed", reason: error.message, removed: 0 });
      continue;
    }
    results.push({ id: rule.id, table: rule.table, status: "applied", reason: null, removed });
  }

  const removedTotal = results.reduce((sum, item) => sum + item.removed, 0);
  const finishedAt = new Date().toISOString();
  db.prepare("INSERT INTO retention_runs (id, started_at, finished_at, removed_json) VALUES (?, ?, ?, ?)").run(
    runId,
    startedAt,
    finishedAt,
    JSON.stringify(results),
  );

  return { runId, startedAt, finishedAt, removedTotal, results };
}

export function listRetentionRuns(connection, { limit = 20 } = {}) {
  if (!connection?.db) throw new RetentionError("listRetentionRuns requires a database connection.");
  ensureRetentionRunsTable(connection.db);
  return connection.db
    .prepare("SELECT id, started_at, finished_at, removed_json FROM retention_runs ORDER BY started_at DESC LIMIT ?")
    .all(limit)
    .map((row) => ({
      runId: row.id,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      results: JSON.parse(row.removed_json || "[]"),
    }));
}
