import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boardHash, canonicalJson, createBoardChangeStore } from "../electron/agent/boardChangeStore.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";

const NOW = new Date("2026-05-20T10:00:00.000Z");
const PROPOSAL_ID = "proposal-11111111-2222-3333-4444-555555555555";

function boardWith(title = "考研") {
  return normalizeBoard({ tasks: [buildTask(title, { x: 1, y: 2 }, NOW)] });
}

describe("board change store", () => {
  let tempDir;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function makeStore(options = {}) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-proposals-"));
    return createBoardChangeStore({ dataDir: tempDir, ...options });
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

  it("persists the backup and the candidate board to disk", async () => {
    const store = await makeStore();
    const { record, before } = await stage(store);

    expect(record).toMatchObject({ status: "pending", operation: "task.rename", reason: "更贴合目标" });
    expect(record.before).toBeUndefined();

    const stored = JSON.parse(await readFile(path.join(tempDir, "proposals", `${PROPOSAL_ID}.json`), "utf8"));
    expect(stored.before.tasks[0].title).toBe("考研");
    expect(stored.after.tasks[0].title).toBe("考研数学");
    expect(stored.baseHash).toBe(boardHash(before));
  });

  it("never writes a temp file next to the final proposal", async () => {
    const store = await makeStore();
    await stage(store);
    const files = await readdir(path.join(tempDir, "proposals"));
    expect(files).toEqual([`${PROPOSAL_ID}.json`]);
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
    await expect(store.decide(PROPOSAL_ID, "rejected")).rejects.toThrow("already approved");
    await expect(store.decide(PROPOSAL_ID, "maybe")).rejects.toThrow("Invalid proposal decision");
  });

  it("refuses proposal ids that could escape the proposals directory", async () => {
    const store = await makeStore();
    await expect(store.get("../../etc/passwd")).rejects.toThrow("Invalid proposal id");
    await expect(store.remove("not-a-proposal")).rejects.toThrow("Invalid proposal id");
  });

  it("skips corrupt proposal files instead of failing the listing", async () => {
    const store = await makeStore();
    await stage(store);
    await writeFile(path.join(tempDir, "proposals", "proposal-99999999-9999-9999-9999-999999999999.json"), "{broken", "utf8");
    expect(await store.list({})).toHaveLength(1);
  });

  it("prunes decided proposals and overflows", async () => {
    const store = await makeStore({ maxProposals: 1 });
    await store.stage({ proposalId: "proposal-aaaaaaaa-1111-2222-3333-444444444444", accountId: "a", operation: "task.create", summary: "1", before: normalizeBoard({ tasks: [] }), after: boardWith("一") });
    await store.stage({ proposalId: "proposal-bbbbbbbb-1111-2222-3333-444444444444", accountId: "a", operation: "task.create", summary: "2", before: normalizeBoard({ tasks: [] }), after: boardWith("二") });
    const pending = await store.list({ status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].summary).toBe("2");

    await store.decide(pending[0].proposalId, "approved");
    await store.prune();
    expect(await store.list({})).toHaveLength(0);
  });

  it("writes pruned history snapshots", async () => {
    const store = await makeStore({ maxSnapshots: 1 });
    await store.snapshotBoard(boardWith("一"), { label: "before-apply", now: new Date("2026-05-20T10:00:00.000Z") });
    const second = await store.snapshotBoard(boardWith("二"), { label: "before-apply", now: new Date("2026-05-21T10:00:00.000Z") });
    const files = await readdir(store.historyDir());
    expect(files).toHaveLength(1);
    expect(path.basename(second)).toBe(files[0]);
  });

  it("hashes equivalent boards identically regardless of key order", () => {
    expect(boardHash({ tasks: [], stickers: [] })).toBe(boardHash({ stickers: [], tasks: [] }));
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(boardHash(boardWith("考研"))).not.toBe(boardHash(boardWith("考研数学")));
  });
});
