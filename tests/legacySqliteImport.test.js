import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openAccountDatabase } from "../electron/db/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const migrationsDir = path.join(ROOT, "electron", "db", "migrations");
const schemaOf = (file) => readFileSync(path.join(migrationsDir, file), "utf8");

/** 用重构前的表结构造一个旧库，模拟真实用户升级前的磁盘状态。 */
function writeLegacyDatabase(dataDir, fileName, statements) {
  const db = new DatabaseSync(path.join(dataDir, fileName));
  db.exec(statements.join("\n"));
  return db;
}

describe("legacy sqlite import", () => {
  let tempDir;
  let database;

  afterEach(() => {
    database?.close();
    database = undefined;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  function makeDataDir() {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "stepview-legacy-sqlite-"));
    return tempDir;
  }

  function seedAgentDatabase(sessionId = "task:t1", turnId = "turn-1") {
    const legacy = writeLegacyDatabase(tempDir, "stepview-agent.sqlite", [schemaOf("0003-agent.sql")]);
    legacy
      .prepare("INSERT INTO agent_sessions (session_id, task_line_id, title, persona_text, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(sessionId, "t1", "考研", "", "active", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    legacy
      .prepare("INSERT INTO agent_turns (turn_id, session_id, user_text, assistant_text, route_json, source, model, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(turnId, sessionId, "你好", "在的", "{}", "openai", "gpt-5.1", "complete", "2026-05-01T00:01:00.000Z", "2026-05-01T00:01:00.000Z");
    legacy
      .prepare("INSERT INTO agent_session_windows (session_id, recent_turn_ids_json, rolling_summary_text, rolling_summary_turn_ids_json, session_state_json, prompt_state_json, updated_at) VALUES (?,?,?,?,?,?,?)")
      .run(sessionId, JSON.stringify([turnId]), "摘要", "[]", "{}", "{}", "2026-05-01T00:02:00.000Z");
    legacy.close();
  }

  function seedMemoryDatabase(memoryId = "memory-1") {
    const legacy = writeLegacyDatabase(tempDir, "agent-memory.sqlite", [schemaOf("0004-memory.sql")]);
    legacy
      .prepare("INSERT INTO memory_items (id, account_id, agent_id, scope_type, scope_id, category, subject_key, statement, source_type, confidence, importance, stability, sensitivity, status, created_at, updated_at, extraction_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(memoryId, "account-a", "user", "user", "account-a", "semantic", "style", "喜欢早上工作", "conversation", 0.7, 0.5, 0.5, "normal", "candidate", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z", "1");
    legacy.close();
  }

  function seedProfileDatabase() {
    const legacy = writeLegacyDatabase(tempDir, "user-profile.sqlite", [schemaOf("0005-profile.sql")]);
    legacy
      .prepare("INSERT INTO profile_items VALUES (?,?,?,?,?,?,?,?)")
      .run("preference:style", "account-a", "preference", "style", JSON.stringify("concise"), "normal", "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    legacy.close();
  }

  function countAll() {
    return {
      sessions: database.db.prepare("SELECT COUNT(*) AS c FROM agent_sessions").get().c,
      turns: database.db.prepare("SELECT COUNT(*) AS c FROM agent_turns").get().c,
      windows: database.db.prepare("SELECT COUNT(*) AS c FROM agent_session_windows").get().c,
      memories: database.db.prepare("SELECT COUNT(*) AS c FROM memory_items").get().c,
      profile: database.db.prepare("SELECT COUNT(*) AS c FROM profile_items").get().c,
    };
  }

  it("moves every row from the three old databases into the account database", () => {
    makeDataDir();
    seedAgentDatabase();
    seedMemoryDatabase();
    seedProfileDatabase();

    database = openAccountDatabase({ dataDir: tempDir });

    expect(countAll()).toEqual({ sessions: 1, turns: 1, windows: 1, memories: 1, profile: 1 });
    const turn = database.db.prepare("SELECT user_text, assistant_text FROM agent_turns WHERE turn_id = ?").get("turn-1");
    expect(turn).toEqual({ user_text: "你好", assistant_text: "在的" });
  });

  it("renames the old databases instead of deleting them", () => {
    makeDataDir();
    seedAgentDatabase();
    seedMemoryDatabase();
    seedProfileDatabase();

    database = openAccountDatabase({ dataDir: tempDir });

    for (const file of ["stepview-agent.sqlite", "agent-memory.sqlite", "user-profile.sqlite"]) {
      expect(existsSync(path.join(tempDir, file))).toBe(false);
      expect(existsSync(path.join(tempDir, `${file}.migrated`))).toBe(true);
    }
  });

  it("is idempotent: a second startup imports nothing and does not duplicate rows", () => {
    makeDataDir();
    seedAgentDatabase();
    seedMemoryDatabase();
    seedProfileDatabase();

    database = openAccountDatabase({ dataDir: tempDir });
    const first = countAll();
    database.close();

    database = openAccountDatabase({ dataDir: tempDir });
    expect(countAll()).toEqual(first);
    expect(database.legacyImport.sqlite).toEqual([]);
  });

  it("imports only the shared columns when the legacy table has fewer of them", () => {
    makeDataDir();
    const legacy = writeLegacyDatabase(tempDir, "user-profile.sqlite", [
      "CREATE TABLE profile_items (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, category TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '');",
    ]);
    legacy.prepare("INSERT INTO profile_items (id, account_id, category, key, value_json) VALUES (?,?,?,?,?)").run("preference:style", "account-a", "preference", "style", JSON.stringify("concise"));
    legacy.close();

    database = openAccountDatabase({ dataDir: tempDir });

    const row = database.db.prepare("SELECT value_json, sensitivity FROM profile_items WHERE id = ?").get("preference:style");
    expect(JSON.parse(row.value_json)).toBe("concise");
    expect(row.sensitivity).toBe("normal");
  });

  it("fails loudly and keeps the old database when a table cannot be migrated", () => {
    makeDataDir();
    // created_at / updated_at 是 NOT NULL 且没有默认值：旧库缺这两列就搬不过来。
    // 这种情况下必须报错并保留旧库，绝不能静默丢掉用户的画像数据。
    const legacy = writeLegacyDatabase(tempDir, "user-profile.sqlite", [
      "CREATE TABLE profile_items (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, category TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL);",
    ]);
    legacy.prepare("INSERT INTO profile_items VALUES (?,?,?,?,?)").run("preference:style", "account-a", "preference", "style", JSON.stringify("concise"));
    legacy.close();

    database = openAccountDatabase({ dataDir: tempDir, logger: { warn: () => {} } });

    expect(database.db.prepare("SELECT COUNT(*) AS c FROM profile_items").get().c).toBe(0);
    const report = database.legacyImport.sqlite.find((entry) => entry.file === "user-profile.sqlite");
    expect(report.status).toBe("partial");
    expect(report.tables[0]).toMatchObject({ table: "profile_items", status: "failed" });
    expect(existsSync(path.join(tempDir, "user-profile.sqlite"))).toBe(true);

    // 没写标记，下次启动还会重试。
    database.close();
    database = openAccountDatabase({ dataDir: tempDir, logger: { warn: () => {} } });
    expect(database.legacyImport.sqlite.find((entry) => entry.file === "user-profile.sqlite").status).toBe("partial");
  });

  it("imports the tables that exist and skips the ones that do not", () => {
    makeDataDir();
    const legacy = writeLegacyDatabase(tempDir, "agent-memory.sqlite", [schemaOf("0004-memory.sql")]);
    legacy.close();

    database = openAccountDatabase({ dataDir: tempDir });
    const report = database.legacyImport.sqlite.find((entry) => entry.file === "agent-memory.sqlite");
    expect(report.status).toBe("imported");
    expect(report.tables.map((table) => table.table)).toEqual([
      "memory_items",
      "memory_evidence",
      "memory_feedback",
      "memory_relations",
      "memory_embeddings",
    ]);
    expect(report.tables.every((table) => table.legacyRows === 0)).toBe(true);
  });

  it("does nothing when there is no legacy data to import", () => {
    makeDataDir();
    database = openAccountDatabase({ dataDir: tempDir });
    expect(database.legacyImport.sqlite).toEqual([]);
    expect(readdirSync(tempDir).filter((name) => name.endsWith(".migrated"))).toEqual([]);
  });

  it("keeps the migrated copy readable so the data can be audited", () => {
    makeDataDir();
    seedAgentDatabase();
    database = openAccountDatabase({ dataDir: tempDir });
    database.close();
    database = undefined;

    const archived = new DatabaseSync(path.join(tempDir, "stepview-agent.sqlite.migrated"));
    expect(archived.prepare("SELECT COUNT(*) AS c FROM agent_turns").get().c).toBe(1);
    archived.close();
  });
});
