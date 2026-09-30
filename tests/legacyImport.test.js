import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAccountDatabase } from "../electron/db/index.js";
import { importLegacyData } from "../electron/db/legacyImport.js";
import { createApprovalRepository } from "../electron/db/repositories/approvalRepository.js";

const PROPOSAL_ID = "proposal-11111111-1111-1111-1111-111111111111";
const SNAPSHOT_FILE = "board-2026-05-20T10-00-00-000Z-before-apply.json";

describe("legacy data import", () => {
  let tempDir;
  let database;

  afterEach(async () => {
    database?.close();
    database = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function setup() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-legacy-"));
    await mkdir(path.join(tempDir, "proposals"), { recursive: true });
    await mkdir(path.join(tempDir, "history"), { recursive: true });
    database = openAccountDatabase({ dataDir: tempDir, importLegacy: false });
    return createApprovalRepository({ connection: database });
  }

  async function writeLegacyProposal(overrides = {}) {
    const record = {
      proposalId: PROPOSAL_ID,
      accountId: "account-a",
      sessionId: "session-1",
      operation: "task.rename",
      reason: "更贴合目标",
      summary: "重命名任务线",
      status: "pending",
      createdAt: "2026-05-20T10:00:00.000Z",
      decidedAt: null,
      baseHash: "hash-before",
      diff: { lines: ["改动一行"], counts: { added: 0, removed: 0, modified: 1 } },
      before: { tasks: [] },
      after: { tasks: [{ id: "t1" }] },
      ...overrides,
    };
    await writeFile(path.join(tempDir, "proposals", `${record.proposalId}.json`), JSON.stringify(record), "utf8");
    return record;
  }

  it("imports legacy proposals and snapshots into the database", async () => {
    const repository = await setup();
    await writeLegacyProposal();
    await writeFile(path.join(tempDir, "history", SNAPSHOT_FILE), JSON.stringify({ tasks: [{ id: "old" }] }), "utf8");

    const summary = importLegacyData({ connection: database, dataDir: tempDir });

    expect(summary).toMatchObject({ proposals: 1, snapshots: 1 });
    const proposals = repository.list({ kind: "board_change", includePayload: true });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ approvalId: PROPOSAL_ID, operation: "task.rename", reason: "更贴合目标", baseHash: "hash-before" });
    expect(proposals[0].payload.before).toEqual({ tasks: [] });
    expect(proposals[0].payload.after).toEqual({ tasks: [{ id: "t1" }] });

    const snapshots = repository.listSnapshots({ includePayload: true });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].createdAt).toBe("2026-05-20T10:00:00.000Z");
    expect(snapshots[0].payload.tasks).toEqual([{ id: "old" }]);
  });

  it("never deletes or rewrites the legacy files it reads", async () => {
    await setup();
    await writeLegacyProposal();
    await writeFile(path.join(tempDir, "history", SNAPSHOT_FILE), JSON.stringify({ tasks: [] }), "utf8");

    importLegacyData({ connection: database, dataDir: tempDir });

    expect(await readdir(path.join(tempDir, "proposals"))).toEqual([`${PROPOSAL_ID}.json`]);
    expect(await readdir(path.join(tempDir, "history"))).toEqual([SNAPSHOT_FILE]);
    const raw = JSON.parse(await readFile(path.join(tempDir, "proposals", `${PROPOSAL_ID}.json`), "utf8"));
    expect(raw.proposalId).toBe(PROPOSAL_ID);
  });

  it("is idempotent across repeated startups", async () => {
    const repository = await setup();
    await writeLegacyProposal();

    expect(importLegacyData({ connection: database, dataDir: tempDir }).proposals).toBe(1);
    expect(importLegacyData({ connection: database, dataDir: tempDir }).proposals).toBe(0);
    expect(repository.list({ kind: "board_change" })).toHaveLength(1);
  });

  it("does not resurrect a proposal the user already decided", async () => {
    const repository = await setup();
    await writeLegacyProposal();
    importLegacyData({ connection: database, dataDir: tempDir });

    repository.decide(PROPOSAL_ID, "approved");
    importLegacyData({ connection: database, dataDir: tempDir });

    expect(repository.get(PROPOSAL_ID).status).toBe("approved");
  });

  it("skips unreadable files without failing the whole import", async () => {
    const repository = await setup();
    await writeLegacyProposal();
    await writeFile(path.join(tempDir, "proposals", "proposal-broken000000.json"), "{not json", "utf8");

    const summary = importLegacyData({ connection: database, dataDir: tempDir });
    expect(summary.proposals).toBe(1);
    expect(repository.list({ kind: "board_change" })).toHaveLength(1);
  });

  it("ignores malformed proposal ids and records nothing extra", async () => {
    const repository = await setup();
    await writeFile(path.join(tempDir, "proposals", "escape.json"), JSON.stringify({ proposalId: "../escape", accountId: "a" }), "utf8");

    expect(importLegacyData({ connection: database, dataDir: tempDir }).proposals).toBe(0);
    expect(repository.list({})).toHaveLength(0);
  });

  it("runs automatically when an account database is opened", async () => {
    await setup();
    await writeLegacyProposal();
    database.close();

    database = openAccountDatabase({ dataDir: tempDir });
    expect(database.legacyImport).toMatchObject({ proposals: 1 });
    expect(createApprovalRepository({ connection: database }).list({ kind: "board_change" })).toHaveLength(1);
  });
});
