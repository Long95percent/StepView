import defaultFs from "node:fs/promises";
import path from "node:path";
import { normalizeBoard } from "../../src/progressCore.js";

export const BOARD_EXPORT_FILE = "stepview-board.json";
export const BOARD_EXPORT_BACKUP_FILE = "stepview-board.backup.json";

export function boardFilePath(dataDir) {
  return path.join(dataDir, BOARD_EXPORT_FILE);
}

export function boardBackupPath(dataDir) {
  return path.join(dataDir, BOARD_EXPORT_BACKUP_FILE);
}

/**
 * 读画布导出文件：主文件读不出来就回退到备份文件，两个都没有返回 null。
 *
 * 画布落库之后，这份 JSON 只是导出镜像；它仍然承担“首次启动导入旧数据”的职责，
 * 所以读取顺序必须和重构前完全一致。
 */
export async function readBoardExportFile({ dataDir, fsApi = defaultFs, logger = console } = {}) {
  if (!dataDir) return null;
  for (const filePath of [boardFilePath(dataDir), boardBackupPath(dataDir)]) {
    try {
      const text = await fsApi.readFile(filePath, "utf8");
      return normalizeBoard(JSON.parse(text));
    } catch (error) {
      if (error.code !== "ENOENT") logger.error?.(`读取画布文件失败：${filePath}`, error);
    }
  }
  return null;
}

/**
 * 写画布导出文件。
 *
 * 语义与重构前一致：先把当前主文件轮换成备份文件，再用临时文件原子替换主文件，
 * 保证任何时刻磁盘上都有一份可用的画布。
 */
export async function writeBoardExportFile({ dataDir, board, fsApi = defaultFs } = {}) {
  if (!dataDir) throw new Error("writeBoardExportFile requires a dataDir.");
  const nextBoard = normalizeBoard(board);
  const boardFile = boardFilePath(dataDir);
  const tempFile = `${boardFile}.tmp`;

  await fsApi.mkdir(dataDir, { recursive: true });
  try {
    await fsApi.copyFile(boardFile, boardBackupPath(dataDir));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await fsApi.writeFile(tempFile, JSON.stringify(nextBoard, null, 2), "utf8");
  await fsApi.rename(tempFile, boardFile);
  return boardFile;
}
