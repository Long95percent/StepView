import { boardHash } from "./boardChangeStore.js";
import { BoardChangeMergeConflict, rebaseBoardChange } from "./boardChangeMerge.js";

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
    let nextBoard = record.after;
    if (boardHash(currentBoard) !== record.baseHash) {
      try {
        nextBoard = rebaseBoardChange(record.before, currentBoard, record.after);
      } catch (error) {
        if (error instanceof BoardChangeMergeConflict) {
          throw new BoardChangeConflictError("这项修改与看板上的新变化冲突，无法自动合并。请丢弃后让 Agent 重新生成。", { proposalId });
        }
        throw error;
      }
    }
    await changeStore.snapshotBoard(currentBoard, { label: "before-apply" });
    await boardStorage.writeBoard(nextBoard);
    const decided = await changeStore.decide(proposalId, "approved");
    return { ...decided, appliedHash: boardHash(nextBoard) };
  }

  async function discard(proposalId, { accountId } = {}) {
    await loadPending(proposalId, accountId);
    return changeStore.decide(proposalId, "rejected");
  }

  return { commit, discard };
}
