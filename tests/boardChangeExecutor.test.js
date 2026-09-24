import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardChangeExecutor } from "../electron/agent/boardChangeExecutor.js";
import { createBoardChangeStore } from "../electron/agent/boardChangeStore.js";
import { createBoardStorage } from "../electron/boardStorage.js";
import { diffBoards } from "../electron/agent/boardDiff.js";
import { planBoardChange } from "../electron/agent/boardChangePlanner.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";

const NOW = new Date("2026-05-20T10:00:00.000Z");

describe("board change executor", () => {
  let tempDir;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function setup() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-executor-"));
    const boardStorage = createBoardStorage({ dataDir: tempDir });
    const changeStore = createBoardChangeStore({ dataDir: tempDir });
    const executor = createBoardChangeExecutor({ boardStorage, changeStore });
    await boardStorage.writeBoard(normalizeBoard({ tasks: [buildTask("考研", { x: 1, y: 2 }, NOW)] }));

    async function propose(input) {
      const before = await boardStorage.readBoard();
      const plan = planBoardChange(before, input, { now: NOW });
      const proposalId = `proposal-${Math.random().toString(16).slice(2).padEnd(12, "0")}-abc`;
      await changeStore.stage({
        proposalId,
        accountId: "account-a",
        operation: plan.operation,
        summary: plan.summary,
        diff: diffBoards(before, plan.board),
        before,
        after: plan.board,
      });
      return proposalId;
    }

    return { boardStorage, changeStore, executor, propose };
  }

  it("commits the staged board and rotates a durable snapshot", async () => {
    const { boardStorage, executor, propose, changeStore } = await setup();
    const current = await boardStorage.readBoard();
    const task = current.tasks[0];
    const proposalId = await propose({ operation: "node.add_milestone", taskId: task.id, sourceNodeId: task.nodes[0].id, title: "复习高数" });

    const result = await executor.commit(proposalId, { accountId: "account-a" });
    expect(result.status).toBe("approved");

    const applied = await boardStorage.readBoard();
    expect(applied.tasks[0].nodes).toHaveLength(3);
    expect(await readdir(changeStore.historyDir())).toHaveLength(1);
  });

  it("refuses to apply when the board changed after the proposal was staged", async () => {
    const { boardStorage, executor, propose } = await setup();
    const current = await boardStorage.readBoard();
    const task = current.tasks[0];
    const proposalId = await propose({ operation: "node.add_milestone", taskId: task.id, sourceNodeId: task.nodes[0].id, title: "复习高数" });

    await boardStorage.writeBoard(normalizeBoard({ tasks: [buildTask("换目标了", { x: 9, y: 9 }, NOW)] }));

    await expect(executor.commit(proposalId, { accountId: "account-a" })).rejects.toMatchObject({ code: "BOARD_CHANGE_CONFLICT" });
    expect((await boardStorage.readBoard()).tasks[0].title).toBe("换目标了");
  });

  it("enforces account ownership and single decisions", async () => {
    const { boardStorage, executor, propose } = await setup();
    const task = (await boardStorage.readBoard()).tasks[0];
    const proposalId = await propose({ operation: "task.rename", taskId: task.id, title: "考研数学" });

    await expect(executor.commit(proposalId, { accountId: "someone-else" })).rejects.toThrow("does not belong to this account");
    await expect(executor.discard("proposal-missing-000000", { accountId: "account-a" })).rejects.toThrow("Proposal not found");

    await executor.discard(proposalId, { accountId: "account-a" });
    await expect(executor.commit(proposalId, { accountId: "account-a" })).rejects.toThrow("already rejected");
  });

  it("leaves the board untouched when a change is discarded", async () => {
    const { boardStorage, executor, propose } = await setup();
    const task = (await boardStorage.readBoard()).tasks[0];
    const proposalId = await propose({ operation: "task.rename", taskId: task.id, title: "考研数学" });

    await executor.discard(proposalId, { accountId: "account-a" });
    expect((await boardStorage.readBoard()).tasks[0].title).toBe("考研");
  });
});
