import { randomUUID } from "node:crypto";

const BOARD_KIND = "board_change";

function toEntry(row) {
  if (!row) return null;
  return {
    approvalId: row.approvalId,
    proposal: row.payload ?? {},
    accountId: row.accountId,
    sessionId: row.sessionId || null,
    status: row.status,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt || null,
  };
}

/**
 * 审批队列。
 *
 * 以前待确认提案只存在内存 Map 里，应用一重启用户就再也确认不了，而画布提案却是落盘的，
 * 同一个功能出现两种行为。现在统一走 approvals 表，重启后仍然在。
 *
 * 画布变更提案由 boardChangeStore 管理（同为 board_change 类型），这里的 list/find 会排除它们，
 * 避免同一个提案在审批列表里出现两次。
 */
export function createApprovalManager({ repository, now = () => new Date().toISOString() } = {}) {
  if (!repository?.create) throw new Error("Approval manager requires an approval repository.");

  function submit(proposal, context = {}) {
    const kind = proposal?.type || "memory_upsert";
    const row = repository.create({
      approvalId: `approval-${Date.now()}-${randomUUID().slice(0, 8)}`,
      accountId: context.accountId,
      kind,
      status: "pending",
      summary: proposal?.memory?.statement || proposal?.proposalId || "",
      reason: "",
      sessionId: context.sessionId || null,
      payload: proposal ?? {},
      createdAt: now(),
    });
    return toEntry(row);
  }

  function list(accountId) {
    return repository
      .list({ accountId: accountId || undefined, includePayload: true })
      .filter((row) => row.kind !== BOARD_KIND)
      .map(toEntry);
  }

  function find(approvalId, accountId) {
    const row = repository.get(approvalId);
    if (!row || row.kind === BOARD_KIND) return null;
    if (accountId && row.accountId !== accountId) return null;
    return toEntry(row);
  }

  function decide(approvalId, accountId, decision) {
    if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid approval decision.");
    const row = repository.get(approvalId);
    if (!row || row.kind === BOARD_KIND || row.accountId !== accountId) throw new Error("Approval not found.");
    const decided = repository.decide(approvalId, decision, { decidedAt: now() });
    if (!decided) throw new Error("Approval not found.");
    return toEntry(decided);
  }

  return { submit, list, find, decide };
}
