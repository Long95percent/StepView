import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserGatewayApi } from "../src/browserGatewayApi.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (relative) => readFileSync(path.join(ROOT, "..", relative), "utf8");

/** preload 里所有 `方法: () => ipcRenderer.invoke("通道")`。 */
function preloadChannels(source) {
  return [...source.matchAll(/(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\("([^"]+)"/g)].map(([, method, channel]) => ({ method, channel }));
}

describe("settings channel parity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers every channel preload asks for", () => {
    const preload = read("electron/preload.js");
    const main = read("electron/main.js");
    const settingsChannels = preloadChannels(preload).filter(({ channel }) => channel.startsWith("settings:"));

    // 设置这一组必须三端齐全：preload 暴露、main 注册、浏览器客户端同名。
    // 少任何一端都会变成"桌面模式好好的、家庭模式 undefined is not a function"。
    expect(settingsChannels.map(({ method }) => method).sort()).toEqual(["importLegacySettings", "loadSettings", "saveSettings"]);
    for (const { channel } of settingsChannels) {
      expect(main, `main.js 没有注册 ${channel}`).toContain(`"${channel}"`);
    }
  });

  it("keeps the browser client's settings methods aligned with preload", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    vi.stubGlobal("window", { location: { protocol: "http:", hostname: "localhost" } });
    const browser = createBrowserGatewayApi();

    for (const method of ["loadSettings", "saveSettings", "importLegacySettings"]) {
      expect(typeof browser[method], `家庭模式客户端缺少 ${method}`).toBe("function");
    }
  });
});
