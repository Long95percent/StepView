import { describe, expect, it } from "vitest";
import { createConnection } from "../electron/db/connection.js";
import {
  RETENTION_RULES,
  buildApprovalRetentionRules,
  buildSnapshotRetentionRules,
  listRetentionRuns,
  runRetention,
  validateRetentionRules,
} from "../electron/db/retention.js";

const NOW = new Date("2026-09-24T00:00:00.000Z");
const quiet = { warn: () => {} };

function open() {
  const connection = createConnection({ dbPath: ":memory:" });
  connection.db.exec(`
    CREATE TABLE gateway_sessions (session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE diary_entries (id TEXT PRIMARY KEY, status TEXT NOT NULL, deleted_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE agent_turns (turn_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL);
  `);
  return connection;
}

function insert(connection, table, columns, rows) {
  const statement = connection.db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) statement.run(...columns.map((column) => row[column]));
}

function ids(connection, table, column) {
  return connection.db.prepare(`SELECT ${column} FROM ${table} ORDER BY ${column} ASC`).all().map((row) => row[column]);
}

describe("retention rules", () => {
  it("ships a valid default rule set covering approvals and snapshots", () => {
    expect(RETENTION_RULES.map((rule) => rule.id)).toEqual([
      "approvals-expired:board_change",
      "approvals-overflow:board_change",
      "snapshots-overflow:board",
    ]);
    expect(validateRetentionRules(RETENTION_RULES)).toBe(RETENTION_RULES);
  });

  it("builds parameterised approval and snapshot rules for one store", () => {
    expect(buildApprovalRetentionRules({ kind: "board_change", maxPending: 3, ttlDays: 2 }).map((rule) => rule.keep?.limit ?? null)).toEqual([null, 3]);
    expect(buildSnapshotRetentionRules({ kind: "board", maxSnapshots: 4 })[0].keep.limit).toBe(4);
    expect(() => buildApprovalRetentionRules({ kind: "bad kind" })).toThrow(/非法的审批类型/);
    expect(() => buildSnapshotRetentionRules({ kind: "bad-kind" })).toThrow(/非法的快照类型/);
  });

  it("rejects malformed rules", () => {
    expect(() => validateRetentionRules([{ table: "t", where: "1=1" }])).toThrow(/需要 id/);
    expect(() => validateRetentionRules([{ id: "a", table: "t", where: "1=1" }, { id: "a", table: "t", where: "1=1" }])).toThrow(/重复/);
    expect(() => validateRetentionRules([{ id: "a", table: "bad name", where: "1=1" }])).toThrow(/合法标识符/);
    expect(() => validateRetentionRules([{ id: "a", table: "t", where: "1=1", keep: { limit: 3, orderBy: "created_at DESC" } }])).toThrow(/必须声明 key/);
    expect(() => validateRetentionRules([{ id: "a", table: "t", key: "id", keep: { limit: 0, orderBy: "created_at DESC" } }])).toThrow(/正整数/);
    expect(() => validateRetentionRules([{ id: "a", table: "t" }])).toThrow(/什么都不做/);
  });

  it("fails fast when where uses :ttl without ttlDays", () => {
    const connection = open();
    expect(() =>
      runRetention({
        connection,
        rules: [{ id: "r", table: "diary_entries", where: "status = 'trashed' AND deleted_at < :ttl" }],
        now: NOW,
        logger: quiet,
      }),
    ).toThrow(/没有声明 ttlDays/);
    connection.close();
  });
});

describe("retention execution", () => {
  it("deletes rows past an absolute expiry and keeps exactly-on-cutoff rows", () => {
    const connection = open();
    insert(connection, "gateway_sessions", ["session_id", "account_id", "expires_at", "created_at"], [
      { session_id: "expired", account_id: "a", expires_at: "2026-09-23T23:59:59.000Z", created_at: "2026-09-01T00:00:00.000Z" },
      { session_id: "on-cutoff", account_id: "a", expires_at: "2026-09-24T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" },
      { session_id: "alive", account_id: "a", expires_at: "2026-10-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" },
    ]);

    const report = runRetention({
      connection,
      rules: [{ id: "sessions", table: "gateway_sessions", where: "expires_at < :now" }],
      now: NOW,
      logger: quiet,
    });

    expect(report.removedTotal).toBe(1);
    expect(ids(connection, "gateway_sessions", "session_id")).toEqual(["alive", "on-cutoff"]);
    connection.close();
  });

  it("deletes rows past a ttl window", () => {
    const connection = open();
    insert(connection, "diary_entries", ["id", "status", "deleted_at", "created_at"], [
      { id: "old-trash", status: "trashed", deleted_at: "2026-08-01T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z" },
      { id: "fresh-trash", status: "trashed", deleted_at: "2026-09-23T00:00:00.000Z", created_at: "2026-07-01T00:00:00.000Z" },
      { id: "active-old", status: "active", deleted_at: null, created_at: "2020-01-01T00:00:00.000Z" },
    ]);

    const report = runRetention({
      connection,
      rules: [{ id: "trash", table: "diary_entries", where: "status = 'trashed' AND deleted_at < :ttl", ttlDays: 30 }],
      now: NOW,
      logger: quiet,
    });

    expect(report.removedTotal).toBe(1);
    expect(ids(connection, "diary_entries", "id")).toEqual(["active-old", "fresh-trash"]);
    connection.close();
  });

  it("keeps only the newest rows when a limit is configured", () => {
    const connection = open();
    insert(connection, "agent_turns", ["turn_id", "session_id", "created_at"], [
      { turn_id: "t1", session_id: "s1", created_at: "2026-01-01T00:00:00.000Z" },
      { turn_id: "t2", session_id: "s1", created_at: "2026-01-02T00:00:00.000Z" },
      { turn_id: "t3", session_id: "s1", created_at: "2026-01-03T00:00:00.000Z" },
      { turn_id: "t4", session_id: "s1", created_at: "2026-01-04T00:00:00.000Z" },
    ]);

    runRetention({
      connection,
      rules: [{ id: "turns", table: "agent_turns", key: "turn_id", keep: { limit: 2, orderBy: "created_at DESC" } }],
      now: NOW,
      logger: quiet,
    });

    expect(ids(connection, "agent_turns", "turn_id")).toEqual(["t3", "t4"]);
    connection.close();
  });

  it("applies the limit per partition", () => {
    const connection = open();
    insert(connection, "agent_turns", ["turn_id", "session_id", "created_at"], [
      { turn_id: "a1", session_id: "sA", created_at: "2026-01-01T00:00:00.000Z" },
      { turn_id: "a2", session_id: "sA", created_at: "2026-01-02T00:00:00.000Z" },
      { turn_id: "a3", session_id: "sA", created_at: "2026-01-03T00:00:00.000Z" },
      { turn_id: "b1", session_id: "sB", created_at: "2026-01-01T00:00:00.000Z" },
      { turn_id: "b2", session_id: "sB", created_at: "2026-01-02T00:00:00.000Z" },
    ]);

    runRetention({
      connection,
      rules: [
        {
          id: "turns-per-session",
          table: "agent_turns",
          key: "turn_id",
          keep: { limit: 2, orderBy: "created_at DESC", partitionBy: "session_id" },
        },
      ],
      now: NOW,
      logger: quiet,
    });

    expect(ids(connection, "agent_turns", "turn_id")).toEqual(["a2", "a3", "b1", "b2"]);
    connection.close();
  });

  it("only counts rows matching the keep filter", () => {
    const connection = open();
    insert(connection, "diary_entries", ["id", "status", "deleted_at", "created_at"], [
      { id: "d1", status: "trashed", deleted_at: "2026-09-01T00:00:00.000Z", created_at: "2026-01-01T00:00:00.000Z" },
      { id: "d2", status: "trashed", deleted_at: "2026-09-02T00:00:00.000Z", created_at: "2026-01-02T00:00:00.000Z" },
      { id: "d3", status: "trashed", deleted_at: "2026-09-03T00:00:00.000Z", created_at: "2026-01-03T00:00:00.000Z" },
      { id: "keep-me", status: "active", deleted_at: null, created_at: "2020-01-01T00:00:00.000Z" },
    ]);

    runRetention({
      connection,
      rules: [
        {
          id: "trash-limit",
          table: "diary_entries",
          key: "id",
          keep: { limit: 1, orderBy: "deleted_at DESC", filter: "status = 'trashed'" },
        },
      ],
      now: NOW,
      logger: quiet,
    });

    expect(ids(connection, "diary_entries", "id")).toEqual(["d3", "keep-me"]);
    connection.close();
  });

  it("combines an expiry rule with a limit rule", () => {
    const connection = open();
    insert(connection, "diary_entries", ["id", "status", "deleted_at", "created_at"], [
      { id: "ancient", status: "trashed", deleted_at: "2026-01-01T00:00:00.000Z", created_at: "2025-01-01T00:00:00.000Z" },
      { id: "recent-1", status: "trashed", deleted_at: "2026-09-20T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" },
      { id: "recent-2", status: "trashed", deleted_at: "2026-09-21T00:00:00.000Z", created_at: "2026-09-02T00:00:00.000Z" },
      { id: "recent-3", status: "trashed", deleted_at: "2026-09-22T00:00:00.000Z", created_at: "2026-09-03T00:00:00.000Z" },
    ]);

    const report = runRetention({
      connection,
      rules: [
        {
          id: "trash",
          table: "diary_entries",
          key: "id",
          where: "status = 'trashed' AND deleted_at < :ttl",
          ttlDays: 30,
          keep: { limit: 2, orderBy: "deleted_at DESC", filter: "status = 'trashed'" },
        },
      ],
      now: NOW,
      logger: quiet,
    });

    expect(report.removedTotal).toBe(2);
    expect(ids(connection, "diary_entries", "id")).toEqual(["recent-2", "recent-3"]);
    connection.close();
  });

  it("skips rules whose table does not exist yet", () => {
    const connection = open();
    const report = runRetention({
      connection,
      rules: [{ id: "future", table: "not_created_yet", where: "1 = 1" }],
      now: NOW,
      logger: quiet,
    });
    expect(report.results[0]).toMatchObject({ id: "future", status: "skipped", reason: "table-missing" });
    connection.close();
  });

  it("keeps other rules working when one rule fails", () => {
    const connection = open();
    insert(connection, "agent_turns", ["turn_id", "session_id", "created_at"], [
      { turn_id: "t1", session_id: "s1", created_at: "2026-01-01T00:00:00.000Z" },
      { turn_id: "t2", session_id: "s1", created_at: "2026-01-02T00:00:00.000Z" },
    ]);

    const report = runRetention({
      connection,
      rules: [
        { id: "broken", table: "agent_turns", where: "no_such_column < :now" },
        { id: "turns", table: "agent_turns", key: "turn_id", keep: { limit: 1, orderBy: "created_at DESC" } },
      ],
      now: NOW,
      logger: quiet,
    });

    expect(report.results.find((item) => item.id === "broken").status).toBe("failed");
    expect(report.results.find((item) => item.id === "turns")).toMatchObject({ status: "applied", removed: 1 });
    expect(ids(connection, "agent_turns", "turn_id")).toEqual(["t2"]);
    connection.close();
  });

  it("is idempotent across repeated runs", () => {
    const connection = open();
    insert(connection, "agent_turns", ["turn_id", "session_id", "created_at"], [
      { turn_id: "t1", session_id: "s1", created_at: "2026-01-01T00:00:00.000Z" },
      { turn_id: "t2", session_id: "s1", created_at: "2026-01-02T00:00:00.000Z" },
      { turn_id: "t3", session_id: "s1", created_at: "2026-01-03T00:00:00.000Z" },
    ]);
    const rules = [{ id: "turns", table: "agent_turns", key: "turn_id", keep: { limit: 2, orderBy: "created_at DESC" } }];

    const first = runRetention({ connection, rules, now: NOW, logger: quiet });
    const second = runRetention({ connection, rules, now: NOW, logger: quiet });

    expect(first.removedTotal).toBe(1);
    expect(second.removedTotal).toBe(0);
    expect(ids(connection, "agent_turns", "turn_id")).toEqual(["t2", "t3"]);
    connection.close();
  });

  it("records every run so users can audit what was removed", () => {
    const connection = open();
    runRetention({ connection, rules: [{ id: "sessions", table: "gateway_sessions", where: "expires_at < :now" }], now: NOW, logger: quiet });
    const runs = listRetentionRuns(connection);
    expect(runs.length).toBe(1);
    expect(runs[0].results[0]).toMatchObject({ id: "sessions", status: "applied", removed: 0 });
    expect(runs[0].startedAt).toBe(NOW.toISOString());
    connection.close();
  });
});
