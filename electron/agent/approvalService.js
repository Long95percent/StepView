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

export function diaryChangeView(entry) {
  const proposal = entry.proposal || {};
  return {
    approvalId: entry.approvalId,
    type: "diary_change",
    status: entry.status,
    createdAt: entry.createdAt,
    decidedAt: entry.decidedAt || null,
    summary: proposal.summary || "",
    reason: proposal.reason || "",
    operation: proposal.operation || null,
    sessionId: entry.sessionId || null,
    diff: proposal.diff || null,
    requiresApproval: true,
  };
}

function approvalView(entry) {
  return entry?.proposal?.type === "diary_change" ? diaryChangeView(entry) : memoryApprovalView(entry);
}

export function createApprovalService({ approvalManager, boardChangeStore, boardChangeExecutor, memoryRepository, diaryService } = {}) {
  if (!approvalManager) throw new Error("Approval service requires an approval manager.");

  /**
   * 待确认队列。
   *
   * 只回 pending：这是"待确认的修改"面板，已经决定过的提案不该继续挂在上面带一对按钮。
   * 画布提案一直是按 pending 过滤的，记忆和日记提案也必须一样。
   */
  async function list(accountId) {
    const pendingEntries = approvalManager.list(accountId).filter((entry) => entry.status === "pending");
    const memoryItems = pendingEntries.map(approvalView);
    const boardItems = boardChangeStore
      ? (await boardChangeStore.list({ status: "pending", accountId })).map(boardProposalView)
      : [];
    return [...boardItems, ...memoryItems].sort(byCreatedAt);
  }

  async function decide(approvalId, accountId, decision) {
    const entry = approvalManager.find(approvalId, accountId);
    if (entry) {
      const proposal = entry.proposal || {};
      // 日记变更先落库再标记"已批准"：落库是会失败的一步（校验、乐观锁），
      // 不能先把提案标成已批准、结果什么都没写进去。画布变更也是这个顺序。
      if (decision === "approved" && proposal.type === "diary_change") {
        if (!diaryService) throw new Error("Diary approval requires a diary service.");
        const appliedDiary = diaryService.applyChange(proposal);
        const decidedDiary = approvalManager.decide(approvalId, accountId, decision);
        return { approval: diaryChangeView(decidedDiary), appliedMemory: null, appliedDiary };
      }
      const decided = approvalManager.decide(approvalId, accountId, decision);
      let appliedMemory = null;
      if (decided.status === "approved" && decided.proposal?.type === "memory_upsert" && memoryRepository) {
        appliedMemory = memoryRepository.upsert(decided.proposal.memory);
      }
      return { approval: approvalView(decided), appliedMemory };
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
    return (await list(accountId)).length;
  }

  return { list, decide, pendingCount };
}
