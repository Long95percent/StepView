import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMem0Client } from "../electron/agentMem0Client.js";
import { createAgentService } from "../electron/agentService.js";
import { createAgentSqliteStore } from "../electron/agentSqliteStore.js";
import { buildAgentMemory } from "../src/agentMemory.js";
import { buildTask, normalizeBoard } from "../src/progressCore.js";

describe("agent service", () => {
  let tempDir;
  let sqliteStore;

  afterEach(async () => {
    sqliteStore?.close();
    sqliteStore = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function makeService() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-agent-service-"));
    sqliteStore = createAgentSqliteStore({ dataDir: tempDir });
    const redisCalls = [];
    const redisCache = {
      savePromptState: async (sessionId, state) => {
        redisCalls.push({ type: "prompt", sessionId, state });
      },
      saveWindowState: async (sessionId, state) => {
        redisCalls.push({ type: "window", sessionId, state });
      },
      loadPromptState: async () => null,
      loadWindowState: async () => null,
    };
    const mem0Calls = [];
    const mem0Client = createMem0Client({
      apiKey: "mem0-key",
      baseUrl: "https://mem0.example/v1",
      fetchImpl: async (url, options) => {
        mem0Calls.push({ url, options });
        if (url.endsWith("/search")) {
          return { ok: true, json: async () => ({ memories: [{ memory: "用户偏好低压力推进" }] }) };
        }
        return { ok: true, json: async () => ({ id: "mem-1" }) };
      },
    });
    const service = createAgentService({ sqliteStore, redisCache, mem0Client, logger: console });
    return { service, redisCalls, mem0Calls };
  }

  it("prepares a session chat prompt from the session window and board memory", async () => {
    const { service, redisCalls } = await makeService();
    const task = buildTask("launch product", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [task], stickers: [] });
    const boardMemory = buildAgentMemory(board);
    service.syncSessionsFromBoardMemory(boardMemory);

    const prepared = await service.prepareChat({
      sessionId: `task:${task.id}`,
      userText: "我今天该推进什么？",
      boardMemory,
      model: "gpt-5.1",
    });

    expect(prepared.session).toMatchObject({
      sessionId: `task:${task.id}`,
      taskLineId: task.id,
    });
    expect(prepared.turn).toMatchObject({
      userText: "我今天该推进什么？",
      status: "pending",
    });
    expect(prepared.prompt.systemPrompt).toContain(`Session: task:${task.id}`);
    expect(prepared.prompt.systemPrompt).toContain("launch product");
    expect(prepared.prompt.promptState).toMatchObject({
      sessionId: `task:${task.id}`,
      taskLineId: task.id,
      model: "gpt-5.1",
    });
    expect(redisCalls.map((call) => call.type)).toEqual(["prompt", "window"]);
    expect(redisCalls[0].state).toMatchObject({ sessionId: `task:${task.id}`, taskLineId: task.id });
  });

  it("completes the same turn and syncs mem0 and session windows", async () => {
    const { service, mem0Calls } = await makeService();
    const task = buildTask("launch product", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [task], stickers: [] });
    const boardMemory = buildAgentMemory(board);
    service.syncSessionsFromBoardMemory(boardMemory);

    const prepared = await service.prepareChat({
      sessionId: `task:${task.id}`,
      userText: "我今天该推进什么？",
      boardMemory,
      model: "gpt-5.1",
    });
    const view = await service.completeChat(prepared, {
      assistantText: "先做一个低成本验证。",
      model: "gpt-5.1",
      source: "openai",
    });

    expect(view.turns).toEqual([
      expect.objectContaining({
        turnId: prepared.turn.turnId,
        assistantText: "先做一个低成本验证。",
        source: "openai",
      }),
    ]);
    expect(view.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "turn_completed" }),
    ]));
    expect(mem0Calls.map((call) => call.url)).toEqual([
      "https://mem0.example/v1/memories/search",
      "https://mem0.example/v1/memories",
    ]);
  });
});
