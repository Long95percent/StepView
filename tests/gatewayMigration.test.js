import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "../electron/gateway/createGateway.js";

describe("gateway personal data migration", () => {
  let tempDir;
  let gateway;

  afterEach(async () => {
    await gateway?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("requires confirmation for non-empty targets and preserves the source", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-migration-"));
    const sourceBoard = { tasks: [{ id: "personal-task" }] };
    await writeFile(path.join(tempDir, "stepview-board.json"), JSON.stringify(sourceBoard), "utf8");
    gateway = createGateway({ config: { mode: "family", gateway: "local", dataDir: "", allowRegistration: true, sessionTtlHours: 1 }, appDataDir: tempDir });
    await gateway.initialize();
    await gateway.registerAccount({ username: "alice", password: "password-1" });
    await gateway.saveBoard({ tasks: [{ id: "existing-task" }] });
    await expect(gateway.importPersonalData()).rejects.toThrow("explicit confirmation");
    await expect(gateway.loadBoard()).resolves.toMatchObject({ tasks: [{ id: "existing-task" }] });
    await gateway.importPersonalData({ confirm: true });
    await expect(gateway.loadBoard()).resolves.toMatchObject({ tasks: [{ id: "personal-task" }] });
    await expect(readFile(path.join(tempDir, "stepview-board.json"), "utf8").then(JSON.parse)).resolves.toEqual(sourceBoard);
  });

  it("allows import into a newly created account with an empty Agent database", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-migration-empty-"));
    await writeFile(path.join(tempDir, "stepview-board.json"), JSON.stringify({ tasks: [{ id: "source-task" }] }), "utf8");
    gateway = createGateway({ config: { mode: "family", gateway: "local", dataDir: "", allowRegistration: true, sessionTtlHours: 1 }, appDataDir: tempDir });
    await gateway.initialize();
    await gateway.registerAccount({ username: "alice", password: "password-1" });
    await expect(gateway.importPersonalData()).resolves.toMatchObject({ ok: true });
    await expect(gateway.loadBoard()).resolves.toMatchObject({ tasks: [{ id: "source-task" }] });
  });
});