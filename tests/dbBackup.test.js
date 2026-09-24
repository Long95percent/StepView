import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection } from "../electron/db/connection.js";
import { createBackupManager } from "../electron/db/backup.js";

function at(iso) {
  return new Date(iso);
}

describe("database backups", () => {
  let tempDir;
  let connection;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-backup-"));
    connection = createConnection({ dbPath: path.join(tempDir, "stepview.sqlite") });
    connection.db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
    connection.db.prepare("INSERT INTO notes (id, body) VALUES (?, ?)").run("n1", "第一份笔记");
  });

  afterEach(async () => {
    connection?.close();
    connection = undefined;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("writes a snapshot that can be opened and read back", () => {
    const manager = createBackupManager({ dbPath: connection.dbPath });
    const backup = manager.createBackup({ connection, label: "manual", now: at("2026-09-24T10:00:00.000Z") });

    expect(backup.bytes).toBeGreaterThan(0);
    expect(backup.fileName).toBe("stepview-2026-09-24T10-00-00-000Z-manual.sqlite");

    const restored = createConnection({ dbPath: backup.path });
    expect(restored.db.prepare("SELECT body FROM notes WHERE id = ?").get("n1").body).toBe("第一份笔记");
    restored.close();
  });

  it("captures the state at the time of the snapshot, not later writes", () => {
    const manager = createBackupManager({ dbPath: connection.dbPath });
    const backup = manager.createBackup({ connection, label: "before-edit", now: at("2026-09-24T10:00:00.000Z") });

    connection.db.prepare("UPDATE notes SET body = ? WHERE id = ?").run("改过了", "n1");

    const restored = createConnection({ dbPath: backup.path });
    expect(restored.db.prepare("SELECT body FROM notes WHERE id = ?").get("n1").body).toBe("第一份笔记");
    restored.close();
  });

  it("rotates old snapshots and keeps the newest ones", () => {
    const manager = createBackupManager({ dbPath: connection.dbPath, maxBackups: 2 });
    manager.createBackup({ connection, label: "one", now: at("2026-09-24T10:00:00.000Z") });
    manager.createBackup({ connection, label: "two", now: at("2026-09-24T11:00:00.000Z") });
    const third = manager.createBackup({ connection, label: "three", now: at("2026-09-24T12:00:00.000Z") });

    expect(third.pruned).toEqual({ removed: 1, kept: 2 });
    expect(manager.list().map((entry) => entry.fileName)).toEqual([
      "stepview-2026-09-24T12-00-00-000Z-three.sqlite",
      "stepview-2026-09-24T11-00-00-000Z-two.sqlite",
    ]);
  });

  it("overwrites a snapshot taken at the same timestamp instead of failing", () => {
    const manager = createBackupManager({ dbPath: connection.dbPath });
    const first = manager.createBackup({ connection, label: "manual", now: at("2026-09-24T10:00:00.000Z") });
    const second = manager.createBackup({ connection, label: "manual", now: at("2026-09-24T10:00:00.000Z") });
    expect(second.fileName).toBe(first.fileName);
    expect(manager.list().length).toBe(1);
  });

  it("sanitizes the label so it cannot escape the backup directory", () => {
    const manager = createBackupManager({ dbPath: connection.dbPath });
    const backup = manager.createBackup({ connection, label: "../../etc/passwd", now: at("2026-09-24T10:00:00.000Z") });
    expect(path.dirname(backup.path)).toBe(manager.backupDir);
    expect(backup.fileName).not.toContain("..");
    expect(backup.fileName).not.toContain("/");
  });

  it("refuses to snapshot from inside a transaction", () => {
    const manager = createBackupManager({ dbPath: connection.dbPath });
    expect(() =>
      connection.withTransaction(() => manager.createBackup({ connection, label: "inside" })),
    ).toThrow(/不能在事务内执行/);
  });

  it("returns an empty list before any snapshot exists", () => {
    const manager = createBackupManager({ dbPath: connection.dbPath });
    expect(manager.list()).toEqual([]);
    expect(manager.prune()).toEqual({ removed: 0, kept: 0 });
  });
});
