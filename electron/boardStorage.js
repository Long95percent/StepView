import { normalizeBoard } from "../src/progressCore.js";
import { boardBackupPath, boardFilePath, readBoardExportFile, writeBoardExportFile } from "./db/boardExport.js";
import { openAccountDatabase } from "./db/index.js";
import { createBoardRepository } from "./db/repositories/boardRepository.js";

const EMPTY_BOARD = normalizeBoard(null);

/**
 * 画布存储的薄适配器。
 *
 * 数据唯一的权威副本在账号库的 board_documents 表里，读写都走 boardRepository；
 * stepview-board.json 只是数据库层维护的导出镜像，这里不再直接碰文件系统。
 *
 * 对外接口保持不变：readBoard / writeBoard / flushWrites / setFsApi / boardPath / backupPath。
 * fsApi 注入点保留给测试（模拟磁盘写失败），默认走数据库层的默认文件系统。
 */
export function createBoardStorage({ dataDir, repository = null, fsApi } = {}) {
  if (!dataDir) throw new Error("createBoardStorage requires a dataDir.");

  let currentFsApi = fsApi;
  let writeQueue = Promise.resolve();
  let activeRepository = repository;
  let ownedConnection = null;

  const boardPath = () => boardFilePath(dataDir);
  const backupPath = () => boardBackupPath(dataDir);

  /** 生产路径由 accountContext 注入仓储；只有独立使用时才自己开一个连接。 */
  function ensureRepository() {
    if (activeRepository) return activeRepository;
    ownedConnection = openAccountDatabase({ dataDir, importLegacy: false });
    activeRepository = createBoardRepository({ connection: ownedConnection });
    return activeRepository;
  }

  async function readBoard() {
    const store = ensureRepository();
    const stored = store.readBoard();
    if (stored) return stored;

    // 首次导入：库里还没有画布记录时读一次旧的 JSON 文件，只读不写，原文件保留。
    const legacy = await readBoardExportFile({ dataDir, fsApi: currentFsApi });
    if (!legacy) return EMPTY_BOARD;
    if (store.saveIfAbsent(legacy)) return legacy;
    // 导入期间被别的写操作抢先建好了记录，以库里的为准。
    return store.readBoard() || EMPTY_BOARD;
  }

  async function writeBoardNow(board) {
    const nextBoard = normalizeBoard(board);
    // 先落库再镜像：库是权威副本，镜像失败也只是文件落后一步，不会丢数据。
    ensureRepository().save(nextBoard);
    await writeBoardExportFile({ dataDir, board: nextBoard, fsApi: currentFsApi });
    return { ok: true, path: boardPath() };
  }

  function writeBoard(board) {
    const write = writeQueue.catch(() => undefined).then(() => writeBoardNow(board));
    writeQueue = write.catch(() => undefined);
    return write;
  }

  function flushWrites() {
    return writeQueue;
  }

  /** 显式导出：把库里的画布写成用户可读的 JSON 文件，返回文件路径。 */
  function exportBoard() {
    const exported = writeQueue.catch(() => undefined).then(async () =>
      writeBoardExportFile({ dataDir, board: await readBoard(), fsApi: currentFsApi }),
    );
    writeQueue = exported.catch(() => undefined);
    return exported;
  }

  function setFsApi(nextFsApi) {
    currentFsApi = nextFsApi;
  }

  /** 只关闭本适配器自己开的连接；外部注入的仓储由调用方负责关闭。 */
  function close() {
    if (!ownedConnection) return;
    ownedConnection.close();
    ownedConnection = null;
    activeRepository = null;
  }

  return { readBoard, writeBoard, flushWrites, exportBoard, setFsApi, close, boardPath, backupPath };
}
