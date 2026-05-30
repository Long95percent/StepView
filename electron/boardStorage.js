import defaultFs from "node:fs/promises";
import path from "node:path";

const EMPTY_BOARD = { tasks: [], stickers: [], links: [], branches: [], achievements: [], agentMemory: null };
const BOARD_FILE = "stepview-board.json";
const BACKUP_FILE = "stepview-board.backup.json";
const TEMP_FILE = "stepview-board.json.tmp";

function normalizeBoard(value) {
  return {
    tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    stickers: Array.isArray(value?.stickers) ? value.stickers : [],
    links: Array.isArray(value?.links) ? value.links : [],
    branches: Array.isArray(value?.branches) ? value.branches : [],
    achievements: Array.isArray(value?.achievements) ? value.achievements : [],
    agentMemory: value?.agentMemory && typeof value.agentMemory === "object" ? value.agentMemory : null,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

async function readJsonFile(fsApi, filePath) {
  const text = await fsApi.readFile(filePath, "utf8");
  return normalizeBoard(JSON.parse(text));
}

export function createBoardStorage({ dataDir, fsApi = defaultFs }) {
  let currentFsApi = fsApi;
  let writeQueue = Promise.resolve();

  const boardPath = () => path.join(dataDir, BOARD_FILE);
  const backupPath = () => path.join(dataDir, BACKUP_FILE);
  const tempPath = () => path.join(dataDir, TEMP_FILE);

  async function readBoard() {
    try {
      return await readJsonFile(currentFsApi, boardPath());
    } catch (primaryError) {
      try {
        return await readJsonFile(currentFsApi, backupPath());
      } catch (backupError) {
        if (primaryError.code !== "ENOENT") console.error("Failed to read board", primaryError);
        if (backupError.code !== "ENOENT") console.error("Failed to read board backup", backupError);
        return EMPTY_BOARD;
      }
    }
  }

  async function writeBoardNow(board) {
    const nextBoard = normalizeBoard(board);
    await currentFsApi.mkdir(dataDir, { recursive: true });

    try {
      await currentFsApi.copyFile(boardPath(), backupPath());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }

    await currentFsApi.writeFile(tempPath(), JSON.stringify(nextBoard, null, 2), "utf8");
    await currentFsApi.rename(tempPath(), boardPath());
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

  function setFsApi(nextFsApi) {
    currentFsApi = nextFsApi;
  }

  return { readBoard, writeBoard, flushWrites, setFsApi, boardPath, backupPath };
}
