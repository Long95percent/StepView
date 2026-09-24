import path from "node:path";
import { createConnection } from "./connection.js";
import { MIGRATIONS, runMigrations } from "./migrations/index.js";
import { createBackupManager } from "./backup.js";

export const GLOBAL_DB_FILE = "gateway.sqlite";
export const ACCOUNT_DB_FILE = "stepview.sqlite";

function openDatabase({ dbPath, fsApi, migrations, now, migrate = true }) {
  const connection = createConnection({ dbPath, fsApi });
  let applied = [];
  try {
    applied = migrate ? runMigrations(connection, { migrations, fsApi, now }).applied : [];
  } catch (error) {
    connection.close();
    throw error;
  }
  return {
    ...connection,
    dbPath,
    appliedMigrations: applied,
    backups: createBackupManager({ dbPath, fsApi }),
  };
}

export function openGlobalDatabase({ dataDir, ...options } = {}) {
  if (!dataDir) throw new Error("openGlobalDatabase requires a dataDir.");
  return openDatabase({ ...options, dbPath: path.join(dataDir, GLOBAL_DB_FILE) });
}

export function openAccountDatabase({ dataDir, ...options } = {}) {
  if (!dataDir) throw new Error("openAccountDatabase requires a dataDir.");
  return openDatabase({ ...options, dbPath: path.join(dataDir, ACCOUNT_DB_FILE) });
}

export { createConnection, createBackupManager, MIGRATIONS, runMigrations };
