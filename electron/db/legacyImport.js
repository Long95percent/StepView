import fs from "node:fs";
import path from "node:path";
import { createApprovalRepository } from "./repositories/approvalRepository.js";

const STAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
const PROPOSAL_ID_PATTERN = /^proposal-[A-Za-z0-9-]{6,120}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 数据库层落地之前的三个独立 SQLite 库。
 *
 * 表顺序不能改：agent_turns / agent_signals 等有指向 agent_sessions 的外键。
 */
const LEGACY_SQLITE_SOURCES = Object.freeze([
  {
    file: "stepview-agent.sqlite",
    marker: "legacy-import:agent-sqlite",
    tables: ["agent_sessions", "agent_turns", "agent_session_windows", "agent_signals", "agent_prompt_snapshots", "agent_mem0_sync_log"],
  },
  {
    file: "agent-memory.sqlite",
    marker: "legacy-import:memory-sqlite",
    tables: ["memory_items", "memory_evidence", "memory_feedback", "memory_relations", "memory_embeddings"],
  },
  {
    file: "user-profile.sqlite",
    marker: "legacy-import:profile-sqlite",
    tables: ["profile_items"],
  },
]);

function countRows(db, table, schema = null) {
  const target = schema ? `${schema}.${table}` : table;
  return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${target}`).get().count || 0);
}

function tableInfo(db, table, schema) {
  return db.prepare(`PRAGMA ${schema}.table_info('${table}')`).all();
}

function tableColumns(db, table, schema) {
  return tableInfo(db, table, schema).map((row) => row.name);
}

function primaryKeyColumns(db, table, schema) {
  return tableInfo(db, table, schema)
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name);
}

function renameToMigrated(fsApi, sourcePath) {
  const target = `${sourcePath}.migrated`;
  if (fsApi.existsSync(target)) return target;
  fsApi.renameSync(sourcePath, target);
  for (const suffix of ["-wal", "-shm"]) {
    if (fsApi.existsSync(`${sourcePath}${suffix}`)) {
      fsApi.renameSync(`${sourcePath}${suffix}`, `${target}${suffix}`);
    }
  }
  return target;
}

/**
 * 把旧 SQLite 库整表搬进账号库。
 *
 * 用 ATTACH + INSERT OR IGNORE，而不是逐行读出来再写进去：列名取两边交集，
 * 所以旧库缺列或者新库多了列都不会炸。搬完以后旧文件改名为 *.migrated 保留，
 * 不删除、不截断，出问题还能人工比对。
 */
function importLegacySqlite({ connection, dataDir, fsApi, logger }) {
  const db = connection.db;
  const results = [];

  for (const source of LEGACY_SQLITE_SOURCES) {
    if (readMarker(connection, source.marker)) continue;
    const sourcePath = path.join(dataDir, source.file);
    if (!fsApi.existsSync(sourcePath)) continue;

    const tables = [];
    try {
      db.prepare("ATTACH DATABASE ? AS legacy").run(sourcePath);
    } catch (error) {
      logger.warn?.(`无法挂载旧数据库：${source.file}`, error);
      results.push({ file: source.file, status: "attach-failed", tables: [] });
      continue;
    }

    try {
      for (const table of source.tables) {
        if (!IDENTIFIER_PATTERN.test(table)) continue;
        let shared;
        try {
          shared = tableColumns(db, table, "main").filter((column) => tableColumns(db, table, "legacy").includes(column));
        } catch (error) {
          tables.push({ table, status: "unreadable", error: error.message });
          continue;
        }
        if (shared.length === 0) {
          tables.push({ table, status: "skipped", reason: "no-shared-columns" });
          continue;
        }

        const columns = shared.join(", ");
        const selected = shared.map((column) => `src.${column}`).join(", ");
        const primaryKey = primaryKeyColumns(db, table, "main");
        // 不用 INSERT OR IGNORE：它会把违反约束的行一并吞掉，造成静默丢数据。
        // 改成按主键精确跳过写过的行，剩下的错误老老实实抛出来。
        const guard = primaryKey.length
          ? `WHERE NOT EXISTS (SELECT 1 FROM main.${table} AS dst WHERE ${primaryKey.map((key) => `dst.${key} = src.${key}`).join(" AND ")})`
          : "";
        const before = countRows(db, table);
        const legacyRows = countRows(db, table, "legacy");
        try {
          db.prepare(`INSERT INTO ${table} (${columns}) SELECT ${selected} FROM legacy.${table} AS src ${guard}`).run();
          tables.push({ table, legacyRows, imported: countRows(db, table) - before });
        } catch (error) {
          logger.warn?.(`导入旧表失败：${source.file} / ${table}`, error);
          tables.push({ table, status: "failed", error: error.message });
        }
      }
    } finally {
      try {
        db.exec("DETACH DATABASE legacy");
      } catch (error) {
        logger.warn?.(`卸载旧数据库失败：${source.file}`, error);
      }
    }

    const failed = tables.filter((table) => table.status === "failed");
    if (failed.length > 0) {
      // 有表没搬成功就先把旧库留在原位，不写标记，下次启动继续重试。
      logger.warn?.(`${source.file} 有 ${failed.length} 张表导入失败，旧库保持原样以便重试`);
      results.push({ file: source.file, status: "partial", archived: null, tables });
      continue;
    }

    let archived = null;
    try {
      archived = renameToMigrated(fsApi, sourcePath);
    } catch (error) {
      logger.warn?.(`旧数据库改名失败：${source.file}`, error);
    }

    writeMarker(connection, source.marker, { at: new Date().toISOString(), archived, tables });
    results.push({ file: source.file, status: "imported", archived, tables });
  }

  return results;
}

function parseStamp(stamp) {
  const match = STAMP_PATTERN.exec(String(stamp || ""));
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
}

function readJsonFilesSync(dir, fsApi) {
  let names;
  try {
    names = fsApi.readdirSync(dir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.endsWith(".tmp")) continue;
    try {
      files.push({ name, payload: JSON.parse(fsApi.readFileSync(path.join(dir, name), "utf8")) });
    } catch {
      // 单个坏文件不应该让整个导入失败；保留文件，跳过它。
    }
  }
  return files;
}

function readMarker(connection, key) {
  const row = connection.db.prepare("SELECT value_json FROM kv WHERE key = ?").get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

function writeMarker(connection, key, value) {
  connection.db
    .prepare(
      `INSERT INTO kv (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

/**
 * 导入数据库层落地之前的旧文件数据。
 *
 * 三条硬规则：
 *   1. 只读旧文件，不删除、不修改、不截断。
 *   2. 幂等：用 kv 标记记录已完成，重复启动不会重复导入。
 *   3. 只补空缺：同 id 的记录已存在时完全不碰，避免把用户已经批准过的提案变回待确认。
 */
export function importLegacyData({ connection, dataDir, fsApi = fs, logger = console } = {}) {
  if (!connection?.db) throw new Error("importLegacyData requires a database connection.");
  if (!dataDir) return { skipped: true, reason: "no-data-dir", proposals: 0, snapshots: 0 };

  const repository = createApprovalRepository({ connection });
  const summary = { skipped: false, proposals: 0, snapshots: 0, sqlite: [] };

  const proposalsMarker = "legacy-import:board-proposals";
  if (!readMarker(connection, proposalsMarker)) {
    let imported = 0;
    for (const { payload } of readJsonFilesSync(path.join(dataDir, "proposals"), fsApi)) {
      if (!payload || !PROPOSAL_ID_PATTERN.test(String(payload.proposalId || ""))) continue;
      if (!payload.accountId) continue;
      try {
        const existing = repository.get(payload.proposalId, { includePayload: false });
        if (existing) continue;
        repository.createIfAbsent({
          approvalId: payload.proposalId,
          accountId: payload.accountId,
          kind: "board_change",
          status: payload.status || "pending",
          summary: payload.summary || "",
          reason: payload.reason || "",
          operation: payload.operation || null,
          sessionId: payload.sessionId || null,
          payload: { before: payload.before ?? null, after: payload.after ?? null },
          diff: payload.diff || null,
          baseHash: payload.baseHash || null,
          createdAt: payload.createdAt || new Date().toISOString(),
          decidedAt: payload.decidedAt || null,
        });
        imported += 1;
      } catch (error) {
        logger.warn?.(`导入旧提案失败：${payload.proposalId}`, error);
      }
    }
    writeMarker(connection, proposalsMarker, { imported, at: new Date().toISOString() });
    summary.proposals = imported;
  }

  const snapshotsMarker = "legacy-import:board-snapshots";
  if (!readMarker(connection, snapshotsMarker)) {
    let imported = 0;
    for (const { name, payload } of readJsonFilesSync(path.join(dataDir, "history"), fsApi)) {
      const stamp = parseStamp(name.slice("board-".length, "board-".length + 24));
      const snapshotId = `snapshot-legacy-${name.replace(/\.json$/, "")}`;
      try {
        let createdAt = stamp;
        if (!createdAt) {
          try {
            createdAt = fsApi.statSync(path.join(dataDir, "history", name)).mtime.toISOString();
          } catch {
            createdAt = new Date().toISOString();
          }
        }
        const accountId = payload?.accountId || "local-personal";
        repository.addSnapshot(
          { snapshotId, accountId, kind: "board", label: "legacy", payload: payload ?? null, createdAt },
          { ifAbsent: true },
        );
        imported += 1;
      } catch (error) {
        logger.warn?.(`导入旧快照失败：${name}`, error);
      }
    }
    writeMarker(connection, snapshotsMarker, { imported, at: new Date().toISOString() });
    summary.snapshots = imported;
  }

  summary.sqlite = importLegacySqlite({ connection, dataDir, fsApi, logger });

  return summary;
}
