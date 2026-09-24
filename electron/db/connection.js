import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const DEFAULT_PRAGMAS = Object.freeze({
  journal_mode: "WAL",
  foreign_keys: "ON",
  busy_timeout: 5000,
  synchronous: "NORMAL",
});

function isThenable(value) {
  return Boolean(value) && typeof value.then === "function";
}

/**
 * 只读连接上能设的 PRAGMA。
 *
 * 写型 PRAGMA（journal_mode 等）在只读连接上会被拒绝；只读场景本来也不该改文件，
 * 打开一份备份做校验时更不能顺手把用户的备份动了。
 */
const READ_ONLY_PRAGMAS = Object.freeze({ foreign_keys: "ON", busy_timeout: 5000 });

export function createConnection({ dbPath, fsApi = fs, pragmas = DEFAULT_PRAGMAS, readOnly = false } = {}) {
  if (typeof dbPath !== "string" || !dbPath.trim()) throw new Error("A database path is required.");

  const inMemory = dbPath === ":memory:";
  // 只读连接不建目录也不建文件：路径写错了要报错，而不是凭空造一个空库出来。
  if (!inMemory && !readOnly) fsApi.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
  for (const [name, value] of Object.entries(readOnly ? READ_ONLY_PRAGMAS : pragmas)) db.exec(`PRAGMA ${name} = ${value}`);

  let transactionDepth = 0;
  let closed = false;

  function assertOpen() {
    if (closed) throw new Error("The database connection is already closed.");
  }

  function withTransaction(run) {
    assertOpen();
    if (typeof run !== "function") throw new Error("withTransaction requires a function.");

    if (transactionDepth > 0) {
      transactionDepth += 1;
      try {
        return run();
      } finally {
        transactionDepth -= 1;
      }
    }

    db.exec("BEGIN IMMEDIATE");
    transactionDepth = 1;
    try {
      const result = run();
      if (isThenable(result)) {
        throw new Error("withTransaction requires a synchronous function because the sqlite driver is synchronous.");
      }
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // SQLite may have rolled the transaction back on its own; the original error is what matters.
      }
      throw error;
    } finally {
      transactionDepth = 0;
    }
  }

  function tableExists(table) {
    assertOpen();
    return Boolean(
      db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?").get(String(table)),
    );
  }

  function close() {
    if (closed) return;
    closed = true;
    db.close();
  }

  return {
    db,
    dbPath,
    readOnly,
    withTransaction,
    tableExists,
    inTransaction: () => transactionDepth > 0,
    close,
  };
}
