import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_AGENT_JOURNAL,
  appendAgentTurn,
  applySlidingWindow,
  createAgentJournalStorage,
  updateAgentTurn,
} from "../electron/agentJournalStorage.js";

function makeTurn(index) {
  return {
    id: `turn-${index}`,
    userText: `用户问题 ${index}`,
    assistantText: `助手回答 ${index}`,
    scopeId: "global",
    route: { type: "global" },
    source: "local",
    createdAt: `2026-05-30T10:${String(index).padStart(2, "0")}:00.000Z`,
  };
}

describe("agent journal storage", () => {
  let tempDir;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  async function makeStore(options = {}) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-agent-journal-"));
    return createAgentJournalStorage({ dataDir: tempDir, ...options });
  }

  it("returns an empty journal when no files exist", async () => {
    const storage = await makeStore();

    await expect(storage.readJournal()).resolves.toEqual(EMPTY_AGENT_JOURNAL);
  });

  it("loads the backup file when the primary journal file is corrupt", async () => {
    const storage = await makeStore();
    const journal = appendAgentTurn(EMPTY_AGENT_JOURNAL, makeTurn(1), {
      now: "2026-05-30T11:00:00.000Z",
      memory: { userStateSnapshot: { activeTaskLineIds: ["task-1"] } },
    });

    await writeFile(path.join(tempDir, "stepview-agent-journal.json"), "{broken", "utf8");
    await writeFile(path.join(tempDir, "stepview-agent-journal.backup.json"), JSON.stringify(journal, null, 2), "utf8");

    await expect(storage.readJournal()).resolves.toEqual(journal);
  });

  it("writes via a temporary file and keeps a recoverable backup", async () => {
    const storage = await makeStore();
    const first = appendAgentTurn(EMPTY_AGENT_JOURNAL, makeTurn(1), { now: "2026-05-30T11:00:00.000Z" });
    const second = appendAgentTurn(first, makeTurn(2), { now: "2026-05-30T11:01:00.000Z" });

    await storage.writeJournal(first);
    await storage.writeJournal(second);

    await expect(readFile(path.join(tempDir, "stepview-agent-journal.json"), "utf8").then(JSON.parse)).resolves.toEqual(second);
    await expect(readFile(path.join(tempDir, "stepview-agent-journal.backup.json"), "utf8").then(JSON.parse)).resolves.toEqual(first);
  });

  it("keeps raw turns while moving the oldest five into the rolling summary", () => {
    const journal = Array.from({ length: 21 }, (_, index) => makeTurn(index + 1)).reduce(
      (current, turn, index) => appendAgentTurn(current, turn, { now: `2026-05-30T12:${String(index).padStart(2, "0")}:00.000Z` }),
      EMPTY_AGENT_JOURNAL,
    );

    expect(journal.rawTurns).toHaveLength(21);
    expect(journal.sessionState.recentTurnIds).toEqual(Array.from({ length: 16 }, (_, index) => `turn-${index + 6}`));
    expect(journal.rollingSummary.coveredTurnIds).toEqual(["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]);
  });

  it("updates an existing turn without appending a duplicate", () => {
    const first = appendAgentTurn(EMPTY_AGENT_JOURNAL, makeTurn(1), { now: "2026-05-30T11:00:00.000Z" });
    const updated = updateAgentTurn(first, { ...makeTurn(1), assistantText: "OpenAI 增强回答", source: "openai", model: "gpt-5.1" }, {
      now: "2026-05-30T11:01:00.000Z",
    });

    expect(updated.rawTurns).toHaveLength(1);
    expect(updated.rawTurns[0]).toMatchObject({
      id: "turn-1",
      assistantText: "OpenAI 增强回答",
      source: "openai",
      model: "gpt-5.1",
    });
  });

  it("continues saving after one queued write fails", async () => {
    const failingFs = {
      mkdir: async () => {},
      readFile: async () => JSON.stringify(EMPTY_AGENT_JOURNAL),
      copyFile: async () => {},
      rename: async () => {},
      writeFile: async () => {
        throw new Error("disk unavailable");
      },
    };
    const storage = await makeStore({ fsApi: failingFs });

    await expect(storage.writeJournal(appendAgentTurn(EMPTY_AGENT_JOURNAL, makeTurn(1)))).rejects.toThrow("disk unavailable");

    storage.setFsApi({
      mkdir: async () => {},
      readFile: async () => JSON.stringify(EMPTY_AGENT_JOURNAL),
      copyFile: async () => {},
      rename: async () => {},
      writeFile: async () => {},
    });

    await expect(storage.writeJournal(appendAgentTurn(EMPTY_AGENT_JOURNAL, makeTurn(2)))).resolves.toMatchObject({ ok: true });
  });

  it("keeps UTF-8 journal data intact when sliding the window", () => {
    const journal = appendAgentTurn(EMPTY_AGENT_JOURNAL, {
      ...makeTurn(1),
      userText: "你好，世界",
      assistantText: "已经保存为 UTF-8 JSON",
    });

    const slid = applySlidingWindow(journal);

    expect(slid.rawTurns[0].userText).toBe("你好，世界");
    expect(slid.rawTurns[0].assistantText).toBe("已经保存为 UTF-8 JSON");
  });
});
