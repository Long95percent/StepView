import { normalizeBoard } from "../../src/progressCore.js";
import { createApprovalRepository } from "../db/repositories/approvalRepository.js";
import {
  DEFAULT_APPROVAL_TTL_DAYS,
  DEFAULT_MAX_PENDING_APPROVALS,
  DEFAULT_MAX_SNAPSHOTS as DEFAULT_MAX_SNAPSHOTS_COUNT,
  buildApprovalRetentionRules,
  buildSnapshotRetentionRules,
  runRetention,
} from "../db/retention.js";

const PROPOSAL_ID_PATTERN = /^proposal-[A-Za-z0-9-]{6,120}$/;
export const BOARD_CHANGE_KIND = "board_change";
export const BOARD_SNAPSHOT_KIND = "board";

export const DEFAULT_MAX_PROPOSALS = DEFAULT_MAX_PENDING_APPROVALS;
export const DEFAULT_MAX_SNAPSHOTS = DEFAULT_MAX_SNAPSHOTS_COUNT;
export const DEFAULT_PROPOSAL_TTL_MS = DEFAULT_APPROVAL_TTL_DAYS * 24 * 60 * 60 * 1000;

export { boardHash, canonicalJson } from "../db/boardHash.js";
import { boardHash } from "../db/boardHash.js";

export function isProposalId(value) {
  return PROPOSAL_ID_PATTERN.test(String(value || ""));
}

function requireProposalId(value) {
  const id = String(value || "");
  if (!PROPOSAL_ID_PATTERN.test(id)) throw new Error(`Invalid proposal id: ${value}`);
  return id;
}

function toProposal(row, { includePayload }) {
  if (!row) return null;
  const record = {
    proposalId: row.approvalId,
    accountId: row.accountId,
    sessionId: row.sessionId || null,
    operation: row.operation,
    reason: row.reason,
    summary: row.summary,
    diff: row.diff || { changes: [], lines: [], counts: { added: 0, removed: 0, modified: 0 } },
    baseHash: row.baseHash,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt || null,
  };
  if (includePayload) {
    record.before = normalizeBoard(row.payload?.before);
    record.after = normalizeBoard(row.payload?.after);
  }
  return record;
}

/**
 * 画布变更提案与快照。
 *
 * 以前是 “一个提案一个 JSON 文件”，列表要 readdir 整个目录再逐个解析。
 * 现在落到 approvals / snapshots 两张表，列表是一条带索引的查询。
 *
 * 注意：不再返回 proposalsDir / historyDir —— 数据已经不在文件里了。
 */
export function createBoardChangeStore({
  connection,
  accountId,
  maxProposals = DEFAULT_MAX_PROPOSALS,
  maxSnapshots = DEFAULT_MAX_SNAPSHOTS_COUNT,
  ttlMs = DEFAULT_PROPOSAL_TTL_MS,
  now = () => new Date(),
  logger = console,
} = {}) {
  if (!connection?.db) throw new Error("Board change store requires a database connection.");
  if (!accountId) throw new Error("Board change store requires an accountId.");

  const repository = createApprovalRepository({ connection });

  function prune() {
    const rules = [
      ...buildApprovalRetentionRules({ kind: BOARD_CHANGE_KIND, maxPending: maxProposals, ttlDays: ttlMs / (24 * 60 * 60 * 1000) }),
      ...buildSnapshotRetentionRules({ kind: BOARD_SNAPSHOT_KIND, maxSnapshots }),
    ];
    const report = runRetention({ connection, rules, now: now(), logger });
    const kept = repository.list({ kind: BOARD_CHANGE_KIND }).length;
    return { removed: report.removedTotal, kept };
  }

  function stage({ proposalId, accountId: recordAccountId, sessionId = null, operation, reason = "", summary, diff, before, after }) {
    const id = requireProposalId(proposalId);
    const owner = recordAccountId || accountId;
    if (!owner) throw new Error("A proposal requires an accountId.");

    const row = repository.create({
      approvalId: id,
      accountId: owner,
      kind: BOARD_CHANGE_KIND,
      status: "pending",
      summary: String(summary || ""),
      reason: String(reason || "").slice(0, 500),
      operation,
      sessionId,
      payload: { before: normalizeBoard(before), after: normalizeBoard(after) },
      diff: diff || { changes: [], lines: [], counts: { added: 0, removed: 0, modified: 0 } },
      baseHash: boardHash(before),
      createdAt: now().toISOString(),
    });
    prune();
    return toProposal(repository.get(row.approvalId, { includePayload: false }), { includePayload: false });
  }

  function get(proposalId, { includePayload = true } = {}) {
    const id = requireProposalId(proposalId);
    const row = repository.get(id, { includePayload });
    if (!row || row.kind !== BOARD_CHANGE_KIND || row.accountId !== accountId) return null;
    return toProposal(row, { includePayload });
  }

  function list({ status, accountId: filterAccountId, includePayload = false } = {}) {
    const rows = repository.list({ kind: BOARD_CHANGE_KIND, status, accountId: filterAccountId, includePayload });
    return rows
      .filter((row) => row.accountId === accountId)
      .map((row) => toProposal(row, { includePayload }));
  }

  function decide(proposalId, decision) {
    if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid proposal decision.");
    const record = get(proposalId, { includePayload: false });
    if (!record) throw new Error("Proposal not found.");
    if (record.status !== "pending") throw new Error(`Proposal already ${record.status}.`);
    const row = repository.decide(record.proposalId, decision, { decidedAt: now().toISOString() });
    return toProposal(row, { includePayload: false });
  }

  function remove(proposalId) {
    const id = requireProposalId(proposalId);
    const record = get(id, { includePayload: false });
    if (!record) return false;
    return repository.remove(record.proposalId);
  }

  function snapshotBoard(board, { label = "before-change", now: snapshotTime = now() } = {}) {
    const safeLabel = String(label).replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40) || "snapshot";
    const createdAt = snapshotTime.toISOString();
    const snapshotId = `snapshot-${createdAt.replace(/[:.]/g, "-")}-${safeLabel}`;
    const inserted = repository.addSnapshot({
      snapshotId,
      accountId,
      kind: BOARD_SNAPSHOT_KIND,
      label: safeLabel,
      payload: normalizeBoard(board),
      createdAt,
    }).snapshotId;
    prune();
    return inserted;
  }

  function listSnapshots({ includePayload = false, limit } = {}) {
    return repository.listSnapshots({ accountId, kind: BOARD_SNAPSHOT_KIND, includePayload, limit });
  }

  return {
    stage,
    get,
    list,
    decide,
    remove,
    prune,
    snapshotBoard,
    listSnapshots,
    accountId,
  };
}
