import fs from "node:fs";
import path from "node:path";
import { createApprovalRepository } from "./repositories/approvalRepository.js";

const STAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
const PROPOSAL_ID_PATTERN = /^proposal-[A-Za-z0-9-]{6,120}$/;

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
  const summary = { skipped: false, proposals: 0, snapshots: 0 };

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

  return summary;
}
