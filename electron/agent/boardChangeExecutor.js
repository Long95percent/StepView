import { boardHash } from "./boardChangeStore.js";

export class BoardChangeConflictError extends Error {
  constructor(message, { proposalId = null } = {}) {
    super(message);
    this.name = "BoardChangeConflictError";
    this.code = "BOARD_CHANGE_CONFLICT";
    this.proposalId = proposalId;
  }
}

export function createBoardChangeExecutor({ boardStorage, changeStore } = {}) {
  if (!boardStorage) throw new Error("Board change executor requires boardStorage.");
  if (!changeStore) throw new Error("Board change executor requires a change store.");

  async function loadPending(proposalId, accountId) {
    const record = await changeStore.get(proposalId);
    if (!record) throw new Error("Proposal not found.");
    if (accountId && record.accountId !== accountId) throw new Error("Proposal does not belong to this account.");
    if (record.status !== "pending") throw new Error(`Proposal already ${record.status}.`);
    return record;
  }

  async function commit(proposalId, { accountId } = {}) {
    const record = await loadPending(proposalId, accountId);
    const currentBoard = await boardStorage.readBoard();
    if (boardHash(currentBoard) !== record.baseHash) {
      throw new BoardChangeConflictError("The board changed after this proposal was created. Please review a fresh proposal.", { proposalId });
    }
    await changeStore.snapshotBoard(record.before, { label: "before-apply" });
    await boardStorage.writeBoard(record.after);
    const decided = await changeStore.decide(proposalId, "approved");
    return { ...decided, appliedHash: boardHash(record.after) };
  }

  async function discard(proposalId, { accountId } = {}) {
    await loadPending(proposalId, accountId);
    return changeStore.decide(proposalId, "rejected");
  }

  return { commit, discard };
}
