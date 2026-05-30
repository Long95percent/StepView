# Agent Journal Rolling Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Agent Journal that persists raw Agent conversation turns before updating the rolling summary and session prompt state.

**Architecture:** Keep `stepview-board.json` as the canvas fact store and introduce `stepview-agent-journal.json` as the conversation fact store. The renderer builds turn payloads, Electron persists them through a dedicated journal storage module, and the sliding-window summary is updated inside the storage layer after each append/update. Existing `agentMemory` remains a derived snapshot from the live board.

**Tech Stack:** React, Electron IPC, Node `fs/promises`, Vite, Vitest, plain JavaScript.

---

## File Structure

- Create `src/agentTurn.js`: pure renderer-safe helpers for building local turns and merging OpenAI success/failure results into the same turn.
- Create `tests/agentTurn.test.js`: covers turn shape, OpenAI update behavior, and local fallback behavior.
- Create `electron/agentJournalStorage.js`: normalizes journal files, appends/updates turns, applies the 20/5 sliding window, writes UTF-8 JSON atomically with backup recovery.
- Create `tests/agentJournalStorage.test.js`: covers storage recovery, append/update, sliding window, summary coverage, and queued write recovery.
- Modify `electron/main.js`: instantiate journal storage, add `agent:*` IPC handlers, flush journal writes on quit.
- Modify `electron/preload.js`: expose journal IPC methods to the renderer.
- Modify `src/main.jsx`: call journal IPC from `askAgent` so raw turns are persisted before the final Agent answer is displayed.
- Modify `docs/worklog/worklog-5-30.txt`: record each implementation milestone.

---

### Task 1: Add Renderer Turn Payload Helpers

**Files:**
- Create: `src/agentTurn.js`
- Create: `tests/agentTurn.test.js`
- Modify: `docs/worklog/worklog-5-30.txt`

- [ ] **Step 1: Write the failing tests**

Create `tests/agentTurn.test.js`:

```js
import { describe, expect, it } from "vitest";
import { buildAgentTurn, markAgentTurnOpenAI, markAgentTurnFallback } from "../src/agentTurn";

describe("agent turn payload helpers", () => {
  it("builds a local turn from the local agent response", () => {
    const turn = buildAgentTurn({
      id: "turn-1",
      question: "怎么看这条线？",
      scopeId: "task:task-1",
      localResponse: {
        answer: "这条线还在推进中。",
        route: { type: "task_line", taskLineId: "task-1" },
      },
      createdAt: "2026-05-30T11:00:00.000Z",
    });

    expect(turn).toEqual({
      id: "turn-1",
      userText: "怎么看这条线？",
      assistantText: "这条线还在推进中。",
      scopeId: "task:task-1",
      route: { type: "task_line", taskLineId: "task-1" },
      source: "local",
      createdAt: "2026-05-30T11:00:00.000Z",
    });
  });

  it("updates the same turn after OpenAI succeeds", () => {
    const localTurn = buildAgentTurn({
      id: "turn-1",
      question: "做一次增强回答",
      scopeId: "global",
      localResponse: { answer: "本地回答", route: { type: "global" } },
      createdAt: "2026-05-30T11:00:00.000Z",
    });

    const updated = markAgentTurnOpenAI(localTurn, {
      text: "增强回答",
      model: "gpt-5.1",
    });

    expect(updated).toEqual({
      ...localTurn,
      assistantText: "增强回答",
      source: "openai",
      model: "gpt-5.1",
    });
  });

  it("marks the same turn as local fallback after OpenAI fails", () => {
    const localTurn = buildAgentTurn({
      id: "turn-1",
      question: "增强失败怎么办",
      scopeId: "global",
      localResponse: { answer: "本地回答", route: { type: "global" } },
      createdAt: "2026-05-30T11:00:00.000Z",
    });

    const fallback = markAgentTurnFallback(localTurn);

    expect(fallback).toEqual({
      ...localTurn,
      source: "local-fallback",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/agentTurn.test.js --pool=threads
```

Expected: FAIL because `src/agentTurn.js` does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/agentTurn.js`:

```js
export function buildAgentTurn({ id, question, scopeId, localResponse, createdAt = new Date().toISOString() }) {
  return {
    id,
    userText: String(question || "").trim(),
    assistantText: String(localResponse?.answer || ""),
    scopeId: scopeId || "global",
    route: localResponse?.route || { type: "global" },
    source: "local",
    createdAt,
  };
}

export function markAgentTurnOpenAI(turn, result = {}) {
  const model = String(result.model || "").trim();
  return {
    ...turn,
    assistantText: String(result.text || "").trim() || turn.assistantText,
    source: "openai",
    ...(model ? { model } : {}),
  };
}

export function markAgentTurnFallback(turn) {
  return { ...turn, source: "local-fallback" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run tests/agentTurn.test.js --pool=threads
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Update worklog**

Append to `docs/worklog/worklog-5-30.txt`:

```text
[2026-05-30 9] 已完成 Agent turn payload helper 计划任务：新增 renderer-safe 的 turn 构建/更新边界，确保 OpenAI 成功或失败都更新同一轮原始对话记录，不重复追加。
```

- [ ] **Step 6: Commit**

Run:

```bash
git add src/agentTurn.js tests/agentTurn.test.js docs/worklog/worklog-5-30.txt
git commit -m "feat: add agent turn payload helpers"
```

---

### Task 2: Add Agent Journal Storage and Sliding Window

**Files:**
- Create: `electron/agentJournalStorage.js`
- Create: `tests/agentJournalStorage.test.js`
- Modify: `docs/worklog/worklog-5-30.txt`

- [ ] **Step 1: Write failing storage and sliding-window tests**

Create `tests/agentJournalStorage.test.js`:

```js
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendAgentTurn,
  applySlidingWindow,
  createAgentJournalStorage,
  EMPTY_AGENT_JOURNAL,
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

  it("normalizes an empty missing journal without creating demo data", async () => {
    const storage = await makeStore();

    await expect(storage.readJournal()).resolves.toEqual(EMPTY_AGENT_JOURNAL);
  });

  it("loads the backup file when the primary journal file is corrupt", async () => {
    const storage = await makeStore();
    const journal = appendAgentTurn(EMPTY_AGENT_JOURNAL, makeTurn(1), {
      now: "2026-05-30T11:00:00.000Z",
      memory: { userStateSnapshot: { activeTaskLineIds: ["task-1"], currentFocusTaskLineId: "task-1", emotionalTone: "中性记录" } },
    });

    await writeFile(path.join(tempDir, "stepview-agent-journal.json"), "{broken", "utf8");
    await writeFile(path.join(tempDir, "stepview-agent-journal.backup.json"), JSON.stringify(journal), "utf8");

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

  it("keeps all raw turns but moves the oldest five out of the recent prompt window", () => {
    const journal = Array.from({ length: 21 }, (_, index) => makeTurn(index + 1)).reduce(
      (current, turn, index) => appendAgentTurn(current, turn, { now: `2026-05-30T12:${String(index).padStart(2, "0")}:00.000Z` }),
      EMPTY_AGENT_JOURNAL,
    );

    expect(journal.rawTurns).toHaveLength(21);
    expect(journal.sessionState.recentTurnIds).toEqual(Array.from({ length: 16 }, (_, index) => `turn-${index + 6}`));
    expect(journal.rollingSummary.coveredTurnIds).toEqual(["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]);
    expect(journal.rollingSummary.text.length).toBeLessThanOrEqual(200);
  });

  it("updates an existing turn without appending a duplicate", () => {
    const first = appendAgentTurn(EMPTY_AGENT_JOURNAL, makeTurn(1), { now: "2026-05-30T11:00:00.000Z" });
    const updated = updateAgentTurn(first, { ...makeTurn(1), assistantText: "OpenAI 增强回答", source: "openai", model: "gpt-5.1" }, {
      now: "2026-05-30T11:01:00.000Z",
    });

    expect(updated.rawTurns).toHaveLength(1);
    expect(updated.rawTurns[0]).toMatchObject({ id: "turn-1", assistantText: "OpenAI 增强回答", source: "openai", model: "gpt-5.1" });
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

  it("can rebuild session state from existing raw turns without deleting old records", () => {
    const stale = {
      ...EMPTY_AGENT_JOURNAL,
      rawTurns: Array.from({ length: 23 }, (_, index) => makeTurn(index + 1)),
      sessionState: { ...EMPTY_AGENT_JOURNAL.sessionState, recentTurnIds: [] },
    };

    const refreshed = applySlidingWindow(stale, { now: "2026-05-30T13:00:00.000Z" });

    expect(refreshed.rawTurns).toHaveLength(23);
    expect(refreshed.sessionState.recentTurnIds).toEqual(Array.from({ length: 18 }, (_, index) => `turn-${index + 6}`));
    expect(refreshed.rollingSummary.coveredTurnIds).toEqual(["turn-1", "turn-2", "turn-3", "turn-4", "turn-5"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run tests/agentJournalStorage.test.js --pool=threads
```

Expected: FAIL because `electron/agentJournalStorage.js` does not exist.

- [ ] **Step 3: Implement journal storage and sliding-window helpers**

Create `electron/agentJournalStorage.js`:

```js
import defaultFs from "node:fs/promises";
import path from "node:path";

export const AGENT_JOURNAL_VERSION = 1;
export const RECENT_TURN_LIMIT = 20;
export const SLIDE_BATCH_SIZE = 5;
export const SUMMARY_LIMIT = 200;

const JOURNAL_FILE = "stepview-agent-journal.json";
const BACKUP_FILE = "stepview-agent-journal.backup.json";
const TEMP_FILE = "stepview-agent-journal.json.tmp";

export const EMPTY_AGENT_JOURNAL = {
  version: AGENT_JOURNAL_VERSION,
  rawTurns: [],
  rollingSummary: { text: "", coveredTurnIds: [], updatedAt: null },
  sessionState: {
    recentTurnIds: [],
    latestSummaryText: "",
    activeTaskLineIds: [],
    currentFocusTaskLineId: null,
    emotionalTone: "暂无日记信号",
    updatedAt: null,
  },
  updatedAt: null,
};

function compactText(value, maxLength = SUMMARY_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeTurn(turn) {
  if (!turn || typeof turn !== "object") throw new Error("Invalid agent turn.");
  const id = String(turn.id || "").trim();
  const userText = String(turn.userText || "").trim();
  const assistantText = String(turn.assistantText || "").trim();
  if (!id || !userText) throw new Error("Agent turn requires id and userText.");
  return {
    id,
    userText,
    assistantText,
    scopeId: String(turn.scopeId || "global"),
    route: turn.route && typeof turn.route === "object" ? turn.route : { type: "global" },
    source: ["local", "openai", "local-fallback"].includes(turn.source) ? turn.source : "local",
    ...(turn.model ? { model: String(turn.model) } : {}),
    createdAt: typeof turn.createdAt === "string" ? turn.createdAt : new Date().toISOString(),
  };
}

export function normalizeAgentJournal(value) {
  const rollingSummary = value?.rollingSummary && typeof value.rollingSummary === "object" ? value.rollingSummary : {};
  const sessionState = value?.sessionState && typeof value.sessionState === "object" ? value.sessionState : {};
  return {
    version: AGENT_JOURNAL_VERSION,
    rawTurns: Array.isArray(value?.rawTurns) ? value.rawTurns.map(normalizeTurn) : [],
    rollingSummary: {
      text: compactText(rollingSummary.text),
      coveredTurnIds: Array.isArray(rollingSummary.coveredTurnIds) ? rollingSummary.coveredTurnIds.map(String) : [],
      updatedAt: typeof rollingSummary.updatedAt === "string" ? rollingSummary.updatedAt : null,
    },
    sessionState: {
      recentTurnIds: Array.isArray(sessionState.recentTurnIds) ? sessionState.recentTurnIds.map(String) : [],
      latestSummaryText: compactText(sessionState.latestSummaryText),
      activeTaskLineIds: Array.isArray(sessionState.activeTaskLineIds) ? sessionState.activeTaskLineIds.map(String) : [],
      currentFocusTaskLineId: typeof sessionState.currentFocusTaskLineId === "string" ? sessionState.currentFocusTaskLineId : null,
      emotionalTone: typeof sessionState.emotionalTone === "string" ? sessionState.emotionalTone : "暂无日记信号",
      updatedAt: typeof sessionState.updatedAt === "string" ? sessionState.updatedAt : null,
    },
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

function summarizeMovedTurns(previousText, movedTurns) {
  const movedText = movedTurns
    .map((turn) => `用户：${turn.userText} 助手：${turn.assistantText}`)
    .join(" ");
  return compactText([previousText, movedText].filter(Boolean).join(" "));
}

function buildSessionState(journal, recentTurnIds, now, memory) {
  const snapshot = memory?.userStateSnapshot || {};
  return {
    recentTurnIds,
    latestSummaryText: journal.rollingSummary.text,
    activeTaskLineIds: Array.isArray(snapshot.activeTaskLineIds) ? snapshot.activeTaskLineIds : [],
    currentFocusTaskLineId: snapshot.currentFocusTaskLineId || null,
    emotionalTone: snapshot.emotionalTone || "暂无日记信号",
    updatedAt: now,
  };
}

export function applySlidingWindow(journal, options = {}) {
  const now = options.now || new Date().toISOString();
  const normalized = normalizeAgentJournal(journal);
  const covered = new Set(normalized.rollingSummary.coveredTurnIds);
  let candidateIds = normalized.rawTurns.map((turn) => turn.id).filter((id) => !covered.has(id));
  const movedIds = [];

  while (candidateIds.length > RECENT_TURN_LIMIT) {
    movedIds.push(...candidateIds.slice(0, SLIDE_BATCH_SIZE));
    candidateIds = candidateIds.slice(SLIDE_BATCH_SIZE);
  }

  const movedIdSet = new Set(movedIds);
  const movedTurns = normalized.rawTurns.filter((turn) => movedIdSet.has(turn.id));
  const rollingSummary = movedTurns.length > 0
    ? {
        text: summarizeMovedTurns(normalized.rollingSummary.text, movedTurns),
        coveredTurnIds: [...normalized.rollingSummary.coveredTurnIds, ...movedIds],
        updatedAt: now,
      }
    : normalized.rollingSummary;
  const nextJournal = { ...normalized, rollingSummary, updatedAt: now };

  return {
    ...nextJournal,
    sessionState: buildSessionState(nextJournal, candidateIds, now, options.memory),
  };
}

export function appendAgentTurn(journal, turn, options = {}) {
  const normalized = normalizeAgentJournal(journal);
  const nextTurn = normalizeTurn(turn);
  const rawTurns = [...normalized.rawTurns.filter((candidate) => candidate.id !== nextTurn.id), nextTurn];
  return applySlidingWindow({ ...normalized, rawTurns }, options);
}

export function updateAgentTurn(journal, turn, options = {}) {
  const normalized = normalizeAgentJournal(journal);
  const nextTurn = normalizeTurn(turn);
  const found = normalized.rawTurns.some((candidate) => candidate.id === nextTurn.id);
  const rawTurns = found
    ? normalized.rawTurns.map((candidate) => (candidate.id === nextTurn.id ? nextTurn : candidate))
    : [...normalized.rawTurns, nextTurn];
  return applySlidingWindow({ ...normalized, rawTurns }, options);
}

async function readJsonFile(fsApi, filePath) {
  const text = await fsApi.readFile(filePath, "utf8");
  return normalizeAgentJournal(JSON.parse(text));
}

export function createAgentJournalStorage({ dataDir, fsApi = defaultFs }) {
  let currentFsApi = fsApi;
  let writeQueue = Promise.resolve();

  const journalPath = () => path.join(dataDir, JOURNAL_FILE);
  const backupPath = () => path.join(dataDir, BACKUP_FILE);
  const tempPath = () => path.join(dataDir, TEMP_FILE);

  async function readJournal() {
    try {
      return await readJsonFile(currentFsApi, journalPath());
    } catch (primaryError) {
      try {
        return await readJsonFile(currentFsApi, backupPath());
      } catch (backupError) {
        if (primaryError.code !== "ENOENT") console.error("Failed to read agent journal", primaryError);
        if (backupError.code !== "ENOENT") console.error("Failed to read agent journal backup", backupError);
        return EMPTY_AGENT_JOURNAL;
      }
    }
  }

  async function writeJournalNow(journal) {
    const nextJournal = normalizeAgentJournal(journal);
    await currentFsApi.mkdir(dataDir, { recursive: true });
    try {
      await currentFsApi.copyFile(journalPath(), backupPath());
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await currentFsApi.writeFile(tempPath(), JSON.stringify(nextJournal, null, 2), "utf8");
    await currentFsApi.rename(tempPath(), journalPath());
    return { ok: true, path: journalPath() };
  }

  function writeJournal(journal) {
    const write = writeQueue.catch(() => undefined).then(() => writeJournalNow(journal));
    writeQueue = write.catch(() => undefined);
    return write;
  }

  async function appendTurn(turn, options = {}) {
    const journal = await readJournal();
    const nextJournal = appendAgentTurn(journal, turn, options);
    await writeJournal(nextJournal);
    return nextJournal;
  }

  async function updateTurn(turn, options = {}) {
    const journal = await readJournal();
    const nextJournal = updateAgentTurn(journal, turn, options);
    await writeJournal(nextJournal);
    return nextJournal;
  }

  function flushWrites() {
    return writeQueue;
  }

  function setFsApi(nextFsApi) {
    currentFsApi = nextFsApi;
  }

  return { readJournal, writeJournal, appendTurn, updateTurn, flushWrites, setFsApi, journalPath, backupPath };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run tests/agentJournalStorage.test.js --pool=threads
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Update worklog**

Append to `docs/worklog/worklog-5-30.txt`:

```text
[2026-05-30 10] 已完成 Agent Journal 存储与滑窗核心：原始 turn 保留在 rawTurns，prompt 窗口最多 20 轮，超窗旧 5 轮合并进 rollingSummary，不删除原文，不写入 board。
```

- [ ] **Step 6: Commit**

Run:

```bash
git add electron/agentJournalStorage.js tests/agentJournalStorage.test.js docs/worklog/worklog-5-30.txt
git commit -m "feat: add agent journal storage"
```

---

### Task 3: Expose Agent Journal IPC

**Files:**
- Modify: `electron/main.js`
- Modify: `electron/preload.js`
- Modify: `docs/worklog/worklog-5-30.txt`

- [ ] **Step 1: Add the storage import and instance in `electron/main.js`**

Update the imports and storage setup:

```js
import { createBoardStorage } from "./boardStorage.js";
import { createAgentJournalStorage } from "./agentJournalStorage.js";

const boardStorage = createBoardStorage({ dataDir: app.getPath("userData") });
const agentJournalStorage = createAgentJournalStorage({ dataDir: app.getPath("userData") });
```

- [ ] **Step 2: Add IPC handlers in `electron/main.js`**

Add these handlers inside `app.whenReady().then(() => { ... })`, next to the board handlers:

```js
  ipcMain.handle("agent:load-journal", agentJournalStorage.readJournal);
  ipcMain.handle("agent:append-turn", (_event, request = {}) =>
    agentJournalStorage.appendTurn(request.turn, { memory: request.memory }),
  );
  ipcMain.handle("agent:update-turn", (_event, request = {}) =>
    agentJournalStorage.updateTurn(request.turn, { memory: request.memory }),
  );
```

- [ ] **Step 3: Flush journal writes on quit**

Update the `before-quit` handler:

```js
app.on("before-quit", (event) => {
  if (isQuittingAfterStorageFlush) return;
  event.preventDefault();
  Promise.all([boardStorage.flushWrites(), agentJournalStorage.flushWrites()]).finally(() => {
    isQuittingAfterStorageFlush = true;
    app.quit();
  });
});
```

- [ ] **Step 4: Expose preload bridge methods**

Update `electron/preload.js`:

```js
contextBridge.exposeInMainWorld("stepview", {
  loadBoard: () => ipcRenderer.invoke("board:load"),
  saveBoard: (board) => ipcRenderer.invoke("board:save", board),
  revealDataFile: () => ipcRenderer.invoke("board:reveal"),
  loadAgentJournal: () => ipcRenderer.invoke("agent:load-journal"),
  appendAgentTurn: (request) => ipcRenderer.invoke("agent:append-turn", request),
  updateAgentTurn: (request) => ipcRenderer.invoke("agent:update-turn", request),
  askOpenAI: (request) => ipcRenderer.invoke("ai:ask-openai", request),
});
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run tests/agentJournalStorage.test.js tests/boardStorage.test.js --pool=threads
```

Expected: PASS. This confirms storage behavior remains isolated from board storage.

- [ ] **Step 6: Update worklog**

Append to `docs/worklog/worklog-5-30.txt`:

```text
[2026-05-30 11] 已接入 Agent Journal IPC：主进程新增 load/append/update turn，preload 暴露给前端；退出前同时 flush board 与 journal，两个存储仍保持分离。
```

- [ ] **Step 7: Commit**

Run:

```bash
git add electron/main.js electron/preload.js docs/worklog/worklog-5-30.txt
git commit -m "feat: expose agent journal ipc"
```

---

### Task 4: Persist Agent Turns From the Renderer

**Files:**
- Modify: `src/main.jsx`
- Modify: `docs/worklog/worklog-5-30.txt`

- [ ] **Step 1: Import turn helpers**

Update the imports near the existing `agentMemory` import:

```js
import { answerAgentQuestion, buildAgentMemory, getAgentScopeOptions } from "./agentMemory";
import { buildAgentTurn, markAgentTurnFallback, markAgentTurnOpenAI } from "./agentTurn";
```

- [ ] **Step 2: Add a renderer-safe turn id helper**

Add near the existing constants:

```js
const makeAgentTurnId = () => `turn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
```

- [ ] **Step 3: Persist the local turn before displaying the answer**

Replace the beginning of `askAgent` with this sequence:

```js
  const askAgent = async (event) => {
    event.preventDefault();
    const localResponse = answerAgentQuestion(board, agentQuestion, agentScopeId);
    const localTurn = buildAgentTurn({
      id: makeAgentTurnId(),
      question: agentQuestion,
      scopeId: agentScopeId,
      localResponse,
    });

    try {
      await desktopApi?.appendAgentTurn?.({ turn: localTurn, memory: localResponse.memory });
    } catch (error) {
      console.error("Failed to save agent turn", error);
      setToast("Agent 记录保存失败，回答仍保留在当前界面。");
    }

    setAgentAnswer(localResponse);
    updateBoard((current) => ({ ...current, agentMemory: localResponse.memory }));
```

Keep the existing local-mode return immediately after this block:

```js
    if (agentMode !== "openai") return;
```

- [ ] **Step 4: Update the same turn after OpenAI succeeds**

Inside the OpenAI success branch, after `const result = await desktopApi.askOpenAI(...)`, add:

```js
      const openAiTurn = markAgentTurnOpenAI(localTurn, result);
      try {
        await desktopApi?.updateAgentTurn?.({ turn: openAiTurn, memory: localResponse.memory });
      } catch (journalError) {
        console.error("Failed to update agent turn", journalError);
        setToast("OpenAI 回答已显示，但 Agent Journal 更新失败。");
      }
```

Then keep setting `agentAnswer` to the OpenAI result.

- [ ] **Step 5: Mark the same turn as fallback after OpenAI fails**

Inside the OpenAI catch block, before `setAgentAnswer({ ...localResponse, ... })`, add:

```js
      const fallbackTurn = markAgentTurnFallback(localTurn);
      try {
        await desktopApi?.updateAgentTurn?.({ turn: fallbackTurn, memory: localResponse.memory });
      } catch (journalError) {
        console.error("Failed to mark agent turn fallback", journalError);
      }
```

- [ ] **Step 6: Confirm no unused local variable was introduced**

The `updateBoard` call remains the existing path for keeping `agentMemory` fresh. Do not add a separate board snapshot variable for the Agent Journal flow.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run tests/agentTurn.test.js tests/agentMemory.test.js --pool=threads
```

Expected: PASS. This confirms turn payload behavior and existing Agent memory behavior.

- [ ] **Step 8: Update worklog**

Append to `docs/worklog/worklog-5-30.txt`:

```text
[2026-05-30 12] 已将前端 Agent 提问接入 Journal：本地回答先 append 原始 turn，OpenAI 成功/失败都 update 同一 turn；board 仍只通过 agentMemory 派生快照更新，不保存对话历史。
```

- [ ] **Step 9: Commit**

Run:

```bash
git add src/main.jsx docs/worklog/worklog-5-30.txt
git commit -m "feat: persist agent turns from renderer"
```

---

### Task 5: Full Verification and Board Isolation Check

**Files:**
- Modify: `docs/worklog/worklog-5-30.txt`

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all Vitest suites pass.

- [ ] **Step 2: Build the app**

Run:

```bash
npm run build
```

Expected: Vite build succeeds.

- [ ] **Step 3: Confirm board storage did not gain raw turn history**

Run:

```bash
rg -n "rawTurns|rollingSummary|agent:append-turn|stepview-agent-journal" src electron tests
```

Expected:

- `rawTurns` and `rollingSummary` appear in `electron/agentJournalStorage.js` and journal tests.
- `agent:append-turn` appears in `electron/main.js` and `electron/preload.js`.
- No `rawTurns` or `rollingSummary` fields are added to `src/progressCore.js` or `electron/boardStorage.js`.

- [ ] **Step 4: Confirm no destructive demo/sample logic exists**

Run:

```bash
rg -n "demo|sample|tutorial|INITIAL_BOARD|clearBoard" src electron tests
```

Expected:

- No new demo/sample import path writes to board.
- Existing tutorial UI remains non-destructive.
- Existing `clearBoard` still requires explicit confirmation and is unrelated to Agent Journal.

- [ ] **Step 5: Update worklog**

Append to `docs/worklog/worklog-5-30.txt`:

```text
[2026-05-30 13] 已完成 Agent Journal 全量验证：测试与构建通过；rawTurns/rollingSummary 仅存在于独立 journal 存储链路，未写入 boardStorage/progressCore；未新增 demo/sample 覆盖逻辑。
```

- [ ] **Step 6: Commit verification log**

Run:

```bash
git add docs/worklog/worklog-5-30.txt
git commit -m "docs: record agent journal verification"
```

---

## Self-Review

- Spec coverage: Tasks 1-4 cover raw turn creation, append/update, separate journal storage, rolling summary, IPC, and renderer persistence. Task 5 covers board isolation and no demo/sample overwrite logic.
- Placeholder scan: This plan intentionally contains no unfinished placeholder markers and no generic error-handling step without concrete code.
- Type consistency: Turn fields are consistently `id`, `userText`, `assistantText`, `scopeId`, `route`, `source`, `model`, and `createdAt`. Journal fields are consistently `rawTurns`, `rollingSummary`, `sessionState`, and `updatedAt`.
- Scope check: This plan does not implement Action Mode, Mem0, Redis, SQLite, deep analysis, or memory management UI; those remain separate future specs.
