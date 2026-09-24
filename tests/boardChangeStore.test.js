import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { boardHash, canonicalJson, createBoardChangeStore } from "../electron/agent/boardChangeStore.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";
import { createTestDatabase } from "./helpers/testDatabase.js";

const NOW = new Date("2026-05-20T10:00:00.000Z");
const PROPOSAL_ID = "proposal-11111111-2222-3333-4444-555555555555";

function boardWith(title = "考研") {
  return normalizeBoard({ tasks: [buildTask(title, { x: 1, y: 2 }, NOW)] });
}

describe("board change store", () => {
  let tempDir;
  let database;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function makeStore(options = {}) {
    const created = await createTestDatabase("stepview-proposals-");
    tempDir = created.dataDir;
    database = created.database;
    return createBoardChangeStore({ connection: database, accountId: "account-a", ...options });
  }

  async function stage(store, overrides = {}) {
    const before = boardWith();
    const after = boardWith("考研数学");
    const record = await store.stage({
      proposalId: PROPOSAL_ID,
      accountId: "account-a",
      sessionId: "session-1",
      operation: "task.rename",
      reason: "更贴合目标",
      summary: "重命名任务线",
      diff: { lines: ["任务线重命名"], counts: { added: 0, removed: 0, modified: 1 } },
      before,
      after,
      ...overrides,
    });
    return { record, before, after };
  }

  it("stores the before and after payloads in the database", async () => {
    const store = await makeStore();
    const { record, before } = await stage(store);

    expect(record).toMatchObject({ status: "pending", operation: "task.rename", reason: "更贴合目标" });
    expect(record.before).toBeUndefined();

    const stored = store.get(PROPOSAL_ID, { includePayload: true });
    expect(stored.before.tasks[0].title).toBe("考研");
    expect(stored.after.tasks[0].title).toBe("考研数学");
    expect(stored.baseHash).toBe(boardHash(before));
  });

  it("keeps exactly one row per proposal, so re-staging never duplicates history", async () => {
    const store = await makeStore();
    await stage(store);
    await stage(store);
    const rows = database.db.prepare("SELECT COUNT(*) AS count FROM approvals WHERE kind = ?").get("board_change");
    expect(rows.count).toBe(1);
  });

  it("lists and filters proposals without payloads", async () => {
    const store = await makeStore();
    await stage(store);
    const pending = await store.list({ status: "pending", accountId: "account-a" });
    expect(pending).toHaveLength(1);
    expect(pending[0].before).toBeUndefined();
    expect(await store.list({ accountId: "account-b" })).toHaveLength(0);
    expect(await store.list({ status: "approved" })).toHaveLength(0);
  });

  it("records decisions and rejects double decisions", async () => {
    const store = await makeStore();
    await stage(store);
    const decided = await store.decide(PROPOSAL_ID, "approved");
    expect(decided.status).toBe("approved");
    expect(decided.decidedAt).toBeTruthy();
    expect(() => store.decide(PROPOSAL_ID, "rejected")).toThrow("already approved");
    expect(() => store.decide(PROPOSAL_ID, "maybe")).toThrow("Invalid proposal decision");
  });

  it("refuses proposal ids that are not valid proposal identifiers", async () => {
    const store = await makeStore();
    expect(() => store.get("../../etc/passwd")).toThrow("Invalid proposal id");
    expect(() => store.remove("not-a-proposal")).toThrow("Invalid proposal id");
    expect(() => store.stage({ proposalId: "../escape", accountId: "account-a", before: boardWith(), after: boardWith() })).toThrow("Invalid proposal id");
  });

  it("survives a proposal row whose payload was corrupted", async () => {
    const store = await makeStore();
    await stage(store);
    database.db.prepare("UPDATE approvals SET payload_json = ? WHERE id = ?").run("{broken", PROPOSAL_ID);

    const listed = store.list({});
    expect(listed).toHaveLength(1);
    expect(listed[0].proposalId).toBe(PROPOSAL_ID);

    const withPayload = store.get(PROPOSAL_ID, { includePayload: true });
    expect(withPayload.before.tasks).toEqual([]);
  });

  it("prunes decided proposals and overflows", async () => {
    const store = await makeStore({ maxProposals: 1 });
    await store.stage({ proposalId: "proposal-aaaaaaaa-1111-2222-3333-444444444444", accountId: "account-a", operation: "task.create", summary: "1", before: normalizeBoard({ tasks: [] }), after: boardWith("一") });
    await store.stage({ proposalId: "proposal-bbbbbbbb-1111-2222-3333-444444444444", accountId: "account-a", operation: "task.create", summary: "2", before: normalizeBoard({ tasks: [] }), after: boardWith("二") });
    const pending = await store.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].summary).toBe("2");

    await store.decide(pending[0].proposalId, "approved");
    await store.prune();
    expect(await store.list({})).toHaveLength(0);
  });

  it("rotates history snapshots and keeps the newest one", async () => {
    const store = await makeStore({ maxSnapshots: 1 });
    await store.snapshotBoard(boardWith("一"), { label: "before-apply", now: new Date("2026-05-20T10:00:00.000Z") });
    await store.snapshotBoard(boardWith("二"), { label: "before-apply", now: new Date("2026-05-21T10:00:00.000Z") });

    const snapshots = store.listSnapshots({ includePayload: true, limit: 10 });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].createdAt).toBe("2026-05-21T10:00:00.000Z");
    expect(snapshots[0].payload.tasks[0].title).toBe("二");
  });

  it("only touches proposals that belong to its own account", async () => {
    const store = await makeStore();
    await stage(store);
    await stage(store, { proposalId: "proposal-cccccccc-1111-2222-3333-444444444444", accountId: "account-b" });

    expect(await store.list({})).toHaveLength(1);
    expect(store.get("proposal-cccccccc-1111-2222-3333-444444444444")).toBeNull();
  });

  it("hashes equivalent boards identically regardless of key order", () => {
    expect(boardHash({ tasks: [], stickers: [] })).toBe(boardHash({ stickers: [], tasks: [] }));
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(boardHash(boardWith("考研"))).not.toBe(boardHash(boardWith("考研数学")));
  });
});
