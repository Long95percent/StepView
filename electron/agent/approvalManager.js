export function createApprovalManager() {
  const pending = new Map();
  function submit(proposal, context = {}) { const approvalId = `approval-${Date.now()}-${Math.random().toString(16).slice(2)}`; const entry = { approvalId, proposal, accountId: context.accountId, sessionId: context.sessionId || null, status: "pending", createdAt: new Date().toISOString() }; pending.set(approvalId, entry); return entry; }
  function list(accountId) { return [...pending.values()].filter((item) => !accountId || item.accountId === accountId); }
  function decide(approvalId, accountId, decision) { const entry = pending.get(approvalId); if (!entry || entry.accountId !== accountId) throw new Error("Approval not found."); if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid approval decision."); entry.status = decision; entry.decidedAt = new Date().toISOString(); return entry; }
  return { submit, list, decide };
}
