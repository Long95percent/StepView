import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardStorage } from "../electron/boardStorage.js";

const emptyBoard = { tasks: [], stickers: [], links: [], branches: [], achievements: [], agentMemory: null };

describe("board storage", () => {
  let tempDir;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function makeStore(options = {}) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-storage-"));
    return createBoardStorage({ dataDir: tempDir, ...options });
  }

  it("loads the backup file when the primary board file is corrupt", async () => {
    const storage = await makeStore();
    const board = { tasks: [{ id: "task-1" }], stickers: [], links: [], branches: [], achievements: [], agentMemory: null };

    await writeFile(path.join(tempDir, "stepview-board.json"), "{broken", "utf8");
    await writeFile(path.join(tempDir, "stepview-board.backup.json"), JSON.stringify(board), "utf8");

    await expect(storage.readBoard()).resolves.toEqual({ ...board, updatedAt: null });
  });

  it("writes via a temporary file and keeps a recoverable backup", async () => {
    const storage = await makeStore();
    const first = { tasks: [{ id: "task-1" }], stickers: [], links: [], branches: [], achievements: [], agentMemory: null, updatedAt: "2026-05-18T09:30:00.000Z" };
    const second = { tasks: [{ id: "task-2" }], stickers: [], links: [], branches: [], achievements: [], agentMemory: null, updatedAt: "2026-05-19T09:30:00.000Z" };

    await storage.writeBoard(first);
    await storage.writeBoard(second);

    await expect(readFile(path.join(tempDir, "stepview-board.json"), "utf8").then(JSON.parse)).resolves.toEqual(second);
    await expect(readFile(path.join(tempDir, "stepview-board.backup.json"), "utf8").then(JSON.parse)).resolves.toEqual(first);
  });

  it("continues saving after one queued write fails", async () => {
    const failingFs = {
      mkdir: async () => {},
      readFile: async () => JSON.stringify(emptyBoard),
      copyFile: async () => {},
      rename: async () => {},
      writeFile: async () => {
        throw new Error("disk unavailable");
      },
    };
    const storage = await makeStore({ fsApi: failingFs });

    await expect(storage.writeBoard({ tasks: [{ id: "task-1" }] })).rejects.toThrow("disk unavailable");

    storage.setFsApi({
      mkdir: async () => {},
      readFile: async () => JSON.stringify(emptyBoard),
      copyFile: async () => {},
      rename: async () => {},
      writeFile: async () => {},
    });

    await expect(storage.writeBoard({ tasks: [{ id: "task-2" }] })).resolves.toMatchObject({ ok: true });
  });
});
