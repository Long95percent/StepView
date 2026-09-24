import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountContext } from "../electron/gateway/accountContext.js";
import { listRetentionRuns } from "../electron/db/retention.js";

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
    expect(context.agentSqliteStore.dbPath).toBe(path.join(tempDir, "account-a", "stepview.sqlite"));
  });

  it("keeps a single database per account instead of one per subsystem", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-context-single-"));
    context = createAccountContext({ account: { accountId: "account-a", username: "alice" }, accountsDir: tempDir });
    context.agentSqliteStore.ensureSession({ sessionId: "task:t1", taskLineId: "t1", title: "考研" });
    context.memoryRepository.upsert({ statement: "喜欢早上工作" });

    const files = await readdir(path.join(tempDir, "account-a"));
    expect(files.filter((name) => name.endsWith(".sqlite"))).toEqual(["stepview.sqlite"]);
  });

  it("supports the personal layout where the data dir is the account dir", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-context-personal-"));
    context = createAccountContext({
      account: { id: "local-personal", accountId: "local-personal" },
      dataDir: tempDir,
      mode: "personal",
    });
    expect(context.mode).toBe("personal");
    expect(context.dataDir).toBe(tempDir);
    expect(context.agentSqliteStore.dbPath).toBe(path.join(tempDir, "stepview.sqlite"));
  });

  it("sweeps its own database once when the context opens", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-context-maintenance-"));
    context = createAccountContext({ account: { accountId: "account-a", username: "alice" }, accountsDir: tempDir });

    const runs = listRetentionRuns(context.database);
    expect(runs).toHaveLength(1);
    // 账号库里没有审批、快照、Agent 数据时，规则仍然会被记录为已执行。
    expect(runs[0].results.map((item) => item.id)).toContain("agent-signals-expired");
    expect(context.maintenance.isRunning()).toBe(true);
  });
});