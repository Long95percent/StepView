import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createApprovalManager } from "../electron/agent/approvalManager.js";
import { openAccountDatabase } from "../electron/db/index.js";
import { createApprovalRepository } from "../electron/db/repositories/approvalRepository.js";
import { createTestDatabase } from "./helpers/testDatabase.js";

describe("approval manager", () => {
  let tempDir;
  let database;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function setup() {
    const created = await createTestDatabase("stepview-approval-manager-");
    tempDir = created.dataDir;
    database = created.database;
    return createApprovalManager({ repository: created.repository });
  }

  it("isolates and decides proposals by account", async () => {
    const manager = await setup();
    const item = manager.submit({ type: "memory_upsert", memory: { statement: "喜欢早上工作" } }, { accountId: "a" });
    expect(manager.list("b")).toEqual([]);
    expect(() => manager.decide(item.approvalId, "b", "approved")).toThrow();
    expect(manager.decide(item.approvalId, "a", "approved").status).toBe("approved");
  });

  it("keeps pending proposals across a restart", async () => {
    const manager = await setup();
    const item = manager.submit({ type: "memory_upsert", memory: { statement: "跨重启" } }, { accountId: "a" });

    // 关掉再重新打开同一个数据目录，模拟应用重启。
    database.close();
    const reopened = reopenAccountDatabase(tempDir);
    database = reopened.database;
    const restored = createApprovalManager({ repository: reopened.repository }).list("a");

    expect(restored.map((entry) => entry.approvalId)).toEqual([item.approvalId]);
    expect(restored[0].proposal.memory.statement).toBe("跨重启");
  });

  it("leaves board change proposals to the board change store", async () => {
    const manager = await setup();
    const item = manager.submit({ type: "memory_upsert" }, { accountId: "a" });
    database.db
      .prepare("INSERT INTO approvals (id, account_id, kind, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("proposal-abcdef123456", "a", "board_change", "pending", "{}", new Date().toISOString());

    expect(manager.list("a").map((entry) => entry.approvalId)).toEqual([item.approvalId]);
    expect(manager.find("proposal-abcdef123456", "a")).toBe(null);
    expect(() => manager.decide("proposal-abcdef123456", "a", "approved")).toThrow("Approval not found");
  });
});

function reopenAccountDatabase(dataDir) {
  const database = openAccountDatabase({ dataDir });
  return { database, repository: createApprovalRepository({ connection: database }) };
}
