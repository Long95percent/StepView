import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const MIGRATIONS = Object.freeze([
  { version: 1, name: "base", file: "0001-base.sql" },
  { version: 2, name: "approvals", file: "0002-approvals.sql" },
]);

export class MigrationError extends Error {
  constructor(message, { code = "MIGRATION_FAILED", version = null } = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.version = version;
  }
}

export function checksumSql(sql) {
  return createHash("sha256").update(String(sql), "utf8").digest("hex");
}

export function loadMigrationSql(migration, { fsApi = fs, dir = MIGRATIONS_DIR } = {}) {
  if (!migration?.file) throw new MigrationError("Every migration needs a .sql file.", { code: "MIGRATION_INVALID" });
  return fsApi.readFileSync(path.join(dir, migration.file), "utf8");
}

export function sortMigrations(migrations = MIGRATIONS) {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  ordered.forEach((migration, index) => {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new MigrationError(`Invalid migration version: ${migration.version}`, { code: "MIGRATION_INVALID" });
    }
    if (index > 0 && ordered[index - 1].version === migration.version) {
      throw new MigrationError(`Duplicate migration version: ${migration.version}`, { code: "MIGRATION_DUPLICATE" });
    }
  });
  return ordered;
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function listAppliedMigrations(connection) {
  ensureMigrationTable(connection.db);
  return connection.db
    .prepare("SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC")
    .all()
    .map((row) => ({
      version: Number(row.version),
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    }));
}

export function runMigrations(connection, { migrations = MIGRATIONS, fsApi = fs, dir = MIGRATIONS_DIR, now = () => new Date().toISOString() } = {}) {
  if (!connection?.db) throw new MigrationError("runMigrations requires a database connection.");

  const ordered = sortMigrations(migrations);
  const knownVersion = ordered.at(-1)?.version ?? 0;
  const existingVersion = Number(connection.db.prepare("PRAGMA user_version").get().user_version || 0);

  if (existingVersion > knownVersion) {
    throw new MigrationError(
      `数据库版本 ${existingVersion} 高于当前代码支持的版本 ${knownVersion}，请升级应用，不要降级运行。`,
      { code: "MIGRATION_DATABASE_TOO_NEW", version: existingVersion },
    );
  }

  ensureMigrationTable(connection.db);
  const appliedByVersion = new Map(listAppliedMigrations(connection).map((row) => [row.version, row]));
  const appliedNow = [];

  for (const migration of ordered) {
    const sql = loadMigrationSql(migration, { fsApi, dir });
    const checksum = checksumSql(sql);
    const already = appliedByVersion.get(migration.version);

    if (already) {
      if (already.checksum !== checksum) {
        throw new MigrationError(
          `迁移 ${migration.version} (${migration.name}) 已应用，但文件内容被修改过。已发布的迁移只能新增，不能修改。`,
          { code: "MIGRATION_MODIFIED", version: migration.version },
        );
      }
      continue;
    }

    try {
      connection.withTransaction(() => {
        connection.db.exec(sql);
        connection.db
          .prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
          .run(migration.version, migration.name, checksum, now());
      });
    } catch (error) {
      throw new MigrationError(`迁移 ${migration.version} (${migration.name}) 执行失败：${error.message}`, {
        code: "MIGRATION_FAILED",
        version: migration.version,
      });
    }
    appliedNow.push({ version: migration.version, name: migration.name });
  }

  if (knownVersion > existingVersion) connection.db.exec(`PRAGMA user_version = ${knownVersion}`);

  return { applied: appliedNow, version: knownVersion, previousVersion: existingVersion };
}
