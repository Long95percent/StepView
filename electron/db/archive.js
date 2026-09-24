import fs from "node:fs";
import path from "node:path";
import { createConnection } from "./connection.js";

/**
 * 统一的数据库导出与恢复。
 *
 * 以前想备份用户数据，得自己知道有几个文件、哪几个是数据库、哪个是画布 JSON。
 * 现在只有一个入口：把两个库各自用 VACUUM INTO 打成一致快照，加一份 manifest 说明
 * "这是什么格式、哪个版本的代码写的、每个库有哪些表、各有多少行"。
 *
 * 恢复是"先校验、再替换"：校验不过就一个字节都不动。
 */

export const ARCHIVE_FORMAT = "stepview-database-archive";
export const ARCHIVE_FORMAT_VERSION = 1;
export const ARCHIVE_MANIFEST_FILE = "manifest.json";

/** 备份里必须存在的表。少一张就说明这份快照不完整，恢复之后会缺功能。 */
export const GLOBAL_REQUIRED_TABLES = Object.freeze([
  "schema_migrations",
  "accounts",
  "sessions",
  "gateway_settings",
  "retention_runs",
]);

export const ACCOUNT_REQUIRED_TABLES = Object.freeze([
  "schema_migrations",
  "kv",
  "retention_runs",
  "approvals",
  "snapshots",
  "board_documents",
  "agent_sessions",
  "agent_turns",
  "agent_session_windows",
  "agent_signals",
  "agent_prompt_snapshots",
  "agent_mem0_sync_log",
  "memory_items",
  "memory_evidence",
  "memory_feedback",
  "memory_relations",
  "memory_embeddings",
  "profile_items",
  "knowledge_bases",
  "diary_entries",
  "diary_links",
  "diary_tags",
  "diary_entry_tags",
  "diary_revisions",
]);

export class ArchiveError extends Error {
  constructor(message, { code = "ARCHIVE_FAILED", problems = [] } = {}) {
    super(message);
    this.name = "ArchiveError";
    this.code = code;
    this.problems = problems;
  }
}

const FTS_SHADOW_SUFFIXES = ["data", "idx", "content", "docsize", "config", "segments", "segdir"];
const SQLITE_SIDECARS = ["-wal", "-shm"];

function safeStamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function readManifest(dir, { fsApi }) {
  const manifestPath = path.join(dir, ARCHIVE_MANIFEST_FILE);
  if (!fsApi.existsSync(manifestPath)) {
    throw new ArchiveError(`这个目录里没有 ${ARCHIVE_MANIFEST_FILE}，不像是一份 StepView 备份。`, { code: "ARCHIVE_MANIFEST_MISSING" });
  }
  try {
    return JSON.parse(fsApi.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new ArchiveError(`备份清单读不出来：${error.message}`, { code: "ARCHIVE_MANIFEST_INVALID" });
  }
}

function forEachDatabase(manifest, visit) {
  const databases = Array.isArray(manifest?.databases) ? manifest.databases : [];
  if (databases.length === 0) throw new ArchiveError("备份清单里没有任何数据库。", { code: "ARCHIVE_MANIFEST_INVALID" });
  for (const entry of databases) visit(entry);
}

function openReadOnly(dbPath) {
  return createConnection({ dbPath, pragmas: { journal_mode: "WAL", foreign_keys: "ON", busy_timeout: 5000 } });
}

/** 用户表清单。FTS5 会自动建一堆影子表，列出来只是噪音，一并略过。 */
function listUserTables(db) {
  const virtualTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'")
    .all()
    .map((row) => row.name);
  const shadow = new Set();
  for (const name of virtualTables) {
    for (const suffix of FTS_SHADOW_SUFFIXES) shadow.add(`${name}_${suffix}`);
  }
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
    .all()
    .map((row) => row.name)
    .filter((name) => !shadow.has(name));
}

function countRows(db, table) {
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM "${String(table).replace(/"/g, '""')}"`).get()?.count || 0);
}

function schemaVersionOf(db) {
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (!hasTable) return 0;
  return Number(db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get()?.version || 0);
}

export function describeDatabase({ dbPath, fsApi = fs } = {}) {
  if (!fsApi.existsSync(dbPath)) throw new ArchiveError(`数据库不存在：${dbPath}`, { code: "ARCHIVE_DB_MISSING" });
  const connection = openReadOnly(dbPath);
  try {
    const tables = listUserTables(connection.db);
    return {
      schemaVersion: schemaVersionOf(connection.db),
      bytes: fsApi.statSync(dbPath).size,
      tables: tables.map((name) => ({ name, rows: countRows(connection.db, name) })),
    };
  } finally {
    connection.close();
  }
}

/**
 * 导出一份完整备份。
 *
 * 每个库都走 SQLite 自己的 VACUUM INTO：复制正在写的文件会得到半截副本，VACUUM INTO 不会。
 * 导出是只读的，不动用户正在用的库。
 */
export function exportArchive({ globalDbPath, accountDbPath, targetDir, now = new Date(), appVersion = null, label = "manual", fsApi = fs, logger = console } = {}) {
  if (!targetDir) throw new ArchiveError("导出需要指定目标目录。", { code: "ARCHIVE_TARGET_REQUIRED" });
  const sources = [
    { name: "global", fileName: "gateway.sqlite", dbPath: globalDbPath },
    { name: "account", fileName: "stepview.sqlite", dbPath: accountDbPath },
  ].filter((source) => source.dbPath);

  if (sources.length === 0) throw new ArchiveError("导出需要一个或多个数据库路径。", { code: "ARCHIVE_SOURCE_REQUIRED" });
  for (const source of sources) {
    if (!fsApi.existsSync(source.dbPath)) throw new ArchiveError(`数据库不存在：${source.dbPath}`, { code: "ARCHIVE_DB_MISSING" });
  }

  fsApi.mkdirSync(targetDir, { recursive: true });

  const databases = [];
  for (const source of sources) {
    const targetPath = path.join(targetDir, source.fileName);
    if (fsApi.existsSync(targetPath)) fsApi.unlinkSync(targetPath);
    const connection = openReadOnly(source.dbPath);
    try {
      connection.db.prepare("VACUUM INTO ?").run(targetPath);
    } finally {
      connection.close();
    }
    const description = describeDatabase({ dbPath: targetPath, fsApi });
    databases.push({
      name: source.name,
      fileName: source.fileName,
      schemaVersion: description.schemaVersion,
      bytes: description.bytes,
      tables: description.tables,
    });
    logger.info?.(`已导出 ${source.name}：${targetPath}`);
  }

  const manifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    appVersion: appVersion || null,
    label: String(label || "manual"),
    exportedAt: now.toISOString(),
    databases,
  };
  const manifestPath = path.join(targetDir, ARCHIVE_MANIFEST_FILE);
  fsApi.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { dir: targetDir, manifestPath, manifest };
}

/**
 * 校验一份备份能不能恢复。
 *
 * 只读，不改任何文件。返回所有问题而不是碰到第一个就停，用户一次就能看到缺什么。
 */
export function inspectArchive({ dir, expectedSchemaVersion = {}, requiredTables = {}, fsApi = fs } = {}) {
  const problems = [];
  const push = (code, message) => problems.push({ code, message });

  let manifest;
  try {
    manifest = readManifest(dir, { fsApi });
  } catch (error) {
    return { ok: false, problems: [{ code: error.code || "ARCHIVE_MANIFEST_MISSING", message: error.message }], manifest: null, databases: [] };
  }

  if (manifest.format !== ARCHIVE_FORMAT) push("ARCHIVE_FORMAT_UNKNOWN", `这份备份的类型不是 StepView 数据库备份：${manifest.format ?? "（空）"}`);
  if (Number(manifest.formatVersion) > ARCHIVE_FORMAT_VERSION) {
    push("ARCHIVE_FORMAT_TOO_NEW", `这份备份由更新的版本生成（格式 v${manifest.formatVersion}），当前程序最多支持 v${ARCHIVE_FORMAT_VERSION}。`);
  }

  const databases = [];
  const entries = Array.isArray(manifest.databases) ? manifest.databases : [];
  if (entries.length === 0) push("ARCHIVE_MANIFEST_INVALID", "备份清单里没有任何数据库。");

  for (const entry of entries) {
    const dbPath = path.join(dir, String(entry.fileName || ""));
    const report = { name: entry.name || entry.fileName, fileName: entry.fileName, manifestTables: entry.tables || [], actual: null };
    if (!entry.fileName || !fsApi.existsSync(dbPath)) {
      push("ARCHIVE_DB_MISSING", `备份里缺少数据库文件：${entry.fileName || "（未命名）"}`);
      databases.push(report);
      continue;
    }

    let connection = null;
    try {
      connection = openReadOnly(dbPath);
      const integrity = String(connection.db.prepare("PRAGMA integrity_check").get()?.integrity_check || "");
      if (integrity !== "ok") push("ARCHIVE_DB_CORRUPT", `${entry.fileName} 完整性校验没通过：${integrity}`);

      const actualTables = listUserTables(connection.db);
      const actualSchemaVersion = schemaVersionOf(connection.db);
      report.actual = { schemaVersion: actualSchemaVersion, tables: actualTables };

      if (actualSchemaVersion !== Number(entry.schemaVersion || 0)) {
        push("ARCHIVE_SCHEMA_MISMATCH", `${entry.fileName} 的 schema 版本（${actualSchemaVersion}）和清单里写的不一致（${entry.schemaVersion}）。`);
      }
      const supported = expectedSchemaVersion[entry.name];
      if (supported !== undefined && actualSchemaVersion > Number(supported)) {
        push("ARCHIVE_SCHEMA_TOO_NEW", `${entry.name} 备份的 schema 版本（${actualSchemaVersion}）比当前程序支持的（${supported}）新，请升级 StepView 再恢复。`);
      }
      const required = requiredTables[entry.name] || [];
      const missing = required.filter((name) => !actualTables.includes(name));
      if (missing.length) push("ARCHIVE_TABLE_MISSING", `${entry.fileName} 缺少必要的表：${missing.join(", ")}`);
    } catch (error) {
      // 文件根本不是数据库（被截断、被别的程序写过、拷贝中断）时，用户看到"损坏"比"打不开"更有用。
      const corrupt = /not a database|malformed|encrypted/i.test(String(error.message || ""));
      push(corrupt ? "ARCHIVE_DB_CORRUPT" : "ARCHIVE_DB_UNREADABLE", corrupt ? `${entry.fileName} 不是有效的数据库文件：${error.message}` : `${entry.fileName} 打不开：${error.message}`);
    } finally {
      connection?.close?.();
    }
    databases.push(report);
  }

  return { ok: problems.length === 0, problems, manifest, databases };
}

/**
 * 用备份替换当前数据。
 *
 * 调用方必须先关掉所有数据库连接——本函数不做这件事，也没法替调用方做。
 * 替换不是删除：当前的两个库会改名成 `*.pre-restore-<时间>` 留在原地，恢复错了还能退回来。
 * 旧的 -wal / -shm 必须一起清掉：它们是旧库的 WAL，套在新文件上会把新库读坏。
 */
export function restoreArchive({ dir, targets = {}, expectedSchemaVersion = {}, requiredTables = {}, now = new Date(), fsApi = fs, canRestore } = {}) {
  const report = inspectArchive({ dir, expectedSchemaVersion, requiredTables, fsApi });
  if (!report.ok) {
    throw new ArchiveError("这份备份没通过校验，没有改动任何数据。", { code: "ARCHIVE_NOT_RESTORABLE", problems: report.problems });
  }
  if (typeof canRestore === "function" && canRestore(report) === false) {
    throw new ArchiveError("当前还有数据库连接没关闭，不能替换数据。", { code: "ARCHIVE_DB_IN_USE" });
  }

  const stamp = safeStamp(now);
  const restored = [];
  const kept = [];
  forEachDatabase(report.manifest, (entry) => {
    const targetPath = targets[entry.name];
    if (!targetPath) return;
    fsApi.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fsApi.existsSync(targetPath)) {
      const keptPath = `${targetPath}.pre-restore-${stamp}`;
      fsApi.renameSync(targetPath, keptPath);
      kept.push({ name: entry.name, path: keptPath });
    }
    for (const suffix of SQLITE_SIDECARS) {
      const sidecar = `${targetPath}${suffix}`;
      if (fsApi.existsSync(sidecar)) fsApi.unlinkSync(sidecar);
    }
    fsApi.copyFileSync(path.join(dir, entry.fileName), targetPath);
    restored.push({ name: entry.name, path: targetPath, from: entry.fileName });
  });

  return { restored, kept, manifest: report.manifest, report };
}

export function listArchiveContents(dir, { fsApi = fs } = {}) {
  const manifest = readManifest(dir, { fsApi });
  const databases = [];
  forEachDatabase(manifest, (entry) => {
    databases.push({
      name: entry.name,
      fileName: entry.fileName,
      schemaVersion: entry.schemaVersion,
      bytes: entry.bytes,
      tables: entry.tables || [],
    });
  });
  return { manifest, databases };
}
