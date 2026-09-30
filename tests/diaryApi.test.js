import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiaryIpcHandlers } from "../electron/diaryIpcHandlers.js";
import { createDiaryApi } from "../src/diary/diaryApi.js";
import { createBrowserGatewayApi } from "../src/browserGatewayApi.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/**
 * browserGatewayApi 用的是裸 localStorage / window（浏览器里有，Node 里没有），
 * 所以要先补上再构造它。
 */
function stubBrowserGlobals() {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  });
  vi.stubGlobal("window", { location: { protocol: "http:", hostname: "localhost" } });
}

/**
 * 从 preload 源码里读出日记通道的形状。
 *
 * 不直接 import preload.js：它在模块加载时就会调 contextBridge，Node 里跑不了。
 * 这是个结构性检查（"加了新通道但忘了另一端"），正则够用。
 */
function readPreloadDiaryChannels() {
  const source = readFileSync(path.join(ROOT, "../electron/preload.js"), "utf8");
  const block = /diary:\s*\{([\s\S]*?)\n  \},/.exec(source);
  if (!block) throw new Error("preload.js 里找不到 diary 命名空间");
  const entries = [...block[1].matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\("([^"]+)"/g)];
  return entries.map(([, method, channel]) => ({ method, channel }));
}

describe("diary api surface", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the preload namespace, the IPC channels and the browser client in step", () => {
    stubBrowserGlobals();
    const preload = readPreloadDiaryChannels();
    expect(preload.length).toBeGreaterThan(0);

    // 每个 invoke 的目标通道都必须真的注册过，否则桌面模式会挂在 "No handler registered"。
    const channels = createDiaryIpcHandlers({ getContext: () => ({}) });
    for (const { channel } of preload) {
      expect(Object.keys(channels), `preload 引用了未注册的通道 ${channel}`).toContain(channel);
    }

    // 家庭模式客户端必须提供同名同形的整套方法，否则会出现
    // "桌面模式好好的、家庭模式 undefined is not a function"。
    const browser = createBrowserGatewayApi().diary;
    expect(browser).toBeTruthy();
    for (const { method } of preload) {
      expect(typeof browser[method], `家庭模式客户端缺少 diary.${method}`).toBe("function");
    }
    expect(Object.keys(browser).sort()).toEqual(preload.map((entry) => entry.method).sort());

    // 界面唯一入口也要覆盖同一组方法。
    const viaApi = createDiaryApi({ diary: browser });
    expect(Object.keys(viaApi).sort()).toEqual(preload.map((entry) => entry.method).sort());
  });

  it("turns bare ids into the request objects the channel expects", async () => {
    const calls = [];
    const spy = (method) => (...args) => {
      calls.push([method, ...args]);
      return Promise.resolve({ method });
    };
    const api = createDiaryApi({
      diary: {
        list: spy("list"),
        get: spy("get"),
        create: spy("create"),
        update: spy("update"),
        trash: spy("trash"),
        restore: spy("restore"),
        remove: spy("remove"),
        search: spy("search"),
        timeline: spy("timeline"),
        listTags: spy("listTags"),
        listRevisions: spy("listRevisions"),
        listNodeEntries: spy("listNodeEntries"),
        listDailyDays: spy("listDailyDays"),
        previewNodeNotes: spy("previewNodeNotes"),
        importNodeNotes: spy("importNodeNotes"),
      },
    });

    await api.get("diary-1");
    await api.trash("diary-1");
    await api.restore("diary-1");
    await api.remove("diary-1");
    await api.listRevisions("diary-1", { limit: 5 });
    await api.listNodeEntries("node-1", { status: "all" });
    await api.listDailyDays("node-1");

    expect(calls).toEqual([
      ["get", { diaryId: "diary-1" }],
      ["trash", { diaryId: "diary-1" }],
      ["restore", { diaryId: "diary-1" }],
      ["remove", { diaryId: "diary-1" }],
      ["listRevisions", { diaryId: "diary-1", limit: 5 }],
      ["listNodeEntries", { nodeId: "node-1", status: "all" }],
      ["listDailyDays", { nodeId: "node-1" }],
    ]);
  });

  it("fails loudly when the running mode has no diary channel", () => {
    expect(() => createDiaryApi({})).toThrow(/没有提供日记通道/);
    expect(() => createDiaryApi(undefined)).toThrow(/没有提供日记通道/);
  });

  it("hits the same HTTP routes the server actually serves", async () => {
    stubBrowserGlobals();
    const requests = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      requests.push([options.method || "GET", new URL(url).pathname + new URL(url).search]);
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const { diary } = createBrowserGatewayApi();
    await diary.list({ status: "all" });
    await diary.get({ diaryId: "diary-1" });
    await diary.create({ content: "x" });
    await diary.update({ diaryId: "diary-1", content: "y", rev: 1 });
    await diary.trash({ diaryId: "diary-1" });
    await diary.restore({ diaryId: "diary-1" });
    await diary.remove({ diaryId: "diary-1" });
    await diary.search({ query: "重构" });
    await diary.timeline({ kind: "node" });
    await diary.listTags();
    await diary.listRevisions({ diaryId: "diary-1", limit: 3 });
    await diary.listNodeEntries({ nodeId: "node-1" });
    await diary.listDailyDays({ nodeId: "node-1" });
    await diary.previewNodeNotes();
    await diary.importNodeNotes({ confirm: true });

    expect(requests).toEqual([
      ["GET", "/api/diary?status=all"],
      ["GET", "/api/diary/diary-1"],
      ["POST", "/api/diary"],
      ["PUT", "/api/diary/diary-1"],
      ["DELETE", "/api/diary/diary-1"],
      ["POST", "/api/diary/diary-1/restore"],
      ["DELETE", "/api/diary/diary-1?purge=1"],
      ["GET", "/api/diary/search?q=%E9%87%8D%E6%9E%84"],
      ["GET", "/api/diary/timeline?kind=node"],
      ["GET", "/api/diary/tags"],
      ["GET", "/api/diary/diary-1/revisions?limit=3"],
      ["GET", "/api/diary?kind=node&targetType=node&targetId=node-1"],
      ["GET", "/api/diary/days?nodeId=node-1"],
      ["GET", "/api/diary/import-node-notes"],
      ["POST", "/api/diary/import-node-notes"],
    ]);
  });
});
