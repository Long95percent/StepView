import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountContext } from "../electron/gateway/accountContext.js";
import { createToolRunner, openAiToolSchemas } from "../electron/agent/toolBridge.js";
import { buildTask, normalizeBoard } from "../src/progressCore.js";

const ACCOUNT_ID = "account-wiring";

describe("gateway tool wiring", () => {
  let tempDir;
  let context;

  afterEach(async () => {
    await context?.close();
    context = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function setup() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-wiring-"));
    context = createAccountContext({
      account: { accountId: ACCOUNT_ID },
      accountsDir: tempDir,
      redisCacheFactory: () => ({
        savePromptState: async () => {},
        saveWindowState: async () => {},
        loadPromptState: async () => null,
        loadWindowState: async () => null,
        close: async () => {},
      }),
    });
    await context.boardStorage.writeBoard(normalizeBoard({ tasks: [buildTask("家庭计划", { x: 1, y: 2 })] }));
    return context;
  }

  it("exposes the same tool schemas and per-account storage the gateways use", async () => {
    await setup();
    const names = openAiToolSchemas(context.toolRegistry).map((tool) => tool.function.name);
    expect(names).toContain("board.propose_change");
    expect(names).toContain("board.get_current_state");
    expect(context.dataDir).toBe(path.join(tempDir, ACCOUNT_ID));
    expect(context.boardChangeStore.proposalsDir()).toBe(path.join(tempDir, ACCOUNT_ID, "proposals"));
  });

  it("runs the full propose, review and approve loop through the shared tool bridge", async () => {
    await setup();
    const runTool = createToolRunner(context, "session-1");
    const task = (await context.boardStorage.readBoard()).tasks[0];

    const proposal = await runTool("board.propose_change", { operation: "task.rename", reason: "更贴合目标", taskId: task.id, title: "家庭新目标" });
    expect(proposal).toMatchObject({ type: "board_change", accountId: ACCOUNT_ID, operation: "task.rename" });
    expect(proposal.diff.lines).toContain("任务线重命名「家庭计划」→「家庭新目标」");
    expect((await context.boardStorage.readBoard()).tasks[0].title).toBe("家庭计划");

    const pending = await context.approvalService.list(ACCOUNT_ID);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ approvalId: proposal.proposalId, status: "pending", reason: "更贴合目标" });

    const decided = await context.approvalService.decide(proposal.proposalId, ACCOUNT_ID, "approved");
    expect(decided.approval.status).toBe("approved");
    expect((await context.boardStorage.readBoard()).tasks[0].title).toBe("家庭新目标");
    expect(await context.approvalService.list(ACCOUNT_ID)).toHaveLength(0);
  });

  it("keeps a discard from touching the stored board", async () => {
    await setup();
    const runTool = createToolRunner(context, "session-1");
    const task = (await context.boardStorage.readBoard()).tasks[0];

    const proposal = await runTool("board.propose_change", { operation: "task.delete", reason: "不再需要", taskId: task.id });
    await context.approvalService.decide(proposal.proposalId, ACCOUNT_ID, "rejected");

    expect((await context.boardStorage.readBoard()).tasks).toHaveLength(1);
    expect(await context.approvalService.list(ACCOUNT_ID)).toHaveLength(0);
  });

  it("isolates review decisions per account", async () => {
    await setup();
    const runTool = createToolRunner(context, "session-1");
    const task = (await context.boardStorage.readBoard()).tasks[0];
    const proposal = await runTool("board.propose_change", { operation: "task.rename", reason: "r", taskId: task.id, title: "别的账号" });

    await expect(context.approvalService.decide(proposal.proposalId, "account-other", "approved")).rejects.toThrow("Approval not found");
    expect((await context.boardStorage.readBoard()).tasks[0].title).toBe("家庭计划");
  });
});
