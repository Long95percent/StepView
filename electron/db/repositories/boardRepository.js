import { normalizeBoard } from "../../../src/progressCore.js";
import { boardHash } from "../boardHash.js";

const DOC_KEY = "board";

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * 画布仓储。
 *
 * 画布以“一整块文档”存一行，不做表拆分；换来的是一致性和审批指纹的稳定，
 * 代价是每次保存重写一行 JSON——这仍然比原来每次重写整个文件 + 复制备份便宜。
 */
export function createBoardRepository({ connection } = {}) {
  if (!connection?.db) throw new Error("Board repository requires a database connection.");
  const { db } = connection;

  const selectStatement = db.prepare("SELECT doc_key, revision, payload_json, backup_json, hash, updated_at FROM board_documents WHERE doc_key = ?");
  const upsertStatement = db.prepare(`
    INSERT INTO board_documents (doc_key, revision, payload_json, backup_json, hash, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(doc_key) DO UPDATE SET
      revision = excluded.revision,
      payload_json = excluded.payload_json,
      backup_json = excluded.backup_json,
      hash = excluded.hash,
      updated_at = excluded.updated_at
  `);

  function readRow() {
    return selectStatement.get(DOC_KEY) || null;
  }

  function isEmpty() {
    return readRow() === null;
  }

  function metadata() {
    const row = readRow();
    return row ? { revision: Number(row.revision), hash: row.hash, updatedAt: row.updated_at } : null;
  }

  /** 读画布。主副本损坏时回退到备份副本，与重构前的 backup 文件语义一致。 */
  function readBoard() {
    const row = readRow();
    if (!row) return null;
    const primary = parseJson(row.payload_json);
    if (primary) return normalizeBoard(primary);
    const backup = parseJson(row.backup_json);
    return backup ? normalizeBoard(backup) : null;
  }

  function save(board, { now = new Date() } = {}) {
    const existing = readRow();
    const next = normalizeBoard(board);
    upsertStatement.run(
      DOC_KEY,
      Number(existing?.revision || 0) + 1,
      JSON.stringify(next),
      existing ? existing.payload_json : null,
      boardHash(next),
      now.toISOString(),
    );
    return metadata();
  }

  /** 只在画布还没有任何记录时写入，用于导入旧 JSON 文件。 */
  function saveIfAbsent(board, { now = new Date() } = {}) {
    if (!isEmpty()) return null;
    return save(board, { now });
  }

  return { readBoard, save, saveIfAbsent, isEmpty, metadata };
}
