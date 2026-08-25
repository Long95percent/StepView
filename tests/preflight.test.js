import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDataDirectory, checkNodeVersion, checkPortAvailable, checkRedis } from "../electron/preflight.js";

describe("startup preflight", () => {
  let tempDir;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects unsupported Node versions", () => {
    expect(checkNodeVersion("20.19.0")).toMatchObject({ ok: false, name: "Node.js" });
    expect(checkNodeVersion("22.0.0")).toMatchObject({ ok: true, name: "Node.js" });
  });

  it("checks writable storage and SQLite support", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-preflight-"));
    await expect(checkDataDirectory(path.join(tempDir, "data"))).resolves.toMatchObject({ ok: true });
  });

  it("detects occupied ports", async () => {
    const net = await import("node:net");
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await expect(checkPortAvailable({ host: "127.0.0.1", port })).resolves.toMatchObject({ ok: false });
    await new Promise((resolve) => server.close(resolve));
  });

  it("requires Redis PING to return PONG", async () => {
    const passingClient = { command: async () => "PONG", close: async () => {} };
    const failingClient = { command: async () => { throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" }); }, close: async () => {} };
    await expect(checkRedis({ clientFactory: () => passingClient })).resolves.toMatchObject({ ok: true });
    await expect(checkRedis({ clientFactory: () => failingClient })).resolves.toMatchObject({ ok: false, detail: expect.stringContaining("ECONNREFUSED") });
  });
});
