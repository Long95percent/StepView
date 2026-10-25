import path from "node:path";
import { createConnection } from "./connection.js";
import { GLOBAL_MIGRATIONS, MIGRATIONS, runMigrations } from "./migrations/index.js";
import { createBackupManager } from "./backup.js";
import { importLegacyData } from "./legacyImport.js";

export const GLOBAL_DB_FILE = "gateway.sqlite";
export const ACCOUNT_DB_FILE = "stepview.sqlite";

function hasPendingMigrations(connection, migrations = []) {
  if (migrations.length === 0) return false;
  const knownVersion = Math.max(...migrations.map((migration) => migration.version));
  const existingVersion = Number(connection.db.prepare("PRAGMA user_version").get().user_version || 0);
  return existingVersion < knownVersion;
}

function openDatabase({ dbPath, dataDir, fsApi, migrations, now, migrate = true, importLegacy = false, logger = console }) {
  const connection = createConnection({ dbPath, fsApi });
  const backups = createBackupManager({ dbPath, fsApi });
  let applied = [];
  let migrationBackup = null;
  let legacyImport = { skipped: true, reason: "disabled", proposals: 0, snapshots: 0 };
  try {
    const hasExistingSchema = Number(connection.db.prepare("SELECT COUNT(*) AS count FROM sqlite_master").get().count || 0) > 0;
    if (migrate && hasExistingSchema && hasPendingMigrations(connection, migrations)) {
      migrationBackup = backups.createBackup({ connection, label: "before-migration" });
    }
    applied = migrate ? runMigrations(connection, { migrations, fsApi, now }).applied : [];
    if (importLegacy) legacyImport = importLegacyData({ connection, dataDir, fsApi, logger });
  } catch (error) {
    connection.close();
    throw error;
  }
  return {
    ...connection,
    dbPath,
    appliedMigrations: applied,
    migrationBackup,
    legacyImport,
    backups,
  };
}

export function openGlobalDatabase({ dataDir, dbPath, migrations = GLOBAL_MIGRATIONS, ...options } = {}) {
  if (!dataDir) throw new Error("openGlobalDatabase requires a dataDir.");
  return openDatabase({ ...options, dataDir, dbPath: dbPath || path.join(dataDir, GLOBAL_DB_FILE), migrations });
}

export function openAccountDatabase({ dataDir, importLegacy = true, migrations = MIGRATIONS, ...options } = {}) {
  if (!dataDir) throw new Error("openAccountDatabase requires a dataDir.");
  return openDatabase({ ...options, dataDir, importLegacy, migrations, dbPath: path.join(dataDir, ACCOUNT_DB_FILE) });
}

export { createConnection, createBackupManager, importLegacyData, GLOBAL_MIGRATIONS, MIGRATIONS, runMigrations };
