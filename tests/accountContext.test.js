import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountContext } from "../electron/gateway/accountContext.js";
import { createBoardStorage } from "../electron/boardStorage.js";
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

  it("marks diary links to a node as orphaned when that node leaves the board", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-context-orphan-"));
    context = createAccountContext({ account: { accountId: "account-a", username: "alice" }, accountsDir: tempDir });

    const task = (nodeIds) => ({ tasks: [{ id: "task-1", title: "求职", status: "active", nodes: nodeIds.map((id) => ({ id, title: id })) }] });
    await context.boardStorage.writeBoard(task(["node-keep", "node-drop"]));

    const entry = context.diaryService.create({
      content: "顺手关联了一个节点",
      occurredAt: "2026-09-24T02:00:00.000Z",
      links: [{ targetType: "node", targetId: "node-drop" }],
    });
    expect(context.diaryService.get(entry.diaryId).links[0].orphanedAt).toBe(null);

    // 用户在画布上删掉了这个节点。
    await context.boardStorage.writeBoard(task(["node-keep"]));

    // 日记和关联都还在，只是标上了"原节点已删除"——不能因为整理了画布就把日记一起弄没。
    const after = context.diaryService.get(entry.diaryId);
    expect(after.content).toBe("顺手关联了一个节点");
    expect(after.links).toHaveLength(1);
    expect(after.links[0].orphanedAt).toBeTruthy();

    // 再存一次同样的画布：已经标过的不会被重复处理（markLinksOrphaned 只认 NULL）。
    const stamp = after.links[0].orphanedAt;
    await context.boardStorage.writeBoard(task(["node-keep"]));
    expect(context.diaryService.get(entry.diaryId).links[0].orphanedAt).toBe(stamp);
  });

  it("keeps saving the board even when the orphan callback blows up", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-context-orphan-fail-"));
    context = createAccountContext({
      account: { accountId: "account-a", username: "alice" },
      accountsDir: tempDir,
      boardStorageFactory: (options) => createBoardStorage({ ...options, onNodesRemoved: () => { throw new Error("diary is down"); } }),
    });

    await context.boardStorage.writeBoard({ tasks: [{ id: "task-1", nodes: [{ id: "node-1" }] }] });
    // 日记出问题不该让画布存不进去：看板是用户的主要资产。
    await expect(context.boardStorage.writeBoard({ tasks: [] })).resolves.toMatchObject({ ok: true });
    expect((await context.boardStorage.readBoard()).tasks).toEqual([]);
  });
});
