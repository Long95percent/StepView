import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createToolRegistry } from "../electron/agent/toolRegistry.js";
import { registerBuiltInTools } from "../electron/agent/builtInTools.js";
import { createToolRuntime } from "../electron/agent/toolRuntime.js";
import { createToolContext } from "../electron/agent/toolBridge.js";
import { createBoardStorage } from "../electron/boardStorage.js";
import { createBoardChangeStore } from "../electron/agent/boardChangeStore.js";
import { openAccountDatabase } from "../electron/db/index.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";

const NOW = new Date("2026-05-20T10:00:00.000Z");

describe("built-in tools", () => {
  let tempDir;
  const databases = [];

  afterEach(async () => {
    while (databases.length) databases.pop().close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function makeRegistry() {
    const registry = createToolRegistry();
    registerBuiltInTools({ registry });
    return registry;
  }

  async function makeBoardContext() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-tools-"));
    const boardStorage = createBoardStorage({ dataDir: tempDir });
    await boardStorage.writeBoard(normalizeBoard({ tasks: [buildTask("考研", { x: 1, y: 2 }, NOW)] }));
    const database = openAccountDatabase({ dataDir: tempDir });
    databases.push(database);
    const boardChangeStore = createBoardChangeStore({ connection: database, accountId: "account-a" });
    return { accountId: "account-a", sessionId: "session-1", boardStorage, boardChangeStore };
  }

  it("exposes scoped read tools", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry });
    const result = await runtime.run("agent.get_current_context", {}, { accountId: "a", sessionId: "s" });
    expect(result.result).toMatchObject({ accountId: "a", sessionId: "s" });
    expect(registry.list().map((tool) => tool.id)).toContain("memory.search");
  });

  it("creates proposals without mutating stores", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry, approval: async () => true });
    const result = await runtime.run("memory.propose_upsert", { category: "preference", subjectKey: "style", statement: "short" }, { accountId: "a" });
    expect(result.result).toMatchObject({ type: "memory_upsert", accountId: "a", memory: { status: "candidate" } });
  });

  it("registers every tool with uniform metadata", () => {
    const tools = makeRegistry().list();
    expect(tools.map((tool) => tool.id)).toEqual([
      "board.get_current_state",
      "board.search",
      "board.propose_change",
      "diary.recent",
      "diary.propose_entry",
      "memory.search",
      "memory.get",
      "memory.propose_upsert",
      "agent.get_current_context",
    ]);
    for (const tool of tools) {
      expect(tool.id).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
      expect(["read", "propose", "write"]).toContain(tool.risk);
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(Array.isArray(tool.scopes)).toBe(true);
    }
    expect(tools.filter((tool) => tool.risk === "write")).toHaveLength(0);
  });

  it("stages a reviewable board change without touching the live board", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry });
    const context = await makeBoardContext();
    const task = (await context.boardStorage.readBoard()).tasks[0];

    const { result } = await runtime.run("board.propose_change", {
      operation: "node.add_milestone",
      reason: "把目标拆小",
      taskId: task.id,
      sourceNodeId: task.nodes[0].id,
      title: "复习高数",
    }, context);

    expect(result).toMatchObject({ type: "board_change", accountId: "account-a", operation: "node.add_milestone", summary: "在「考研」新增里程碑「复习高数」" });
    expect(result.diff.lines).toEqual(["在「考研」新增里程碑「复习高数」", "「考研」的连接关系已调整"]);

    expect((await context.boardStorage.readBoard()).tasks[0].nodes).toHaveLength(2);
    const pending = await context.boardChangeStore.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].proposalId).toBe(result.proposalId);

    const staged = await context.boardChangeStore.get(result.proposalId);
    expect(staged.before.tasks[0].nodes).toHaveLength(2);
    expect(staged.after.tasks[0].nodes).toHaveLength(3);
  });

  it("stages a connected node sequence as one reviewable proposal", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry });
    const context = await makeBoardContext();
    const task = (await context.boardStorage.readBoard()).tasks[0];

    const { result } = await runtime.run("board.propose_change", {
      operation: "node.add_sequence",
      reason: "把计划拆成连续步骤",
      taskId: task.id,
      sourceNodeId: task.nodes[0].id,
      nodes: [{ title: "第一步" }, { title: "第二步" }, { title: "第三步" }],
    }, context);

    expect(result).toMatchObject({ type: "board_change", operation: "node.add_sequence", requiresApproval: true });
    expect(result.affected.nodeIds).toHaveLength(3);
    const pending = await context.boardChangeStore.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    const staged = await context.boardChangeStore.get(result.proposalId);
    const addedNodes = staged.after.tasks[0].nodes.filter((node) => result.affected.nodeIds.includes(node.id));
    const edges = new Set(staged.after.tasks[0].edges.map((edge) => `${edge.from}->${edge.to}`));
    expect(edges).toContain(`${addedNodes[0].id}->${addedNodes[1].id}`);
    expect(edges).toContain(`${addedNodes[1].id}->${addedNodes[2].id}`);
  });

  it("rejects unsupported operations and no-op changes", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry });
    const context = await makeBoardContext();
    const task = (await context.boardStorage.readBoard()).tasks[0];

    await expect(runtime.run("board.propose_change", { operation: "board.wipe", reason: "x" }, context)).rejects.toThrow("must be one of");
    await expect(runtime.run("board.propose_change", { operation: "task.rename", reason: "x", taskId: "missing", title: "y" }, context)).rejects.toThrow("Unknown task");
    await expect(runtime.run("board.propose_change", { operation: "task.rename", reason: "x", taskId: task.id, title: "考研" }, context)).rejects.toThrow("would not modify the board");
    await expect(runtime.run("board.propose_change", { operation: "task.rename", taskId: task.id, title: "考研数学" }, context)).rejects.toThrow("Missing required input: reason");
  });

  it("fails clearly when the tool context is incomplete", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry });
    await expect(runtime.run("board.get_current_state", {}, { accountId: "a" })).rejects.toThrow('missing required context: context.boardStorage');
  });

  it("returns a compact board overview and the current task line's nodes", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry });
    const context = await makeBoardContext();
    const task = (await context.boardStorage.readBoard()).tasks[0];

    const { result } = await runtime.run("board.get_current_state", {}, createToolContext(context, `task:${task.id}`));

    expect(result.selectedTaskId).toBe(task.id);
    expect(result.selectedTask.nodes.map((node) => node.id)).toEqual(task.nodes.map((node) => node.id));
    expect(result.tasks).toEqual([expect.objectContaining({ id: task.id, nodeCount: task.nodes.length, planCount: 0, branchCount: 0 })]);
    expect(result.summary).toMatchObject({ taskCount: 1, nodeCount: task.nodes.length, stickerCount: 0, branchCount: 0 });
  });

  it("keeps current-state output bounded when other task lines are large", async () => {
    const registry = makeRegistry();
    const runtime = createToolRuntime({ registry });
    const context = await makeBoardContext();
    const task = (await context.boardStorage.readBoard()).tasks[0];
    const otherTask = buildTask("大型任务线", { x: 8, y: 9 }, NOW);
    otherTask.nodes = Array.from({ length: 400 }, (_, index) => ({
      id: `node-large-${index}`,
      taskId: otherTask.id,
      kind: "plan-milestone",
      title: `大型节点 ${index}`,
      detail: "很长的节点详情".repeat(100),
      timestamp: NOW.toISOString(),
      x: index,
      y: index,
    }));
    await context.boardStorage.writeBoard(normalizeBoard({ tasks: [task, otherTask] }));

    const { result } = await runtime.run("board.get_current_state", {}, createToolContext(context, `task:${task.id}`));

    expect(result.selectedTaskId).toBe(task.id);
    expect(result.selectedTask.nodes).toHaveLength(task.nodes.length);
    expect(result.tasks.find((candidate) => candidate.id === otherTask.id)).toMatchObject({ nodeCount: 400 });
    expect(result.tasks.find((candidate) => candidate.id === otherTask.id).nodes).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(100_000);
  });
});
