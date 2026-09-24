import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "../electron/db/connection.js";
import {
  GLOBAL_MIGRATIONS,
  MIGRATIONS,
  checksumSql,
  loadMigrationSql,
  listAppliedMigrations,
  runMigrations,
  sortMigrations,
} from "../electron/db/migrations/index.js";
import { openAccountDatabase, openGlobalDatabase } from "../electron/db/index.js";

const NOW = () => "2026-09-24T00:00:00.000Z";

describe("database migrations", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-migrations-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function open() {
    return createConnection({ dbPath: path.join(tempDir, "migrate.sqlite") });
  }

  it("ships migration files that exist and load", () => {
    const ordered = sortMigrations(MIGRATIONS);
    expect(ordered.map((migration) => migration.version)).toEqual([...ordered.map((m) => m.version)].sort((a, b) => a - b));
    for (const migration of ordered) {
      expect(migration.name).toBeTruthy();
      expect(loadMigrationSql(migration)).toContain("CREATE TABLE");
    }
  });

  it("rejects duplicate or invalid versions", () => {
    expect(() => sortMigrations([{ version: 1, name: "a", file: "0001-base.sql" }, { version: 1, name: "b", file: "0001-base.sql" }])).toThrow(/Duplicate/);
    expect(() => sortMigrations([{ version: 0, name: "a", file: "0001-base.sql" }])).toThrow(/Invalid/);
  });

  it("applies migrations once and records them", () => {
    const connection = open();
    const first = runMigrations(connection, { now: NOW });
    expect(first.applied.length).toBe(MIGRATIONS.length);
    expect(connection.tableExists("kv")).toBe(true);
    expect(connection.tableExists("retention_runs")).toBe(true);
    expect(connection.db.prepare("PRAGMA user_version").get().user_version).toBe(MIGRATIONS.length);

    const second = runMigrations(connection, { now: NOW });
    expect(second.applied).toEqual([]);
    expect(listAppliedMigrations(connection).length).toBe(MIGRATIONS.length);
    connection.close();
  });

  it("keeps migration history intact across reopens", async () => {
    const dbPath = path.join(tempDir, "reopen.sqlite");
    const first = createConnection({ dbPath });
    runMigrations(first, { now: NOW });
    first.close();

    const second = createConnection({ dbPath });
    expect(runMigrations(second, { now: NOW }).applied).toEqual([]);
    expect(listAppliedMigrations(second).map((row) => row.version)).toEqual(MIGRATIONS.map((migration) => migration.version));
    second.close();
  });

  it("refuses to run when an applied migration file was edited", () => {
    const connection = open();
    runMigrations(connection, { now: NOW });
    connection.db.prepare("UPDATE schema_migrations SET checksum = ? WHERE version = ?").run("tampered", MIGRATIONS[0].version);
    expect(() => runMigrations(connection, { now: NOW })).toThrow(/内容被修改过/);
    try {
      runMigrations(connection, { now: NOW });
    } catch (error) {
      expect(error.code).toBe("MIGRATION_MODIFIED");
    }
    connection.close();
  });

  it("stores the checksum of the sql it actually ran", () => {
    const connection = open();
    runMigrations(connection, { now: NOW });
    const applied = listAppliedMigrations(connection).find((row) => row.version === 1);
    expect(applied.checksum).toBe(checksumSql(loadMigrationSql(MIGRATIONS.find((m) => m.version === 1))));
    connection.close();
  });

  it("rolls a failed migration back and leaves the version untouched", () => {
    const connection = open();
    const broken = [
      { version: 1, name: "base", file: "0001-base.sql" },
      { version: 2, name: "broken", file: "9999-broken.sql" },
    ];
    const dir = tempDir;
    const sql = "CREATE TABLE partial (id INTEGER PRIMARY KEY); THIS IS NOT SQL;";
    expect(() =>
      runMigrations(connection, {
        migrations: broken,
        dir,
        fsApi: { readFileSync: (file) => (file.endsWith("9999-broken.sql") ? sql : loadMigrationSql(broken[0])) },
        now: NOW,
      }),
    ).toThrow(/迁移 2/);
    expect(connection.tableExists("partial")).toBe(false);
    expect(listAppliedMigrations(connection).map((row) => row.version)).toEqual([1]);
    connection.close();
  });

  it("refuses to open a database written by a newer app version", () => {
    const connection = open();
    runMigrations(connection, { now: NOW });
    connection.db.exec("PRAGMA user_version = 99");
    expect(() => runMigrations(connection, { now: NOW })).toThrow(/高于当前代码支持的版本/);
    connection.close();
  });

  it("opens an account database through the public entry point", () => {
    const db = openAccountDatabase({ dataDir: tempDir });
    expect(db.appliedMigrations.map((migration) => migration.version)).toEqual(MIGRATIONS.map((migration) => migration.version));
    expect(db.tableExists("kv")).toBe(true);
    expect(db.dbPath.endsWith("stepview.sqlite")).toBe(true);
    db.close();
  });

  it("leaves no partial tables behind and releases the file when a migration fails during open", () => {
    const dbPath = path.join(tempDir, "partial.sqlite");
    const brokenSql = "CREATE TABLE partial (id INTEGER PRIMARY KEY); THIS IS NOT SQL;";
    expect(() =>
      openAccountDatabase({
        dataDir: tempDir,
        migrations: [{ version: 1, name: "broken", file: "0001-broken.sql" }],
        fsApi: { mkdirSync: () => {}, readFileSync: () => brokenSql },
        now: NOW,
      }),
    ).toThrow(/迁移 1/);

    const reopened = createConnection({ dbPath });
    expect(reopened.tableExists("partial")).toBe(false);
    expect(reopened.tableExists("schema_migrations")).toBe(false);
    reopened.close();
  });

  it("opens the gateway database with its own migration set", () => {
    for (const migration of GLOBAL_MIGRATIONS) expect(loadMigrationSql(migration)).toContain("CREATE TABLE");

    const db = openGlobalDatabase({ dataDir: tempDir });
    expect(db.dbPath.endsWith("gateway.sqlite")).toBe(true);
    expect(db.tableExists("accounts")).toBe(true);
    expect(db.tableExists("sessions")).toBe(true);
    expect(db.tableExists("gateway_settings")).toBe(true);
    expect(db.tableExists("retention_runs")).toBe(true);
    // 账号库的表不能跑到全局库里来，两个库的迁移集合是分开的。
    expect(db.tableExists("kv")).toBe(false);
    expect(db.tableExists("approvals")).toBe(false);
    db.close();

    const reopened = openGlobalDatabase({ dataDir: tempDir });
    expect(listAppliedMigrations(reopened).map((row) => row.version)).toEqual(GLOBAL_MIGRATIONS.map((migration) => migration.version));
    reopened.close();
  });
});
