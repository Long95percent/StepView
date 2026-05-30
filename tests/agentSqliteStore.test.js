import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSqliteStore } from "../electron/agentSqliteStore.js";

describe("agent sqlite store", () => {
  let tempDir;
  let store;

  afterEach(async () => {
    store?.close();
    store = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function makeStore() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-agent-sqlite-"));
    store = createAgentSqliteStore({ dataDir: tempDir });
    return store;
  }

  it("creates a task-line session and stores pending/completed turns", async () => {
    const db = await makeStore();
    const session = db.ensureSession({
      sessionId: "task:task-1",
      taskLineId: "task-1",
      title: "Launch project",
      personaText: "Help the user keep this task line moving.",
      createdAt: "2026-05-30T10:00:00.000Z",
    });

    const pending = db.appendPendingTurn({
      turnId: "turn-1",
      sessionId: session.sessionId,
      userText: "今天该推进什么？",
      route: { type: "task_line", taskLineId: "task-1" },
      createdAt: "2026-05-30T10:01:00.000Z",
    });
    const completed = db.completeTurn({
      turnId: pending.turnId,
      assistantText: "先选一个低成本动作。",
      source: "openai",
      model: "gpt-5.1",
      updatedAt: "2026-05-30T10:02:00.000Z",
    });

    expect(session).toMatchObject({
      sessionId: "task:task-1",
      taskLineId: "task-1",
      title: "Launch project",
    });
    expect(completed).toMatchObject({
      turnId: "turn-1",
      sessionId: "task:task-1",
      userText: "今天该推进什么？",
      assistantText: "先选一个低成本动作。",
      source: "openai",
      status: "complete",
    });
    expect(db.listTurns("task:task-1")).toHaveLength(1);
  });

  it("keeps windows, prompt snapshots, signals, and mem0 audit rows per session", async () => {
    const db = await makeStore();
    db.ensureSession({ sessionId: "task:task-2", taskLineId: "task-2", title: "Write thesis" });
    db.appendPendingTurn({ turnId: "turn-2", sessionId: "task:task-2", userText: "我卡住了" });
    db.completeTurn({ turnId: "turn-2", assistantText: "先拆出一个最小段落。" });

    const window = db.upsertSessionWindow("task:task-2", {
      recentTurnIds: ["turn-2"],
      rollingSummary: { text: "用户正在处理论文推进。", coveredTurnIds: ["turn-old"] },
      sessionState: { currentFocusTaskLineId: "task-2" },
      promptState: { contextWindowSize: 1 },
      updatedAt: "2026-05-30T11:00:00.000Z",
    });
    const signal = db.recordSignal({
      sessionId: "task:task-2",
      turnId: "turn-2",
      kind: "emotion",
      payload: { tone: "需要安抚" },
      createdAt: "2026-05-30T11:01:00.000Z",
    });
    const snapshot = db.recordPromptSnapshot({
      sessionId: "task:task-2",
      turnId: "turn-2",
      prompt: { messages: [] },
      systemPrompt: "system",
      userPrompt: "user",
      model: "gpt-5.1",
      createdAt: "2026-05-30T11:02:00.000Z",
    });
    const mem0 = db.logMem0Sync({
      sessionId: "task:task-2",
      turnId: "turn-2",
      action: "add",
      mem0Id: "mem-1",
      metadata: { category: "working_style" },
    });

    expect(window).toMatchObject({
      recentTurnIds: ["turn-2"],
      rollingSummary: { text: "用户正在处理论文推进。", coveredTurnIds: ["turn-old"] },
      sessionState: { currentFocusTaskLineId: "task-2" },
      promptState: { contextWindowSize: 1 },
    });
    expect(signal.payload).toEqual({ tone: "需要安抚" });
    expect(snapshot).toMatchObject({ systemPrompt: "system", userPrompt: "user" });
    expect(mem0).toMatchObject({ action: "add", mem0Id: "mem-1" });
    expect(db.loadSessionBundle("task:task-2")).toMatchObject({
      session: { sessionId: "task:task-2" },
      turns: [expect.objectContaining({ turnId: "turn-2" })],
      signals: [expect.objectContaining({ kind: "emotion" })],
    });
  });
});

