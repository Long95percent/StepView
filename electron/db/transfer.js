import fs from "node:fs";
import path from "node:path";
import { normalizeBoard } from "../../src/progressCore.js";
import { readBoardExportFile } from "./boardExport.js";
import { createConnection } from "./connection.js";
import { ACCOUNT_DB_FILE } from "./index.js";
import { createBoardRepository } from "./repositories/boardRepository.js";

/**
 * 数据库层落地之前，个人模式留下的独立数据库文件。
 * 导入个人数据时整份搬到账号目录，交给 legacyImport 的 ATTACH 流程处理。
 */
export const LEGACY_TRANSFER_FILES = Object.freeze([
  "stepview-agent.sqlite",
  "agent-memory.sqlite",
  "user-profile.sqlite",
]);

/** 画布里有没有用户数据。用于判断“导入目标是不是空的”，空画布不该要求二次确认。 */
export function boardHasContent(board) {
  const normalized = normalizeBoard(board);
  const hasCollections = [normalized.tasks, normalized.stickers, normalized.links, normalized.branches, normalized.achievements]
    .some((items) => items.length > 0);
  return hasCollections || Boolean(normalized.agentMemory && Object.keys(normalized.agentMemory).length > 0);
}

function readBoardFromDatabase({ dataDir, logger }) {
  const dbPath = path.join(dataDir, ACCOUNT_DB_FILE);
  if (!fs.existsSync(dbPath)) return null;

  let connection = null;
  try {
    // 只读源库：不跑迁移，避免为了“导入”反而改动用户原来的数据目录。
    connection = createConnection({ dbPath, fsApi: fs });
    if (!connection.tableExists("board_documents")) return null;
    return createBoardRepository({ connection }).readBoard();
  } catch (error) {
    logger.warn?.(`读取源账号库失败，改用旧 JSON 文件：${dbPath}`, error);
    return null;
  } finally {
    connection?.close?.();
  }
}

/**
 * 从某个数据目录里读一份画布快照。
 *
 * 只读，不建库、不改文件：优先读账号库，库里没有画布时回退到
 * stepview-board.json / stepview-board.backup.json。用于导入个人数据前先把源画布取出来。
 */
export async function readBoardSnapshot({ dataDir, logger = console } = {}) {
  if (!dataDir) return null;
  const stored = readBoardFromDatabase({ dataDir, logger });
  if (stored) return stored;
  return readBoardExportFile({ dataDir, logger });
}

/**
 * 把源目录里的旧数据库文件复制进目标账号目录。
 *
 * 复制而不移动：源数据必须原样留在用户原来的数据目录里。
 * 连同 -wal / -shm 一起复制，否则写进 WAL 但还没回主文件的数据会丢。
 */
export function stageLegacyDatabaseFiles({ sourceDir, targetDir, fsApi = fs, files = LEGACY_TRANSFER_FILES } = {}) {
  if (!sourceDir || !targetDir) throw new Error("stageLegacyDatabaseFiles requires both sourceDir and targetDir.");

  const staged = [];
  for (const file of files) {
    const sourcePath = path.join(sourceDir, file);
    if (!fsApi.existsSync(sourcePath)) continue;
    fsApi.mkdirSync(targetDir, { recursive: true });
    fsApi.copyFileSync(sourcePath, path.join(targetDir, file));
    for (const suffix of ["-wal", "-shm"]) {
      if (fsApi.existsSync(`${sourcePath}${suffix}`)) {
        fsApi.copyFileSync(`${sourcePath}${suffix}`, path.join(targetDir, `${file}${suffix}`));
      }
    }
    staged.push(file);
  }
  return staged;
}
