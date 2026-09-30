import fs from "node:fs";
import path from "node:path";

const LABEL_PATTERN = /[^A-Za-z0-9-]/g;
const SQLITE_SUFFIX = ".sqlite";

export class BackupError extends Error {
  constructor(message, { code = "BACKUP_FAILED" } = {}) {
    super(message);
    this.name = "BackupError";
    this.code = code;
  }
}

/**
 * 一致性备份。
 *
 * 用 SQLite 的 VACUUM INTO 生成快照，比复制文件可靠：复制正在写入的数据库会得到损坏或半截的副本。
 * VACUUM INTO 不能在事务内执行，所以调用时必须已经离开事务。
 */
export function createBackupManager({ dbPath, backupDir, maxBackups = 5, fsApi = fs, logger = console } = {}) {
  if (typeof dbPath !== "string" || !dbPath.trim()) throw new BackupError("Backup manager requires a database path.");
  if (!Number.isInteger(maxBackups) || maxBackups <= 0) throw new BackupError("maxBackups must be a positive integer.");

  const resolvedBackupDir = backupDir || path.join(path.dirname(dbPath), "backups");
  const prefix = `${path.basename(dbPath, SQLITE_SUFFIX)}-`;

  function list() {
    let entries;
    try {
      entries = fsApi.readdirSync(resolvedBackupDir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return entries
      .filter((name) => name.startsWith(prefix) && name.endsWith(SQLITE_SUFFIX))
      .sort()
      .reverse()
      .map((name) => {
        const filePath = path.join(resolvedBackupDir, name);
        return { fileName: name, path: filePath, bytes: fsApi.statSync(filePath).size };
      });
  }

  function prune() {
    const existing = list();
    const stale = existing.slice(maxBackups);
    for (const entry of stale) {
      try {
        fsApi.unlinkSync(entry.path);
      } catch (error) {
        logger.warn?.(`删除旧备份失败：${entry.path}`, error);
      }
    }
    return { removed: stale.length, kept: existing.length - stale.length };
  }

  function createBackup({ connection, label = "manual", now = new Date() } = {}) {
    if (!connection?.db) throw new BackupError("createBackup requires a database connection.");
    if (connection.inTransaction?.()) {
      throw new BackupError("VACUUM INTO 不能在事务内执行，请在事务结束后再备份。", { code: "BACKUP_IN_TRANSACTION" });
    }

    const safeLabel = String(label || "manual").replace(LABEL_PATTERN, "-").slice(0, 40) || "manual";
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const fileName = `${prefix}${stamp}-${safeLabel}${SQLITE_SUFFIX}`;
    const targetPath = path.join(resolvedBackupDir, fileName);

    fsApi.mkdirSync(resolvedBackupDir, { recursive: true });
    if (fsApi.existsSync(targetPath)) fsApi.unlinkSync(targetPath);
    connection.db.prepare("VACUUM INTO ?").run(targetPath);

    const pruned = prune();
    return { fileName, path: targetPath, bytes: fsApi.statSync(targetPath).size, pruned };
  }

  return { backupDir: resolvedBackupDir, list, createBackup, prune };
}
