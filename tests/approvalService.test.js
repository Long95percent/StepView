import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApprovalManager } from "../electron/agent/approvalManager.js";
import { createApprovalService } from "../electron/agent/approvalService.js";
import { createBoardChangeStore } from "../electron/agent/boardChangeStore.js";
import { createBoardChangeExecutor } from "../electron/agent/boardChangeExecutor.js";
import { createBoardStorage } from "../electron/boardStorage.js";
import { openAccountDatabase } from "../electron/db/index.js";
import { createApprovalRepository } from "../electron/db/repositories/approvalRepository.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";

const NOW = new Date("2026-05-20T10:00:00.000Z");
const BOARD_PROPOSAL_ID = "proposal-abcdef123456";

describe("approval service", () => {
  let tempDir;
  let database;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function setup() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-approvals-"));
    database = openAccountDatabase({ dataDir: tempDir });
    const boardStorage = createBoardStorage({ dataDir: tempDir });
    const approvalManager = createApprovalManager({ repository: createApprovalRepository({ connection: database }) });
    const boardChangeStore = createBoardChangeStore({ connection: database, accountId: "account-a" });
    const realExecutor = createBoardChangeExecutor({ boardStorage, changeStore: boardChangeStore });
    const boardChangeExecutor = { commit: vi.fn(realExecutor.commit), discard: vi.fn(realExecutor.discard) };
    const memoryRepository = { upsert: vi.fn(() => ({ id: "mem-1" })) };
    const service = createApprovalService({ approvalManager, boardChangeStore, boardChangeExecutor, memoryRepository });
    return { boardStorage, approvalManager, boardChangeStore, boardChangeExecutor, memoryRepository, service };
  }

  async function stageRename(store) {
    const before = normalizeBoard({ tasks: [buildTask("考研", { x: 1, y: 2 }, NOW)] });
    const after = normalizeBoard({ ...before, tasks: [{ ...before.tasks[0], title: "考研数学" }] });
    await store.stage({
      proposalId: BOARD_PROPOSAL_ID,
      accountId: "account-a",
      operation: "task.rename",
      summary: "重命名任务线「考研」为「考研数学」",
      reason: "更贴合目标",
      diff: { lines: ["任务线重命名「考研」→「考研数学」"], counts: { added: 0, removed: 0, modified: 1 } },
      before,
      after,
    });
    return { before, after };
  }

  it("merges board proposals and memory proposals into one review list", async () => {
    const { approvalManager, boardChangeStore, service } = await setup();
    approvalManager.submit({ type: "memory_upsert", memory: { statement: "喜欢早上工作" } }, { accountId: "account-a" });
    await stageRename(boardChangeStore);

    const list = await service.list("account-a");
    expect(list.map((item) => item.type).sort()).toEqual(["board_change", "memory_upsert"]);
    const board = list.find((item) => item.type === "board_change");
    expect(board).toMatchObject({ approvalId: BOARD_PROPOSAL_ID, summary: "重命名任务线「考研」为「考研数学」", reason: "更贴合目标" });
    expect(board.diff.lines).toEqual(["任务线重命名「考研」→「考研数学」"]);
    expect(await service.list("account-b")).toHaveLength(0);
    expect(await service.pendingCount("account-a")).toBe(2);
  });

  it("routes a board decision to the executor and hides decided proposals", async () => {
    const { boardStorage, boardChangeStore, boardChangeExecutor, service } = await setup();
    const { before } = await stageRename(boardChangeStore);
    await boardStorage.writeBoard(before);

    const result = await service.decide(BOARD_PROPOSAL_ID, "account-a", "approved");
    expect(boardChangeExecutor.commit).toHaveBeenCalledWith(BOARD_PROPOSAL_ID, { accountId: "account-a" });
    expect(result.approval.status).toBe("approved");
    expect(await service.list("account-a")).toHaveLength(0);
    expect((await boardStorage.readBoard()).tasks[0].title).toBe("考研数学");
  });

  it("applies an approved memory proposal", async () => {
    const { approvalManager, memoryRepository, service } = await setup();
    const entry = approvalManager.submit({ type: "memory_upsert", memory: { statement: "喜欢早上工作" } }, { accountId: "account-a" });

    const result = await service.decide(entry.approvalId, "account-a", "approved");
    expect(memoryRepository.upsert).toHaveBeenCalled();
    expect(result.appliedMemory).toEqual({ id: "mem-1" });
  });

  it("does not apply a rejected memory proposal", async () => {
    const { approvalManager, memoryRepository, service } = await setup();
    const entry = approvalManager.submit({ type: "memory_upsert", memory: { statement: "x" } }, { accountId: "account-a" });

    const rejected = await service.decide(entry.approvalId, "account-a", "rejected");
    expect(rejected.appliedMemory).toBe(null);
    expect(memoryRepository.upsert).not.toHaveBeenCalled();
  });

  it("refuses unknown ids and ids owned by another account", async () => {
    const { approvalManager, boardChangeStore, service } = await setup();
    const memoryEntry = approvalManager.submit({ type: "memory_upsert", memory: { statement: "x" } }, { accountId: "account-a" });
    await stageRename(boardChangeStore);

    await expect(service.decide("approval-unknown", "account-a", "approved")).rejects.toThrow("Approval not found");
    await expect(service.decide("not-a-proposal-id", "account-a", "approved")).rejects.toThrow("Approval not found");
    await expect(service.decide(memoryEntry.approvalId, "account-b", "approved")).rejects.toThrow();
    await expect(service.decide(BOARD_PROPOSAL_ID, "account-b", "approved")).rejects.toThrow("Approval not found");
  });
});
