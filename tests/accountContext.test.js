import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountContext } from "../electron/gateway/accountContext.js";

describe("account context", () => {
  let tempDir;
  let context;

  afterEach(async () => {
    await context?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("derives isolated storage paths from account ids", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-context-"));
    context = createAccountContext({ account: { accountId: "account-a", username: "alice" }, accountsDir: tempDir });
    expect(context.dataDir).toBe(path.join(tempDir, "account-a"));
    expect(context.boardStorage.boardPath()).toBe(path.join(tempDir, "account-a", "stepview-board.json"));
    expect(context.agentSqliteStore.dbPath).toBe(path.join(tempDir, "account-a", "stepview-agent.sqlite"));
  });
});