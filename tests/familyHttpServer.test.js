import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFamilyHttpServer } from "../electron/gateway/familyHttpServer.js";
import { createAccountContext } from "../electron/gateway/accountContext.js";
import { createAccountStore } from "../electron/gateway/accountStore.js";
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
    const conflictBody = await conflict.json();
    expect(conflictBody.error).toContain("已经被改过");
    // 带上 code，界面才不用去比对中文句子来判断该不该"重新载入"。
    expect(conflictBody.code).toBe("DIARY_REVISION_CONFLICT");

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
    // 家庭模式以前只有丢掉和彻底删除，没有"还原"这个入口。
    const restored = await fetch(`${baseUrl}/diary/${created.diaryId}/restore`, { method: "POST", headers: alice }).then((response) => response.json());
    expect(restored).toMatchObject({ status: "active", deletedAt: null });
    await fetch(`${baseUrl}/diary/${created.diaryId}`, { method: "DELETE", headers: alice });
    const purged = await fetch(`${baseUrl}/diary/${created.diaryId}?purge=1`, { method: "DELETE", headers: alice }).then((response) => response.json());
    expect(purged).toEqual({ ok: true, diaryId: created.diaryId });
  });

  it("serves a node's own entries and its day buttons over HTTP", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-diary-node-"));
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

    const registered = await fetch(`${baseUrl}/accounts/register`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ username: "gina", password: "password-1" }) }).then((response) => response.json());
    const headers = { Authorization: `Bearer ${registered.sessionId}`, ...jsonHeaders };
    const post = (body) => fetch(`${baseUrl}/diary`, { method: "POST", headers, body: JSON.stringify(body) }).then((response) => response.json());
    const get = (path) => fetch(`${baseUrl}${path}`, { headers }).then((response) => response.json());

    // 节点日记必须挂在节点上：HTTP 上也要是 400 + 可判别的 code，而不是 500。
    // 这里拿到的是 diaryCore 的 DIARY_INPUT_INVALID——它是第一道防线；
    // 仓储的 DIARY_NODE_LINK_REQUIRED 只在绕过 normalizeDiaryInput 时才会露头（见仓储单测）。
    const rejected = await fetch(`${baseUrl}/diary`, { method: "POST", headers, body: JSON.stringify({ content: "没有归属", kind: "node" }) });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).code).toBe("DIARY_INPUT_INVALID");

    const nodeDiary = await post({ content: "节点上的实现细节", kind: "node", links: [{ targetType: "node", targetId: "node-1", role: "primary" }] });
    expect(nodeDiary.kind).toBe("node");
    await post({ content: "周六", occurredAt: "2026-09-19T02:00:00.000Z", kind: "daily", links: [{ targetType: "node", targetId: "node-1" }] });
    await post({ content: "周六补记", occurredAt: "2026-09-19T09:00:00.000Z", kind: "daily", links: [{ targetType: "node", targetId: "node-1" }] });
    await post({ content: "周日", occurredAt: "2026-09-20T02:00:00.000Z", kind: "daily", links: [{ targetType: "node", targetId: "node-1" }] });
    await post({ content: "没关联任何节点", occurredAt: "2026-09-19T02:00:00.000Z", kind: "daily" });

    expect(await get("/diary?kind=node")).toHaveLength(1);
    expect(await get("/diary?kind=daily")).toHaveLength(4);
    // 节点上的原生日记
    expect((await get("/diary?kind=node&targetType=node&targetId=node-1")).map((item) => item.diaryId)).toEqual([nodeDiary.diaryId]);
    // 节点上的日期按钮：按天去重、倒序、带条数
    expect(await get("/diary/days?nodeId=node-1")).toEqual([
      { day: "2026-09-20", count: 1 },
      { day: "2026-09-19", count: 2 },
    ]);
    expect(await get("/diary/days?nodeId=node-unknown")).toEqual([]);
    // "/diary/days" 不能被当成一条日记的 id（否则会变成 404）
    expect((await fetch(`${baseUrl}/diary/days`, { headers })).status).toBe(200);
    expect(await get(`/diary/${nodeDiary.diaryId}/revisions`)).toHaveLength(1);
    expect(await get("/diary/timeline?kind=node")).toHaveLength(1);
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

  it("carries kind and nodeIds through an agent node-diary proposal all the way to the node's native list", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-node-diary-"));
    let proposal = null;
    let firstNodeId = null;
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
        // kind / nodeIds 是 Agent 传进来的，中间隔着一层 schema 校验，很容易被静默丢掉。
        proposal = await runTool("diary.propose_entry", {
          kind: "node",
          title: "Agent 写的节点日记",
          content: "这条是从 Agent 提过来的",
          nodeIds: [firstNodeId],
          reason: "节点上值得留一笔",
        });
        return { text: "已经准备好一条节点日记。", model: "test-model" };
      },
    });
    const address = await gateway.listen();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    const registration = await fetch(`${baseUrl}/accounts/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "heidi", password: "password-1" }) }).then((response) => response.json());
    const headers = { Authorization: `Bearer ${registration.sessionId}`, "Content-Type": "application/json" };

    const task = buildTask("节点日记任务", { x: 300, y: 300 });
    firstNodeId = task.nodes[0].id;
    await fetch(`${baseUrl}/board`, { method: "PUT", headers, body: JSON.stringify({ tasks: [task] }) });

    const chat = await fetch(`${baseUrl}/agent/chat`, { method: "POST", headers, body: JSON.stringify({ sessionId: `task:${task.id}`, userText: "帮我记一笔", apiKey: "test-key" }) });
    expect(chat.status, await chat.text()).toBe(200);
    // 提案摘要不该把 daily / node 这种内部词摆给用户看。
    expect(proposal).toMatchObject({ type: "diary_change", operation: "diary.create", summary: "新增节点日记「Agent 写的节点日记」" });
    expect(proposal.entry).toMatchObject({ kind: "node" });

    const pending = await fetch(`${baseUrl}/agent/approvals`, { headers }).then((response) => response.json());
    await fetch(`${baseUrl}/agent/approvals/decide`, { method: "POST", headers, body: JSON.stringify({ approvalId: pending[0].approvalId, decision: "approved" }) });

    // 批准之后它得真的落在该节点的原生日记里，而不是变成一条每日日记。
    const nodeEntries = await fetch(`${baseUrl}/diary?kind=node&targetType=node&targetId=${encodeURIComponent(firstNodeId)}`, { headers }).then((response) => response.json());
    expect(nodeEntries).toEqual([expect.objectContaining({ title: "Agent 写的节点日记", kind: "node", source: "agent" })]);

    const timeline = await fetch(`${baseUrl}/diary/timeline`, { headers }).then((response) => response.json());
    expect(timeline).toEqual([expect.objectContaining({ title: "Agent 写的节点日记", kind: "node" })]);
  });

  it("sends no CORS headers unless the origin is explicitly allowed", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-cors-"));
    gateway = createFamilyHttpServer({
      // 默认没有白名单：同源部署下浏览器不发跨域请求，就不该有任何 CORS 头。
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

    // 老版本会把请求里的 Origin 原样反射回去，等于谁问都答"你能读我"。
    const preflight = await fetch(`${baseUrl}/diary/anything`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "DELETE" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(null);
    expect(preflight.headers.get("access-control-allow-methods")).toBe(null);

    const health = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://evil.example" } });
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe(null);
  });

  it("keeps settings inside the account that saved them", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-settings-"));
    let seenApiKey = null;
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1, secretKey: "test-secret-key-0123456789" },
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
      openAiComplete: async ({ apiKey }) => {
        seenApiKey = apiKey;
        return { text: "好的。", model: "test-model" };
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
      return { Authorization: `Bearer ${(await response.json()).sessionId}`, "Content-Type": "application/json" };
    }

    const alice = await register("alice-keys");
    const bob = await register("bob-keys");

    await fetch(`${baseUrl}/settings`, { method: "PUT", headers: alice, body: JSON.stringify({ openaiApiKey: "sk-alice-secret-1234", agentModel: "gpt-5.2" }) });

    const aliceView = await fetch(`${baseUrl}/settings`, { headers: alice }).then((response) => response.json());
    expect(aliceView).toMatchObject({ hasOpenAiKey: true, openaiApiKeyHint: "…1234", agentModel: "gpt-5.2" });
    // 关键：响应体里绝不能出现明文 Key。
    expect(JSON.stringify(aliceView)).not.toContain("sk-alice-secret-1234");
    expect(aliceView.openaiApiKey).toBeUndefined();

    const bobView = await fetch(`${baseUrl}/settings`, { headers: bob }).then((response) => response.json());
    expect(bobView).toMatchObject({ hasOpenAiKey: false, openaiApiKeyHint: "" });
    expect(JSON.stringify(bobView)).not.toContain("sk-alice-secret");
    // 连 agentModel 也不该串（以前这两个是从同一张全局表读的）。
    expect(bobView.agentModel).not.toBe("gpt-5.2");

    // 界面上拿不到明文 Key，所以请求里不带 apiKey 是正常路径：服务端要用账号里存的那把。
    const task = buildTask("设置隔离任务", { x: 100, y: 100 });
    await fetch(`${baseUrl}/board`, { method: "PUT", headers: alice, body: JSON.stringify({ tasks: [task] }) });
    const chat = await fetch(`${baseUrl}/agent/chat`, {
      method: "POST",
      headers: alice,
      body: JSON.stringify({ sessionId: `task:${task.id}`, userText: "在吗" }),
    });
    expect(chat.status, await chat.text()).toBe(200);
    expect(seenApiKey).toBe("sk-alice-secret-1234");
  });

  it("lets only the owner claim the legacy global settings", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-legacy-"));
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1, secretKey: "test-secret-key-0123456789" },
      dataDir: tempDir,
      // 老版本把设置写在全局表里（只有 key、没有 account_id）。这里手动放一份进去复现那个状态。
      accountStoreFactory: (options) => {
        const store = createAccountStore(options);
        store.setSetting("openaiApiKey", "sk-legacy-global-key-9999");
        return store;
      },
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

    async function register(username) {
      const response = await fetch(`${baseUrl}/accounts/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "password-1" }),
      });
      expect(response.status).toBe(201);
      return { Authorization: `Bearer ${(await response.json()).sessionId}`, "Content-Type": "application/json" };
    }

    const owner = await register("legacy-owner");
    const member = await register("legacy-member");

    // owner 暂时靠老数据活着：界面必须说"已配置"，否则他会以为 Key 丢了去重填一遍。
    const ownerView = await fetch(`${baseUrl}/settings`, { headers: owner }).then((response) => response.json());
    expect(ownerView).toMatchObject({ hasOpenAiKey: true, legacyGlobalSettingsAvailable: true });
    expect(JSON.stringify(ownerView)).not.toContain("sk-legacy-global-key");

    // 别人既看不到、也不该被告知"有这么一份"。
    const memberView = await fetch(`${baseUrl}/settings`, { headers: member }).then((response) => response.json());
    expect(memberView).toMatchObject({ hasOpenAiKey: false, legacyGlobalSettingsAvailable: false });
    expect(JSON.stringify(memberView)).not.toContain("sk-legacy");

    const forbidden = await fetch(`${baseUrl}/settings/import-legacy`, { method: "POST", headers: member });
    expect(forbidden.status).toBe(403);

    const imported = await fetch(`${baseUrl}/settings/import-legacy`, { method: "POST", headers: owner }).then((response) => response.json());
    expect(imported.imported).toContain("openaiApiKey");
    expect(imported.settings).toMatchObject({ hasOpenAiKey: true, legacyGlobalSettingsAvailable: false });
    // 认领之后老的那行要被清掉，全局表里不再留着明文。
    expect(JSON.stringify(imported)).not.toContain("sk-legacy-global-key");

    const afterClaim = await fetch(`${baseUrl}/settings`, { headers: owner }).then((response) => response.json());
    expect(afterClaim).toMatchObject({ hasOpenAiKey: true, legacyGlobalSettingsAvailable: false });
  });

  it("accepts the browser preflight for DELETE so entries can be trashed and purged", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-delete-"));
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-delete-"));
    gateway = createFamilyHttpServer({
      // 这条用例专门验"跨源时预检有没有放行 DELETE"，所以显式开一个白名单。
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1, allowedOrigins: ["http://localhost:5173"] },
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

    const registration = await fetch(`${baseUrl}/accounts/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "grace", password: "password-1" }) }).then((response) => response.json());
    const headers = { Authorization: `Bearer ${registration.sessionId}`, "Content-Type": "application/json" };

    // 浏览器的预检只认这张方法表。漏了 DELETE，"删除"会变成 "Failed to fetch"，
    // 而且请求根本到不了服务端 —— 这种失败在 Node 侧直接发请求是测不出来的。
    const preflight = await fetch(`${baseUrl}/diary/anything`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "DELETE", "Access-Control-Request-Headers": "authorization,content-type" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");

    const created = await fetch(`${baseUrl}/diary`, { method: "POST", headers, body: JSON.stringify({ content: "先删到回收站，再彻底删掉" }) }).then((response) => response.json());

    const trashed = await fetch(`${baseUrl}/diary/${created.diaryId}`, { method: "DELETE", headers });
    const trashedBody = await trashed.json();
    expect(trashed.status).toBe(200);
    expect(trashedBody).toMatchObject({ diaryId: created.diaryId, status: "trashed" });
    expect(await fetch(`${baseUrl}/diary/${created.diaryId}`, { headers }).then((response) => response.json())).toMatchObject({ status: "trashed" });

    const purged = await fetch(`${baseUrl}/diary/${created.diaryId}?purge=1`, { method: "DELETE", headers });
    const purgedBody = await purged.json();
    expect(purged.status).toBe(200);
    expect(purgedBody).toEqual({ ok: true, diaryId: created.diaryId });
    // 彻底删除是真的删行（回收站里也不该再留着）。
    expect(await fetch(`${baseUrl}/diary/${created.diaryId}`, { headers }).then((response) => response.status)).toBe(404);
    expect(await fetch(`${baseUrl}/diary`, { headers }).then((response) => response.json())).toEqual([]);
  });
});
