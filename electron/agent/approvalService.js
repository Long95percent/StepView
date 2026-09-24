import { isProposalId } from "./boardChangeStore.js";

function byCreatedAt(a, b) {
  return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
}

export function boardProposalView(record) {
  return {
    approvalId: record.proposalId,
    type: "board_change",
    status: record.status,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt || null,
    summary: record.summary,
    reason: record.reason,
    operation: record.operation,
    sessionId: record.sessionId || null,
    diff: record.diff || null,
    requiresApproval: true,
  };
}

export function memoryApprovalView(entry) {
  return {
    approvalId: entry.approvalId,
    type: entry.proposal?.type || "memory_upsert",
    status: entry.status,
    createdAt: entry.createdAt,
    decidedAt: entry.decidedAt || null,
    summary: entry.proposal?.memory?.statement || entry.proposal?.proposalId || "",
    reason: "",
    operation: null,
    sessionId: entry.sessionId || null,
    diff: null,
    requiresApproval: true,
  };
}

export function createApprovalService({ approvalManager, boardChangeStore, boardChangeExecutor, memoryRepository } = {}) {
  if (!approvalManager) throw new Error("Approval service requires an approval manager.");

  async function list(accountId) {
    const memoryItems = approvalManager.list(accountId).map(memoryApprovalView);
    const boardItems = boardChangeStore
      ? (await boardChangeStore.list({ status: "pending", accountId })).map(boardProposalView)
      : [];
    return [...boardItems, ...memoryItems].sort(byCreatedAt);
  }

  async function decide(approvalId, accountId, decision) {
    const entry = approvalManager.find(approvalId, accountId);
    if (entry) {
      const decided = approvalManager.decide(approvalId, accountId, decision);
      let appliedMemory = null;
      if (decided.status === "approved" && decided.proposal?.type === "memory_upsert" && memoryRepository) {
        appliedMemory = memoryRepository.upsert(decided.proposal.memory);
      }
      return { approval: memoryApprovalView(decided), appliedMemory };
    }

    if (!boardChangeStore || !boardChangeExecutor || !isProposalId(approvalId)) throw new Error("Approval not found.");
    const existing = await boardChangeStore.get(approvalId, { includePayload: false });
    if (!existing || existing.accountId !== accountId) throw new Error("Approval not found.");
    const record = decision === "approved"
      ? await boardChangeExecutor.commit(approvalId, { accountId })
      : await boardChangeExecutor.discard(approvalId, { accountId });
    return { approval: boardProposalView(record), appliedMemory: null };
  }

  async function pendingCount(accountId) {
    return (await list(accountId)).filter((item) => item.status === "pending").length;
  }

  return { list, decide, pendingCount };
}
