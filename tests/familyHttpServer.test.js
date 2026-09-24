import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFamilyHttpServer } from "../electron/gateway/familyHttpServer.js";
import { createAccountContext } from "../electron/gateway/accountContext.js";
import { buildTask } from "../src/progressCore.js";

describe("family HTTP gateway", () => {
  let tempDir;
  let gateway;

  afterEach(async () => {
    await gateway?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("authenticates browser sessions and isolates concurrent account boards", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-http-"));
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1 },
      dataDir: tempDir,
      accountContextFactory: (options) => createAccountContext({
        ...options,
        redisCacheFactory: () => ({
          savePromptState: async () => {},
          saveWindowState: async () => {},
          loadPromptState: async () => null,
          loadWindowState: async () => null,
          close: async () => {},
        }),
      }),
      openAiStream: async ({ onDelta }) => {
        onDelta("你好");
        onDelta("，一起继续。");
        return { text: "你好，一起继续。", model: "test-model" };
      },
    });
    const address = await gateway.listen();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    async function register(username) {
      const response = await fetch(`${baseUrl}/accounts/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "password-1" }),
      });
      expect(response.status).toBe(201);
      return response.json();
    }

    const alice = await register("alice");
    const bob = await register("bob");
    const aliceHeaders = { Authorization: `Bearer ${alice.sessionId}`, "Content-Type": "application/json" };
    const bobHeaders = { Authorization: `Bearer ${bob.sessionId}`, "Content-Type": "application/json" };

    await fetch(`${baseUrl}/board`, { method: "PUT", headers: aliceHeaders, body: JSON.stringify({ tasks: [{ id: "alice-task" }] }) });
    await fetch(`${baseUrl}/board`, { method: "PUT", headers: bobHeaders, body: JSON.stringify({ tasks: [{ id: "bob-task" }] }) });

    await expect(fetch(`${baseUrl}/board`, { headers: aliceHeaders }).then((response) => response.json())).resolves.toMatchObject({ tasks: [{ id: "alice-task" }] });
    await expect(fetch(`${baseUrl}/board`, { headers: bobHeaders }).then((response) => response.json())).resolves.toMatchObject({ tasks: [{ id: "bob-task" }] });
    expect((await fetch(`${baseUrl}/board`)).status).toBe(401);

    const task = buildTask("家庭计划", { x: 500, y: 300 });
    await fetch(`${baseUrl}/board`, { method: "PUT", headers: aliceHeaders, body: JSON.stringify({ tasks: [task] }) });
    const streamResponse = await fetch(`${baseUrl}/agent/chat/stream`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ sessionId: `task:${task.id}`, userText: "下一步做什么？", apiKey: "test-key" }),
    });
    const events = await streamResponse.text();
    expect(streamResponse.status, events).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(events).toContain('"type":"delta","delta":"你好"');
    expect(events).toContain('"type":"complete"');
    expect(events).toContain('"text":"你好，一起继续。"');
  });

  it("stages agent board changes for review and applies them only after approval", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-approvals-"));
    const state = {};
    let capturedToolNames = [];
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1 },
      dataDir: tempDir,
      accountContextFactory: (options) => createAccountContext({
        ...options,
        redisCacheFactory: () => ({
          savePromptState: async () => {},
          saveWindowState: async () => {},
          loadPromptState: async () => null,
          loadWindowState: async () => null,
          close: async () => {},
        }),
      }),
      openAiComplete: async ({ tools, runTool }) => {
        capturedToolNames = (tools || []).map((tool) => tool.function.name);
        state.proposal = await runTool("board.propose_change", { operation: "task.rename", reason: "更贴合目标", taskId: state.taskId, title: "家庭新目标" });
        return { text: "已经准备好修改。", model: "test-model" };
      },
    });
    const address = await gateway.listen();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const jsonHeaders = { "Content-Type": "application/json" };

    const registration = await fetch(`${baseUrl}/accounts/register`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ username: "carol", password: "password-1" }) }).then((response) => response.json());
    const headers = { Authorization: `Bearer ${registration.sessionId}`, ...jsonHeaders };

    const task = buildTask("家庭计划", { x: 400, y: 200 });
    state.taskId = task.id;
    await fetch(`${baseUrl}/board`, { method: "PUT", headers, body: JSON.stringify({ tasks: [task] }) });

    const chat = await fetch(`${baseUrl}/agent/chat`, { method: "POST", headers, body: JSON.stringify({ sessionId: `task:${task.id}`, userText: "改个名字", apiKey: "test-key" }) });
    expect(chat.status).toBe(200);
    expect(capturedToolNames).toContain("board.propose_change");
    expect(state.proposal).toMatchObject({ type: "board_change", operation: "task.rename" });
    expect(state.proposal.diff.lines).toContain("任务线重命名「家庭计划」→「家庭新目标」");

    const boardAfterChat = await fetch(`${baseUrl}/board`, { headers }).then((response) => response.json());
    expect(boardAfterChat.tasks[0].title).toBe("家庭计划");

    const pending = await fetch(`${baseUrl}/agent/approvals`, { headers }).then((response) => response.json());
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: "board_change", status: "pending", reason: "更贴合目标" });

    const decided = await fetch(`${baseUrl}/agent/approvals/decide`, { method: "POST", headers, body: JSON.stringify({ approvalId: pending[0].approvalId, decision: "approved" }) }).then((response) => response.json());
    expect(decided.approval.status).toBe("approved");

    const boardAfterApproval = await fetch(`${baseUrl}/board`, { headers }).then((response) => response.json());
    expect(boardAfterApproval.tasks[0].title).toBe("家庭新目标");
    expect(await fetch(`${baseUrl}/agent/approvals`, { headers }).then((response) => response.json())).toHaveLength(0);
  });
  it("exposes the diary over HTTP with the same isolation as the board", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-diary-"));
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1 },
      dataDir: tempDir,
      accountContextFactory: (options) => createAccountContext({
        ...options,
        redisCacheFactory: () => ({
          savePromptState: async () => {},
          saveWindowState: async () => {},
          loadPromptState: async () => null,
          loadWindowState: async () => null,
          close: async () => {},
        }),
      }),
    });
    const address = await gateway.listen();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;
    const jsonHeaders = { "Content-Type": "application/json" };

    async function register(username) {
      const response = await fetch(`${baseUrl}/accounts/register`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ username, password: "password-1" }) });
      expect(response.status).toBe(201);
      const body = await response.json();
      return { Authorization: `Bearer ${body.sessionId}`, ...jsonHeaders };
    }

    const alice = await register("dana");
    const bob = await register("erin");

    expect((await fetch(`${baseUrl}/diary`)).status).toBe(401);
    await expect(fetch(`${baseUrl}/diary`, { headers: alice }).then((response) => response.json())).resolves.toEqual([]);

    const created = await fetch(`${baseUrl}/diary`, {
      method: "POST",
      headers: alice,
      body: JSON.stringify({ title: "家庭日记", content: "今天一起做了数据库重构", timezone: "Asia/Shanghai", tags: ["家庭"], links: [{ targetType: "node", targetId: "node-1", role: "primary" }] }),
    }).then((response) => response.json());
    expect(created).toMatchObject({ rev: 1, status: "active", title: "家庭日记" });

    expect(await fetch(`${baseUrl}/diary`, { headers: alice }).then((response) => response.json())).toHaveLength(1);
    expect(await fetch(`${baseUrl}/diary`, { headers: bob }).then((response) => response.json())).toHaveLength(0);
    expect((await fetch(`${baseUrl}/diary/${created.diaryId}`, { headers: bob })).status).toBe(404);

    const detail = await fetch(`${baseUrl}/diary/${created.diaryId}`, { headers: alice }).then((response) => response.json());
    expect(detail.links).toHaveLength(1);
    await expect(fetch(`${baseUrl}/diary/search?q=数据库重构`, { headers: alice }).then((response) => response.json())).resolves.toHaveLength(1);
    await expect(fetch(`${baseUrl}/diary/tags`, { headers: alice }).then((response) => response.json())).resolves.toEqual([{ name: "家庭", count: 1 }]);
    await expect(fetch(`${baseUrl}/diary/timeline`, { headers: alice }).then((response) => response.json())).resolves.toHaveLength(1);

    const updated = await fetch(`${baseUrl}/diary/${created.diaryId}`, { method: "PUT", headers: alice, body: JSON.stringify({ content: "改过的正文", rev: created.rev }) }).then((response) => response.json());
    expect(updated).toMatchObject({ rev: 2, content: "改过的正文" });
    // 版本对不上是"和当前状态冲突"，不是服务端错误。
    const conflict = await fetch(`${baseUrl}/diary/${created.diaryId}`, { method: "PUT", headers: alice, body: JSON.stringify({ content: "抢写", rev: created.rev }) });
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error).toContain("已经被改过");

    const board = { tasks: [{ id: "task-9", title: "家庭任务", nodes: [{ id: "node-9", title: "备注", detail: "写在节点上的话" }] }] };
    await fetch(`${baseUrl}/board`, { method: "PUT", headers: alice, body: JSON.stringify(board) });
    const preview = await fetch(`${baseUrl}/diary/import-node-notes`, { headers: alice }).then((response) => response.json());
    expect(preview).toEqual([expect.objectContaining({ nodeId: "node-9", alreadyImported: false })]);

    const imported = await fetch(`${baseUrl}/diary/import-node-notes`, { method: "POST", headers: alice, body: JSON.stringify({ confirm: true, timezone: "Asia/Shanghai" }) }).then((response) => response.json());
    expect(imported).toMatchObject({ confirmed: true, created: 1 });
    // 导入只读画布：节点标题和备注原文一个字都不动。
    const boardAfterImport = await fetch(`${baseUrl}/board`, { headers: alice }).then((response) => response.json());
    expect(boardAfterImport.tasks[0].nodes[0]).toMatchObject({ id: "node-9", title: "备注", detail: "写在节点上的话" });
    expect(await fetch(`${baseUrl}/diary`, { headers: alice }).then((response) => response.json())).toHaveLength(2);
    expect(await fetch(`${baseUrl}/diary/import-node-notes`, { method: "POST", headers: alice, body: JSON.stringify({ confirm: true }) }).then((response) => response.json())).toMatchObject({ created: 0, skipped: 1 });

    const trashed = await fetch(`${baseUrl}/diary/${created.diaryId}`, { method: "DELETE", headers: alice }).then((response) => response.json());
    expect(trashed).toMatchObject({ status: "trashed" });
    expect(await fetch(`${baseUrl}/diary`, { headers: alice }).then((response) => response.json())).toHaveLength(1);
    const purged = await fetch(`${baseUrl}/diary/${created.diaryId}?purge=1`, { method: "DELETE", headers: alice }).then((response) => response.json());
    expect(purged).toEqual({ ok: true, diaryId: created.diaryId });
  });
  it("stages agent diary entries in the shared approval queue", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-diary-approval-"));
    let proposal = null;
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1 },
      dataDir: tempDir,
      accountContextFactory: (options) => createAccountContext({
        ...options,
        redisCacheFactory: () => ({
          savePromptState: async () => {},
          saveWindowState: async () => {},
          loadPromptState: async () => null,
          loadWindowState: async () => null,
          close: async () => {},
        }),
      }),
      openAiComplete: async ({ runTool }) => {
        proposal = await runTool("diary.propose_entry", { title: "Agent 写的日记", content: "今天把日记接进了审批队列", reason: "值得留档" });
        return { text: "已经准备好一条日记。", model: "test-model" };
      },
    });
    const address = await gateway.listen();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const registration = await fetch(`${baseUrl}/accounts/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "frank", password: "password-1" }) }).then((response) => response.json());
    const headers = { Authorization: `Bearer ${registration.sessionId}`, "Content-Type": "application/json" };

    const task = buildTask("日记测试任务", { x: 300, y: 300 });
    await fetch(`${baseUrl}/board`, { method: "PUT", headers, body: JSON.stringify({ tasks: [task] }) });

    const chat = await fetch(`${baseUrl}/agent/chat`, { method: "POST", headers, body: JSON.stringify({ sessionId: `task:${task.id}`, userText: "帮我记一笔", apiKey: "test-key" }) });
    expect(chat.status, await chat.text()).toBe(200);
    expect(proposal).toMatchObject({ type: "diary_change", operation: "diary.create" });
    expect(await fetch(`${baseUrl}/diary`, { headers }).then((response) => response.json())).toHaveLength(0);

    const pending = await fetch(`${baseUrl}/agent/approvals`, { headers }).then((response) => response.json());
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: "diary_change", status: "pending", operation: "diary.create", reason: "值得留档" });

    const decided = await fetch(`${baseUrl}/agent/approvals/decide`, { method: "POST", headers, body: JSON.stringify({ approvalId: pending[0].approvalId, decision: "approved" }) }).then((response) => response.json());
    expect(decided.approval.status).toBe("approved");
    await expect(fetch(`${baseUrl}/agent/approvals`, { headers }).then((response) => response.json())).resolves.toEqual([]);
    await expect(fetch(`${baseUrl}/diary`, { headers }).then((response) => response.json())).resolves.toEqual([
      expect.objectContaining({ title: "Agent 写的日记", content: "今天把日记接进了审批队列", source: "agent" }),
    ]);
  });
});
