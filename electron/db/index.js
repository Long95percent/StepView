import path from "node:path";
import { createConnection } from "./connection.js";
import { GLOBAL_MIGRATIONS, MIGRATIONS, runMigrations } from "./migrations/index.js";
import { createBackupManager } from "./backup.js";
import { importLegacyData } from "./legacyImport.js";

export const GLOBAL_DB_FILE = "gateway.sqlite";
export const ACCOUNT_DB_FILE = "stepview.sqlite";

function openDatabase({ dbPath, dataDir, fsApi, migrations, now, migrate = true, importLegacy = false, logger = console }) {
  const connection = createConnection({ dbPath, fsApi });
  let applied = [];
  let legacyImport = { skipped: true, reason: "disabled", proposals: 0, snapshots: 0 };
  try {
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
    legacyImport,
    backups: createBackupManager({ dbPath, fsApi }),
  };
}

export function openGlobalDatabase({ dataDir, dbPath, migrations = GLOBAL_MIGRATIONS, ...options } = {}) {
  if (!dataDir) throw new Error("openGlobalDatabase requires a dataDir.");
  return openDatabase({ ...options, dataDir, dbPath: dbPath || path.join(dataDir, GLOBAL_DB_FILE), migrations });
}

export function openAccountDatabase({ dataDir, importLegacy = true, ...options } = {}) {
  if (!dataDir) throw new Error("openAccountDatabase requires a dataDir.");
  return openDatabase({ ...options, dataDir, importLegacy, dbPath: path.join(dataDir, ACCOUNT_DB_FILE) });
}

export { createConnection, createBackupManager, importLegacyData, GLOBAL_MIGRATIONS, MIGRATIONS, runMigrations };
