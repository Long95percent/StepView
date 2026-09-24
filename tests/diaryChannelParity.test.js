import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountContext } from "../electron/gateway/accountContext.js";
import { createFamilyHttpServer } from "../electron/gateway/familyHttpServer.js";
import { createDiaryIpcHandlers } from "../electron/diaryIpcHandlers.js";

/**
 * 桌面模式走 IPC、家庭模式走 HTTP，两条通道必须给出同样的结果。
 *
 * 两边共用同一个 diaryService，所以业务规则本来就一致；真正会漂移的是**参数搬运**——
 * 比如 IPC 收 `{ diaryId }` 而 HTTP 从路径里取 id、一边默认 `status=active` 另一边没默认。
 * 这个文件就是拿同一组动作分别打两条通道，对拍返回结构和错误码。
 *
 * 为了不违反"同一进程里不要对同一个账号库开两个写连接"，两条通道共用同一个 context。
 */
describe("diary channel parity (IPC vs HTTP)", () => {
  let tempDir;
  let gateway;
  let context;
  let headers;
  let baseUrl;
  let ipc;

  afterEach(async () => {
    await gateway?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function start() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-diary-parity-"));
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1 },
      dataDir: tempDir,
      accountContextFactory: (options) => {
        context = createAccountContext({
          ...options,
          redisCacheFactory: () => ({
            savePromptState: async () => {},
            saveWindowState: async () => {},
            loadPromptState: async () => null,
            loadWindowState: async () => null,
            close: async () => {},
          }),
        });
        return context;
      },
    });
    const address = await gateway.listen();
    baseUrl = `http://127.0.0.1:${address.port}/api`;

    const registered = await fetch(`${baseUrl}/accounts/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "parity", password: "password-1" }),
    }).then((response) => response.json());
    headers = { Authorization: `Bearer ${registered.sessionId}`, "Content-Type": "application/json" };

    ipc = createDiaryIpcHandlers({ getContext: () => context });
  }

  /** 两条通道的统一结果形状：成功给出 body，失败给出 status + code。 */
  async function callHttp(pathname, options = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, { headers, ...options });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, code: body?.code ?? null, body };
  }

  async function callIpc(channel, payload) {
    try {
      const body = await ipc[channel]({}, payload);
      return { ok: true, status: 200, code: null, body };
    } catch (error) {
      return { ok: false, status: error.statusCode ?? 500, code: error.code ?? null, body: { error: error.message } };
    }
  }

  it("answers every read path identically", async () => {
    await start();
    const created = await callHttp("/diary", {
      method: "POST",
      body: JSON.stringify({ title: "对拍", content: "两条通道应当一致", occurredAt: "2026-09-24T02:00:00.000Z", tags: ["对拍"] }),
    });
    const diaryId = created.body.diaryId;

    const pairs = [
      ["/diary", "diary:list", {}],
      ["/diary?kind=daily", "diary:list", { kind: "daily" }],
      ["/diary?status=all", "diary:list", { status: "all" }],
      [`/diary/${diaryId}`, "diary:get", { diaryId }],
      ["/diary/search?q=%E4%B8%A4%E6%9D%A1", "diary:search", { query: "两条" }],
      ["/diary/timeline", "diary:timeline", {}],
      ["/diary/tags", "diary:tags", undefined],
      [`/diary/${diaryId}/revisions`, "diary:list-revisions", { diaryId }],
      ["/diary/days?nodeId=node-1", "diary:list-daily-days", { nodeId: "node-1" }],
      ["/diary?kind=node&targetType=node&targetId=node-1", "diary:list-node-entries", { nodeId: "node-1" }],
    ];

    for (const [pathname, channel, payload] of pairs) {
      const overHttp = await callHttp(pathname);
      const overIpc = await callIpc(channel, payload);
      expect(overHttp.ok, `${channel} 应当成功`).toBe(true);
      expect(overIpc.ok, `${channel} 应当成功`).toBe(true);
      // 同一条数据、同一个 service，返回体必须逐字段一致（不是"差不多"）。
      expect(overIpc.body, `${channel} 的返回体应当一致`).toEqual(overHttp.body);
    }
  });

  it("writes through either channel and sees the same thing", async () => {
    await start();

    // 同一份输入分别走两条通道：除了各自生成的 id 与时间戳，记录形状必须逐字段一致。
    // 唯一允许的差别是"HTTP 有状态码、IPC 没有"，所以 201 对 200。
    const input = { title: "两条通道", content: "同一份输入", occurredAt: "2026-09-24T02:00:00.000Z", tags: ["对拍"] };
    const overHttp = await callHttp("/diary", { method: "POST", body: JSON.stringify(input) });
    const overIpc = await callIpc("diary:create", input);

    expect(overHttp.status).toBe(201);
    expect(overIpc.status).toBe(200);
    const withoutGenerated = (entry) => ({ ...entry, diaryId: null, createdAt: null, updatedAt: null });
    expect(withoutGenerated(overIpc.body)).toEqual(withoutGenerated(overHttp.body));
    expect(overHttp.body.diaryId).not.toBe(overIpc.body.diaryId);

    // 两条通道读到的是同一份数据。两条记录 occurred_at 相同，排序退化到 id，
    // 所以这里比集合而不是比顺序。
    const viaHttp = await callHttp("/diary?status=all");
    const viaIpc = await callIpc("diary:list", { status: "all" });
    expect(viaHttp.body.map((item) => item.diaryId).sort()).toEqual([overHttp.body.diaryId, overIpc.body.diaryId].sort());
    expect(viaIpc.body).toEqual(viaHttp.body);

    // 一条通道改，另一条通道立刻看到。
    await callIpc("diary:update", { diaryId: overHttp.body.diaryId, content: "IPC 改过的内容", rev: overHttp.body.rev });
    const reread = await callHttp(`/diary/${overHttp.body.diaryId}`);
    expect(reread.body).toMatchObject({ rev: 2, content: "IPC 改过的内容" });

    // 丢进回收站 / 还原也一致。
    expect((await callHttp(`/diary/${overHttp.body.diaryId}`, { method: "DELETE" })).body).toMatchObject({ status: "trashed" });
    expect((await callIpc("diary:restore", { diaryId: overHttp.body.diaryId })).body).toMatchObject({ status: "active" });
    expect((await callIpc("diary:list", {})).body.map((item) => item.diaryId)).toContain(overHttp.body.diaryId);
  });

  it("reports the same status and code for the same failure", async () => {
    await start();
    const created = await callHttp("/diary", { method: "POST", body: JSON.stringify({ content: "第一版" }) });
    const diaryId = created.body.diaryId;
    await callHttp(`/diary/${diaryId}`, { method: "PUT", body: JSON.stringify({ content: "第二版", rev: created.body.rev }) });

    const failures = [
      {
        what: "找不到这条日记",
        expectedStatus: 404,
        http: { path: "/diary/diary-missing" },
        ipc: ["diary:get", { diaryId: "diary-missing" }],
      },
      {
        what: "乐观锁撞车",
        expectedStatus: 409,
        http: { path: `/diary/${diaryId}`, method: "PUT", body: { content: "抢写", rev: 1 } },
        ipc: ["diary:update", { diaryId, content: "抢写", rev: 1 }],
      },
      {
        what: "节点日记没有节点关联",
        expectedStatus: 400,
        http: { path: "/diary", method: "POST", body: { content: "没有归属", kind: "node" } },
        ipc: ["diary:create", { content: "没有归属", kind: "node" }],
      },
    ];

    for (const { what, expectedStatus, http, ipc: [channel, payload] } of failures) {
      const overHttp = await callHttp(http.path, { method: http.method, body: http.body ? JSON.stringify(http.body) : undefined });
      const overIpc = await callIpc(channel, payload);

      expect(overHttp.ok, `${what}：HTTP 应当失败`).toBe(false);
      expect(overIpc.ok, `${what}：IPC 应当失败`).toBe(false);
      expect(overHttp.status, `${what}：HTTP 状态码`).toBe(expectedStatus);
      expect(overIpc.status, `${what}：IPC statusCode`).toBe(expectedStatus);
      // 错误码一致，界面才能用同一段逻辑处理两条通道。
      expect(overIpc.code, `${what}：错误码`).toBe(overHttp.code);
      expect(overIpc.code, `${what}：应当带上可判别的错误码`).toBeTruthy();
    }
  });
});
