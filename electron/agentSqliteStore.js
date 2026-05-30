import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_FILE = "stepview-agent.sqlite";

function nowIso() {
  return new Date().toISOString();
}

function jsonString(value, fallback = {}) {
  return JSON.stringify(value ?? fallback);
}

function parseJson(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function rowToSession(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    taskLineId: row.task_line_id,
    title: row.title,
    personaText: row.persona_text,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTurn(row) {
  if (!row) return null;
  return {
    turnId: row.turn_id,
    sessionId: row.session_id,
    userText: row.user_text,
    assistantText: row.assistant_text,
    route: parseJson(row.route_json, { type: "task_line", taskLineId: row.session_id?.replace(/^task:/, "") || null }),
    source: row.source,
    model: row.model || null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWindow(row) {
  if (!row) {
    return {
      recentTurnIds: [],
      rollingSummary: { text: "", coveredTurnIds: [], updatedAt: null },
      sessionState: {},
      promptState: {},
      updatedAt: null,
    };
  }
  return {
    recentTurnIds: parseJson(row.recent_turn_ids_json, []),
    rollingSummary: {
      text: row.rolling_summary_text || "",
      coveredTurnIds: parseJson(row.rolling_summary_turn_ids_json, []),
      updatedAt: row.updated_at,
    },
    sessionState: parseJson(row.session_state_json, {}),
    promptState: parseJson(row.prompt_state_json, {}),
    updatedAt: row.updated_at,
  };
}

function initializeSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS agent_sessions (
      session_id TEXT PRIMARY KEY,
      task_line_id TEXT NOT NULL,
      title TEXT NOT NULL,
      persona_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_turns (
      turn_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
      user_text TEXT NOT NULL,
      assistant_text TEXT NOT NULL DEFAULT '',
      route_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pending',
      model TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_turns_session_created
      ON agent_turns(session_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_session_windows (
      session_id TEXT PRIMARY KEY REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
      recent_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      rolling_summary_text TEXT NOT NULL DEFAULT '',
      rolling_summary_turn_ids_json TEXT NOT NULL DEFAULT '[]',
      session_state_json TEXT NOT NULL DEFAULT '{}',
      prompt_state_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_signals (
      signal_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_signals_session_created
      ON agent_signals(session_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_prompt_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE SET NULL,
      prompt_json TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      user_prompt TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_prompt_snapshots_session_created
      ON agent_prompt_snapshots(session_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_mem0_sync_log (
      sync_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES agent_sessions(session_id) ON DELETE CASCADE,
      turn_id TEXT REFERENCES agent_turns(turn_id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      mem0_id TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function createAgentSqliteStore({ dataDir, dbPath = path.join(dataDir, DB_FILE) }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  initializeSchema(db);

  const ensureSessionStatement = db.prepare(`
    INSERT INTO agent_sessions (session_id, task_line_id, title, persona_text, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      task_line_id = excluded.task_line_id,
      title = excluded.title,
      persona_text = excluded.persona_text,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);
  const getSessionStatement = db.prepare("SELECT * FROM agent_sessions WHERE session_id = ?");
  const listSessionsStatement = db.prepare("SELECT * FROM agent_sessions ORDER BY updated_at DESC, created_at DESC");
  const insertTurnStatement = db.prepare(`
    INSERT INTO agent_turns (turn_id, session_id, user_text, assistant_text, route_json, source, model, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateTurnStatement = db.prepare(`
    UPDATE agent_turns
    SET assistant_text = ?, source = ?, model = ?, status = ?, route_json = ?, updated_at = ?
    WHERE turn_id = ?
  `);
  const listTurnsStatement = db.prepare("SELECT * FROM agent_turns WHERE session_id = ? ORDER BY created_at ASC");
  const listRecentTurnsStatement = db.prepare(`
    SELECT * FROM (
      SELECT * FROM agent_turns WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
    ) ORDER BY created_at ASC
  `);
  const getWindowStatement = db.prepare("SELECT * FROM agent_session_windows WHERE session_id = ?");
  const upsertWindowStatement = db.prepare(`
    INSERT INTO agent_session_windows (
      session_id,
      recent_turn_ids_json,
      rolling_summary_text,
      rolling_summary_turn_ids_json,
      session_state_json,
      prompt_state_json,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      recent_turn_ids_json = excluded.recent_turn_ids_json,
      rolling_summary_text = excluded.rolling_summary_text,
      rolling_summary_turn_ids_json = excluded.rolling_summary_turn_ids_json,
      session_state_json = excluded.session_state_json,
      prompt_state_json = excluded.prompt_state_json,
      updated_at = excluded.updated_at
  `);
  const insertSignalStatement = db.prepare(`
    INSERT INTO agent_signals (signal_id, session_id, turn_id, kind, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const listSignalsStatement = db.prepare(`
    SELECT * FROM agent_signals WHERE session_id = ? ORDER BY created_at DESC LIMIT ?
  `);
  const insertPromptSnapshotStatement = db.prepare(`
    INSERT INTO agent_prompt_snapshots (
      snapshot_id,
      session_id,
      turn_id,
      prompt_json,
      system_prompt,
      user_prompt,
      model,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMem0SyncStatement = db.prepare(`
    INSERT INTO agent_mem0_sync_log (sync_id, session_id, turn_id, action, mem0_id, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  function ensureSession({
    sessionId,
    taskLineId,
    title,
    personaText = "",
    status = "active",
    createdAt = nowIso(),
    updatedAt = createdAt,
  }) {
    if (!sessionId || !taskLineId) throw new Error("sessionId and taskLineId are required.");
    ensureSessionStatement.run(sessionId, taskLineId, title || taskLineId, personaText, status, createdAt, updatedAt);
    return getSession(sessionId);
  }

  function getSession(sessionId) {
    return rowToSession(getSessionStatement.get(sessionId));
  }

  function listSessions() {
    return listSessionsStatement.all().map(rowToSession);
  }

  function appendPendingTurn({
    turnId = makeId("agent-turn"),
    sessionId,
    userText,
    route = { type: "task_line", taskLineId: sessionId?.replace(/^task:/, "") || null },
    createdAt = nowIso(),
  }) {
    if (!sessionId || !String(userText || "").trim()) throw new Error("sessionId and userText are required.");
    insertTurnStatement.run(
      turnId,
      sessionId,
      String(userText),
      "",
      jsonString(route),
      "pending",
      null,
      "pending",
      createdAt,
      createdAt,
    );
    return rowToTurn(db.prepare("SELECT * FROM agent_turns WHERE turn_id = ?").get(turnId));
  }

  function completeTurn({
    turnId,
    assistantText,
    source = "openai",
    model = null,
    route = null,
    status = "complete",
    updatedAt = nowIso(),
  }) {
    const existing = db.prepare("SELECT * FROM agent_turns WHERE turn_id = ?").get(turnId);
    if (!existing) throw new Error(`Agent turn not found: ${turnId}`);
    updateTurnStatement.run(
      String(assistantText || ""),
      source,
      model,
      status,
      jsonString(route || parseJson(existing.route_json, {})),
      updatedAt,
      turnId,
    );
    return rowToTurn(db.prepare("SELECT * FROM agent_turns WHERE turn_id = ?").get(turnId));
  }

  function listTurns(sessionId) {
    return listTurnsStatement.all(sessionId).map(rowToTurn);
  }

  function listRecentTurns(sessionId, limit = 20) {
    return listRecentTurnsStatement.all(sessionId, limit).map(rowToTurn);
  }

  function getSessionWindow(sessionId) {
    return rowToWindow(getWindowStatement.get(sessionId));
  }

  function upsertSessionWindow(sessionId, {
    recentTurnIds = [],
    rollingSummary = {},
    sessionState = {},
    promptState = {},
    updatedAt = nowIso(),
  }) {
    upsertWindowStatement.run(
      sessionId,
      jsonString(recentTurnIds, []),
      rollingSummary.text || "",
      jsonString(rollingSummary.coveredTurnIds, []),
      jsonString(sessionState, {}),
      jsonString(promptState, {}),
      updatedAt,
    );
    return getSessionWindow(sessionId);
  }

  function recordSignal({
    signalId = makeId("agent-signal"),
    sessionId,
    turnId = null,
    kind,
    payload,
    createdAt = nowIso(),
  }) {
    insertSignalStatement.run(signalId, sessionId, turnId, kind, jsonString(payload), createdAt);
    return { signalId, sessionId, turnId, kind, payload, createdAt };
  }

  function listSignals(sessionId, limit = 20) {
    return listSignalsStatement.all(sessionId, limit).map((row) => ({
      signalId: row.signal_id,
      sessionId: row.session_id,
      turnId: row.turn_id,
      kind: row.kind,
      payload: parseJson(row.payload_json, {}),
      createdAt: row.created_at,
    }));
  }

  function recordPromptSnapshot({
    snapshotId = makeId("agent-prompt"),
    sessionId,
    turnId = null,
    prompt,
    systemPrompt,
    userPrompt,
    model = null,
    createdAt = nowIso(),
  }) {
    insertPromptSnapshotStatement.run(
      snapshotId,
      sessionId,
      turnId,
      jsonString(prompt),
      String(systemPrompt || ""),
      String(userPrompt || ""),
      model,
      createdAt,
    );
    return { snapshotId, sessionId, turnId, prompt, systemPrompt, userPrompt, model, createdAt };
  }

  function logMem0Sync({
    syncId = makeId("agent-mem0"),
    sessionId,
    turnId = null,
    action,
    mem0Id = null,
    metadata = {},
    createdAt = nowIso(),
  }) {
    insertMem0SyncStatement.run(syncId, sessionId, turnId, action, mem0Id, jsonString(metadata), createdAt);
    return { syncId, sessionId, turnId, action, mem0Id, metadata, createdAt };
  }

  function loadSessionBundle(sessionId) {
    const session = getSession(sessionId);
    if (!session) return null;
    return {
      session,
      turns: listTurns(sessionId),
      window: getSessionWindow(sessionId),
      signals: listSignals(sessionId, 20),
    };
  }

  function close() {
    db.close();
  }

  return {
    dbPath,
    ensureSession,
    getSession,
    listSessions,
    appendPendingTurn,
    completeTurn,
    listTurns,
    listRecentTurns,
    getSessionWindow,
    upsertSessionWindow,
    recordSignal,
    listSignals,
    recordPromptSnapshot,
    logMem0Sync,
    loadSessionBundle,
    close,
  };
}

