import defaultFs from "node:fs/promises";
import path from "node:path";

const JOURNAL_FILE = "stepview-agent-journal.json";
const BACKUP_FILE = "stepview-agent-journal.backup.json";
const TEMP_FILE = "stepview-agent-journal.json.tmp";
const WINDOW_LIMIT = 20;
const SUMMARY_BATCH_SIZE = 5;

export const EMPTY_AGENT_JOURNAL = {
  rawTurns: [],
  rollingSummary: {
    text: "",
    coveredTurnIds: [],
    updatedAt: null,
  },
  sessionState: {
    recentTurnIds: [],
    memory: null,
    lastTurnId: null,
    updatedAt: null,
  },
  updatedAt: null,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeId(value) {
  return normalizeString(value).trim();
}

function normalizeTurn(value) {
  const turn = isPlainObject(value) ? { ...value } : {};
  const id = normalizeId(turn.id);

  return {
    ...turn,
    id,
    userText: normalizeString(turn.userText),
    assistantText: normalizeString(turn.assistantText),
    scopeId: normalizeString(turn.scopeId, "global") || "global",
    route: isPlainObject(turn.route) ? { ...turn.route } : { type: "global" },
    source: normalizeString(turn.source, "local") || "local",
    createdAt: normalizeString(turn.createdAt, null),
    ...(typeof turn.model === "string" && turn.model.trim() ? { model: turn.model.trim() } : {}),
  };
}

function normalizeRollingSummary(value) {
  const summary = isPlainObject(value) ? { ...value } : {};
  return {
    ...summary,
    text: normalizeString(summary.text),
    coveredTurnIds: Array.isArray(summary.coveredTurnIds)
      ? summary.coveredTurnIds.map((id) => normalizeId(id)).filter(Boolean)
      : [],
    updatedAt: normalizeString(summary.updatedAt, null),
  };
}

function normalizeSessionState(value) {
  const sessionState = isPlainObject(value) ? { ...value } : {};
  return {
    ...sessionState,
    recentTurnIds: Array.isArray(sessionState.recentTurnIds)
      ? sessionState.recentTurnIds.map((id) => normalizeId(id)).filter(Boolean)
      : [],
    memory: isPlainObject(sessionState.memory) ? { ...sessionState.memory } : null,
    lastTurnId: normalizeString(sessionState.lastTurnId, null),
    updatedAt: normalizeString(sessionState.updatedAt, null),
  };
}

function dedupeTurns(turns) {
  const byId = new Map();
  for (const turn of turns) {
    if (!turn.id) continue;
    if (!byId.has(turn.id)) {
      byId.set(turn.id, turn);
      continue;
    }
    const existing = byId.get(turn.id);
    byId.set(turn.id, { ...existing, ...turn });
  }
  return Array.from(byId.values());
}

function buildRollingSummaryText(turns) {
  if (!turns.length) return "";
  return turns
    .map((turn) => {
      const pieces = [turn.id];
      if (turn.userText) pieces.push(turn.userText);
      if (turn.assistantText) pieces.push(turn.assistantText);
      return pieces.join(" | ");
    })
    .join("\n");
}

function recalculateWindow(journal, options = {}) {
  const normalized = isPlainObject(journal) ? { ...journal } : {};
  const rawTurns = Array.isArray(normalized.rawTurns) ? dedupeTurns(normalized.rawTurns.map(normalizeTurn)) : [];
  const rollingSummary = normalizeRollingSummary(normalized.rollingSummary);
  const sessionState = normalizeSessionState(normalized.sessionState);
  const rawIds = rawTurns.map((turn) => turn.id).filter(Boolean);
  const coveredSet = new Set(rollingSummary.coveredTurnIds.filter((id) => rawIds.includes(id)));

  while (rawIds.length - coveredSet.size > WINDOW_LIMIT) {
    const nextBatch = rawIds.filter((id) => !coveredSet.has(id)).slice(0, SUMMARY_BATCH_SIZE);
    if (!nextBatch.length) break;
    for (const id of nextBatch) coveredSet.add(id);
  }

  const coveredTurnIds = rawIds.filter((id) => coveredSet.has(id));
  const recentTurnIds = rawIds.filter((id) => !coveredSet.has(id));
  const coveredTurns = rawTurns.filter((turn) => coveredSet.has(turn.id));
  const now = normalizeString(options.now, null);
  const memory = options.memory !== undefined ? (isPlainObject(options.memory) ? { ...options.memory } : null) : sessionState.memory;

  return {
    rawTurns,
    rollingSummary: {
      ...rollingSummary,
      text: buildRollingSummaryText(coveredTurns),
      coveredTurnIds,
      updatedAt: now ?? rollingSummary.updatedAt,
    },
    sessionState: {
      ...sessionState,
      recentTurnIds,
      memory,
      lastTurnId: rawIds.at(-1) ?? sessionState.lastTurnId,
      updatedAt: now ?? sessionState.updatedAt,
    },
    updatedAt: now ?? normalizeString(normalized.updatedAt, null),
  };
}

export function applySlidingWindow(journal, options = {}) {
  return recalculateWindow(journal, options);
}

export function normalizeAgentJournal(value) {
  const journal = isPlainObject(value) ? { ...value } : {};
  return recalculateWindow({
    rawTurns: Array.isArray(journal.rawTurns) ? journal.rawTurns : [],
    rollingSummary: journal.rollingSummary,
    sessionState: journal.sessionState,
    updatedAt: journal.updatedAt,
  });
}

export function appendAgentTurn(journal, turn, options = {}) {
  const current = normalizeAgentJournal(journal);
  const nextTurn = normalizeTurn(turn);
  if (!nextTurn.id) return current;

  const rawTurns = current.rawTurns.slice();
  const existingIndex = rawTurns.findIndex((entry) => entry.id === nextTurn.id);
  if (existingIndex >= 0) {
    rawTurns[existingIndex] = nextTurn;
  } else {
    rawTurns.push(nextTurn);
  }

  return applySlidingWindow(
    {
      ...current,
      rawTurns,
      sessionState: {
        ...current.sessionState,
        memory: options.memory !== undefined ? (isPlainObject(options.memory) ? { ...options.memory } : null) : current.sessionState.memory,
      },
    },
    options,
  );
}

export function updateAgentTurn(journal, turn, options = {}) {
  return appendAgentTurn(journal, turn, options);
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

  return {
    readJournal,
    writeJournal,
    appendTurn,
    updateTurn,
    flushWrites,
    setFsApi,
    journalPath,
    backupPath,
  };
}
