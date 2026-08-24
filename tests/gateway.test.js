import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "../electron/gateway/createGateway.js";

describe("local gateway", () => {
  let tempDir;
  let gateway;

  afterEach(async () => {
    await gateway?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps personal mode on the app data directory", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-gateway-"));
    gateway = createGateway({ config: { mode: "personal", gateway: "local", dataDir: "" }, appDataDir: tempDir });
    await gateway.initialize();
    expect(gateway.getMode()).toBe("personal");
    expect(gateway.getCurrentAccount()).toMatchObject({ accountId: "local-personal" });
    expect(gateway.getContext().dataDir).toBe(tempDir);
    await expect(gateway.loadBoard()).resolves.toMatchObject({ tasks: [], stickers: [], links: [] });
  });

  it("isolates family account boards and rejects business access after logout", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-gateway-family-"));
    gateway = createGateway({
      config: { mode: "family", gateway: "local", dataDir: "", allowRegistration: true, sessionTtlHours: 1 },
      appDataDir: tempDir,
    });
    await gateway.initialize();
    const alice = await gateway.registerAccount({ username: "alice", password: "password-1" });
    await gateway.saveBoard({ tasks: [{ id: "alice-task" }] });
    await gateway.logout();
    const bob = await gateway.registerAccount({ username: "bob", password: "password-2" });
    expect(bob.accountId).not.toBe(alice.accountId);
    await expect(gateway.loadBoard()).resolves.toMatchObject({ tasks: [] });
    await gateway.logout();
    await expect(gateway.loadBoard()).rejects.toThrow("No active gateway account");
  });

  it("invalidates the previous context when switching accounts", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-gateway-generation-"));
    gateway = createGateway({ config: { mode: "family", gateway: "local", dataDir: "", allowRegistration: true, sessionTtlHours: 1 }, appDataDir: tempDir });
    await gateway.initialize();
    await gateway.registerAccount({ username: "alice", password: "password-1" });
    const previousContext = gateway.getContext();
    const previousGeneration = gateway.getContextGeneration();
    const bob = await gateway.registerAccount({ username: "bob", password: "password-2" });
    expect(gateway.isCurrentContext(previousContext, previousGeneration)).toBe(false);
    expect(gateway.getCurrentAccount()).toMatchObject({ accountId: bob.accountId });
  });
});