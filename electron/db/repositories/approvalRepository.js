const APPROVAL_COLUMNS = `
  id, account_id, kind, status, summary, reason, operation, session_id,
  payload_json, diff_json, base_hash, created_at, decided_at
`;

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toApproval(row, { includePayload }) {
  if (!row) return null;
  const approval = {
    approvalId: row.id,
    accountId: row.account_id,
    kind: row.kind,
    status: row.status,
    summary: row.summary,
    reason: row.reason,
    operation: row.operation,
    sessionId: row.session_id,
    diff: parseJson(row.diff_json, null),
    baseHash: row.base_hash,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
  return includePayload ? { ...approval, payload: parseJson(row.payload_json, {}) } : approval;
}

/**
 * 审批队列仓储。
 *
 * 记忆类提案以前只存在内存里，重启即丢；画布类提案以前一个提案一个文件，列表要全扫目录。
 * 现在两者都是这张表里的行，行为一致，也不需要扫目录。
 */
export function createApprovalRepository({ connection } = {}) {
  if (!connection?.db) throw new Error("Approval repository requires a database connection.");
  const { db } = connection;

  const insertApproval = db.prepare(`
    INSERT INTO approvals (${APPROVAL_COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      summary = excluded.summary,
      reason = excluded.reason,
      operation = excluded.operation,
      session_id = excluded.session_id,
      payload_json = excluded.payload_json,
      diff_json = excluded.diff_json,
      base_hash = excluded.base_hash,
      decided_at = excluded.decided_at
  `);

  function normalizeApproval(record) {
    const payload = {
      approvalId: String(record.approvalId || record.id || ""),
      accountId: String(record.accountId || ""),
      kind: String(record.kind || ""),
      status: String(record.status || "pending"),
      summary: String(record.summary || ""),
      reason: String(record.reason || "").slice(0, 500),
      operation: record.operation ? String(record.operation) : null,
      sessionId: record.sessionId ? String(record.sessionId) : null,
      payload: record.payload ?? {},
      diff: record.diff ?? null,
      baseHash: record.baseHash ? String(record.baseHash) : null,
      createdAt: String(record.createdAt || new Date().toISOString()),
      decidedAt: record.decidedAt || null,
    };
    if (!payload.approvalId) throw new Error("An approval requires an id.");
    if (!payload.accountId) throw new Error("An approval requires an accountId.");
    if (!payload.kind) throw new Error("An approval requires a kind.");
    return payload;
  }

  function create(record) {
    const payload = normalizeApproval(record);
    insertApproval.run(
      payload.approvalId,
      payload.accountId,
      payload.kind,
      payload.status,
      payload.summary,
      payload.reason,
      payload.operation,
      payload.sessionId,
      JSON.stringify(payload.payload),
      payload.diff ? JSON.stringify(payload.diff) : null,
      payload.baseHash,
      payload.createdAt,
      payload.decidedAt,
    );
    return get(payload.approvalId);
  }

  const insertApprovalIfAbsent = db.prepare(`
    INSERT INTO approvals (${APPROVAL_COLUMNS})
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  /**
   * 写入一条审批记录，但如果同 id 已存在就完全不动它。
   * 历史数据导入必须用这个方法：否则会把用户已经批准过的提案重新变回待确认。
   */
  function createIfAbsent(record) {
    const payload = normalizeApproval(record);
    insertApprovalIfAbsent.run(
      payload.approvalId,
      payload.accountId,
      payload.kind,
      payload.status,
      payload.summary,
      payload.reason,
      payload.operation,
      payload.sessionId,
      JSON.stringify(payload.payload),
      payload.diff ? JSON.stringify(payload.diff) : null,
      payload.baseHash,
      payload.createdAt,
      payload.decidedAt,
    );
    return get(payload.approvalId);
  }

  function get(approvalId, { includePayload = true } = {}) {
    const row = db.prepare(`SELECT ${APPROVAL_COLUMNS} FROM approvals WHERE id = ?`).get(String(approvalId || ""));
    return toApproval(row, { includePayload });
  }

  function list({ kind, status, accountId, includePayload = false, limit } = {}) {
    const rows = db
      .prepare(`
        SELECT ${APPROVAL_COLUMNS} FROM approvals
        WHERE (? IS NULL OR kind = ?)
          AND (? IS NULL OR status = ?)
          AND (? IS NULL OR account_id = ?)
        ORDER BY created_at ASC, id ASC
        LIMIT ?
      `)
      .all(
        kind || null, kind || null,
        status || null, status || null,
        accountId || null, accountId || null,
        Number.isInteger(limit) && limit > 0 ? limit : -1,
      );
    return rows.map((row) => toApproval(row, { includePayload }));
  }

  function decide(approvalId, status, { decidedAt = new Date().toISOString() } = {}) {
    if (!["approved", "rejected", "expired"].includes(status)) throw new Error(`Invalid approval status: ${status}`);
    const info = db
      .prepare("UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?")
      .run(status, decidedAt, String(approvalId || ""));
    if (Number(info.changes || 0) === 0) return null;
    return get(approvalId);
  }

  function remove(approvalId) {
    const info = db.prepare("DELETE FROM approvals WHERE id = ?").run(String(approvalId || ""));
    return Number(info.changes || 0) > 0;
  }

  function countByKind({ accountId, kind } = {}) {
    const row = db
      .prepare("SELECT COUNT(*) AS count FROM approvals WHERE account_id = ? AND kind = ?")
      .get(String(accountId || ""), String(kind || ""));
    return Number(row?.count || 0);
  }

  const insertSnapshot = db.prepare(`
    INSERT INTO snapshots (id, account_id, kind, label, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      payload_json = excluded.payload_json
  `);

  const insertSnapshotIfAbsent = db.prepare(`
    INSERT INTO snapshots (id, account_id, kind, label, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);

  function addSnapshot({ snapshotId, accountId, kind, label = "", payload, createdAt }, { ifAbsent = false } = {}) {
    if (!snapshotId) throw new Error("A snapshot requires an id.");
    if (!accountId) throw new Error("A snapshot requires an accountId.");
    const statement = ifAbsent ? insertSnapshotIfAbsent : insertSnapshot;
    statement.run(
      String(snapshotId),
      String(accountId),
      String(kind || "board"),
      String(label || ""),
      JSON.stringify(payload ?? null),
      String(createdAt || new Date().toISOString()),
    );
    return toSnapshot(db.prepare("SELECT * FROM snapshots WHERE id = ?").get(String(snapshotId)), { includePayload: false });
  }

  function toSnapshot(row, { includePayload }) {
    if (!row) return null;
    const snapshot = {
      snapshotId: row.id,
      accountId: row.account_id,
      kind: row.kind,
      label: row.label,
      createdAt: row.created_at,
    };
    return includePayload ? { ...snapshot, payload: parseJson(row.payload_json, null) } : snapshot;
  }

  function listSnapshots({ accountId, kind, includePayload = false, limit } = {}) {
    const rows = db
      .prepare(`
        SELECT * FROM snapshots
        WHERE (? IS NULL OR account_id = ?)
          AND (? IS NULL OR kind = ?)
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `)
      .all(
        accountId || null, accountId || null,
        kind || null, kind || null,
        Number.isInteger(limit) && limit > 0 ? limit : -1,
      );
    return rows.map((row) => toSnapshot(row, { includePayload }));
  }

  return { create, createIfAbsent, get, list, decide, remove, countByKind, addSnapshot, listSnapshots };
}
