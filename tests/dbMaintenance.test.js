import { describe, expect, it, vi } from "vitest";
import { createConnection } from "../electron/db/connection.js";
import { DEFAULT_MAINTENANCE_INTERVAL_MS, createDatabaseMaintenance } from "../electron/db/maintenance.js";
import { listRetentionRuns } from "../electron/db/retention.js";

const RULES = [{ id: "sessions-expired", table: "sessions", where: "expires_at < :now" }];

function open() {
  const connection = createConnection({ dbPath: ":memory:" });
  connection.db.exec("CREATE TABLE sessions (session_id TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)");
  return connection;
}

function addSession(connection, sessionId, expiresAt) {
  connection.db.prepare("INSERT INTO sessions (session_id, expires_at, created_at) VALUES (?, ?, ?)").run(sessionId, expiresAt, "2026-01-01T00:00:00.000Z");
}

function sessionIds(connection) {
  return connection.db.prepare("SELECT session_id FROM sessions ORDER BY session_id ASC").all().map((row) => row.session_id);
}

describe("database maintenance", () => {
  it("sweeps once at startup and then on the daily timer", () => {
    const connection = open();
    addSession(connection, "expired", "2026-01-01T00:00:00.000Z");
    const daily = [];
    const handles = [];
    const maintenance = createDatabaseMaintenance({
      connection,
      rules: RULES,
      now: () => new Date("2026-09-24T00:00:00.000Z"),
      logger: { warn: () => {} },
      setTimer: (run, intervalMs) => {
        daily.push(run);
        const handle = { intervalMs, unref: vi.fn() };
        handles.push(handle);
        return handle;
      },
      clearTimer: (handle) => {
        handle.cleared = true;
      },
    });

    maintenance.start();
    expect(sessionIds(connection)).toEqual([]);
    expect(handles).toHaveLength(1);
    expect(handles[0].intervalMs).toBe(DEFAULT_MAINTENANCE_INTERVAL_MS);
    expect(handles[0].unref).toHaveBeenCalled();

    // 第二次 start 不该再挂一个定时器。
    maintenance.start({ runImmediately: false });
    expect(handles).toHaveLength(1);

    addSession(connection, "expired-2", "2026-01-01T00:00:00.000Z");
    daily[0]();
    expect(sessionIds(connection)).toEqual([]);

    maintenance.stop();
    expect(handles[0].cleared).toBe(true);
    expect(maintenance.isRunning()).toBe(false);
    connection.close();
  });

  it("records every sweep so the user can audit it", () => {
    const connection = open();
    addSession(connection, "expired", "2026-01-01T00:00:00.000Z");
    const maintenance = createDatabaseMaintenance({
      connection,
      rules: RULES,
      now: () => new Date("2026-09-24T00:00:00.000Z"),
      logger: { warn: () => {} },
      setTimer: () => ({ unref: () => {} }),
      clearTimer: () => {},
    });

    const report = maintenance.runNow("manual");

    expect(report.removedTotal).toBe(1);
    expect(listRetentionRuns(connection)[0].results[0]).toMatchObject({ id: "sessions-expired", removed: 1 });
    maintenance.stop();
    connection.close();
  });

  it("logs a failed sweep instead of breaking the app", () => {
    const connection = open();
    const maintenance = createDatabaseMaintenance({
      connection,
      rules: RULES,
      logger: { warn: () => {} },
      setTimer: () => ({ unref: () => {} }),
      clearTimer: () => {},
    });
    connection.close();

    expect(() => maintenance.runNow("startup")).not.toThrow();
    expect(maintenance.runNow("startup")).toBeNull();
  });
});
