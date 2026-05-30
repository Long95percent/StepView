import { buildAgentPrompt } from "./agentPromptBuilder.js";

const WINDOW_LIMIT = 20;
const SUMMARY_BATCH_SIZE = 5;

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function compactText(value, maxLength = 220) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function summarizeTurnsForAudit(turns) {
  if (!turns.length) return "";
  return turns
    .map((turn) => {
      const pieces = [`[${turn.turnId}]`, compactText(turn.userText, 90)];
      if (turn.assistantText) pieces.push(compactText(turn.assistantText, 120));
      return pieces.join(" ");
    })
    .join("\n");
}

function getTaskSummary(boardMemory, taskLineId) {
  return (boardMemory?.taskLineSummaries || []).find((summary) => summary.taskLineId === taskLineId) || null;
}

function buildSessionWindow(turns, previousWindow) {
  const allIds = turns.map((turn) => turn.turnId);
  const coveredSet = new Set((previousWindow?.rollingSummary?.coveredTurnIds || []).filter((id) => allIds.includes(id)));
  const newlyCovered = [];

  while (allIds.length - coveredSet.size > WINDOW_LIMIT) {
    const nextBatch = allIds.filter((id) => !coveredSet.has(id)).slice(0, SUMMARY_BATCH_SIZE);
    if (!nextBatch.length) break;
    for (const id of nextBatch) {
      coveredSet.add(id);
      newlyCovered.push(id);
    }
  }

  const coveredTurnIds = allIds.filter((id) => coveredSet.has(id));
  const recentTurnIds = allIds.filter((id) => !coveredSet.has(id));
  const movedTurns = turns.filter((turn) => newlyCovered.includes(turn.turnId));
  const previousText = previousWindow?.rollingSummary?.text || "";
  const auditSummary = summarizeTurnsForAudit(movedTurns);
  const rollingText = auditSummary ? compactText([previousText, auditSummary].filter(Boolean).join("\n"), 2000) : previousText;
  const updatedAt = new Date().toISOString();

  return {
    recentTurnIds,
    rollingSummary: {
      text: rollingText,
      coveredTurnIds,
      updatedAt,
    },
    sessionState: {
      recentTurnIds,
      turnCount: turns.length,
      lastTurnId: allIds.at(-1) || null,
      summaryNeedsModelRefresh: Boolean(newlyCovered.length),
      updatedAt,
    },
  };
}

export function createAgentService({
  sqliteStore,
  redisCache,
  mem0Client,
  logger = console,
}) {
  function ensureTaskSession({ taskLineId, title, personaText = "", status = "active" }) {
    const sessionId = `task:${taskLineId}`;
    return sqliteStore.ensureSession({
      sessionId,
      taskLineId,
      title: title || taskLineId,
      personaText,
      status,
    });
  }

  function syncSessionsFromBoardMemory(boardMemory) {
    const activeSummaries = (boardMemory?.taskLineSummaries || []).filter((summary) => summary.status === "active");
    return activeSummaries.map((summary) =>
      ensureTaskSession({
        taskLineId: summary.taskLineId,
        title: summary.title,
      }),
    );
  }

  function refreshSessionWindow(sessionId, promptState = {}) {
    const turns = sqliteStore.listTurns(sessionId);
    const previousWindow = sqliteStore.getSessionWindow(sessionId);
    const nextWindow = buildSessionWindow(turns, previousWindow);
    const saved = sqliteStore.upsertSessionWindow(sessionId, {
      ...nextWindow,
      promptState: {
        ...(previousWindow.promptState || {}),
        ...promptState,
      },
    });
    return { turns, window: saved };
  }

  async function loadSessionView(sessionId) {
    const bundle = sqliteStore.loadSessionBundle(sessionId);
    if (!bundle) return null;
    let redisPromptState = null;
    let redisWindowState = null;
    try {
      redisPromptState = await redisCache?.loadPromptState?.(sessionId);
      redisWindowState = await redisCache?.loadWindowState?.(sessionId);
    } catch (error) {
      logger.warn?.("Failed to load agent Redis state", error);
    }
    return { ...bundle, redisPromptState, redisWindowState };
  }

  async function listSessionViews() {
    const sessions = sqliteStore.listSessions();
    const entries = await Promise.all(
      sessions.map(async (session) => {
        const view = await loadSessionView(session.sessionId);
        return view ? [session.sessionId, view] : null;
      }),
    );
    return Object.fromEntries(entries.filter(Boolean));
  }

  async function prepareChat({
    sessionId,
    userText,
    boardMemory,
    model,
  }) {
    const session = sqliteStore.getSession(sessionId);
    if (!session) throw new Error(`Agent session not found: ${sessionId}`);
    const turn = sqliteStore.appendPendingTurn({
      turnId: makeId("agent-turn"),
      sessionId,
      userText,
      route: { type: "task_line", taskLineId: session.taskLineId },
    });
    const previousWindow = refreshSessionWindow(sessionId).window;
    const recentTurns = sqliteStore
      .listRecentTurns(sessionId, WINDOW_LIMIT + 1)
      .filter((candidate) => candidate.turnId !== turn.turnId);

    const mem0Memories = await mem0Client?.searchMemories?.({
      sessionId,
      taskLineId: session.taskLineId,
      query: userText,
      limit: 5,
      metadata: { source: "prompt-builder" },
    }).catch((error) => {
      logger.warn?.("Mem0 search failed", error);
      return [];
    }) || [];

    const prompt = buildAgentPrompt({
      session,
      boardMemory,
      recentTurns,
      rollingSummary: previousWindow.rollingSummary,
      mem0Memories,
      userText,
      model,
    });
    sqliteStore.recordPromptSnapshot({
      sessionId,
      turnId: turn.turnId,
      prompt: { messages: prompt.messages, promptState: prompt.promptState },
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      model,
    });
    const windowState = {
      recentTurnIds: previousWindow.recentTurnIds,
      rollingSummary: previousWindow.rollingSummary,
      sessionState: previousWindow.sessionState,
      updatedAt: previousWindow.updatedAt,
    };
    await redisCache?.savePromptState?.(sessionId, prompt.promptState);
    await redisCache?.saveWindowState?.(sessionId, windowState);

    return { session, turn, prompt, mem0Memories, boardMemory };
  }

  async function completeChat(prepared, {
    assistantText,
    model,
    source = "openai",
  }) {
    const turn = sqliteStore.completeTurn({
      turnId: prepared.turn.turnId,
      assistantText,
      source,
      model,
      route: { type: "task_line", taskLineId: prepared.session.taskLineId },
    });
    const { window } = refreshSessionWindow(prepared.session.sessionId, {
      ...prepared.prompt.promptState,
      lastCompletedTurnId: turn.turnId,
    });
    sqliteStore.recordSignal({
      sessionId: prepared.session.sessionId,
      turnId: turn.turnId,
      kind: "turn_completed",
      payload: {
        source,
        model,
        taskLineId: prepared.session.taskLineId,
      },
    });
    const taskSummary = getTaskSummary(prepared.boardMemory, prepared.session.taskLineId);
    const metadata = {
      category: "agent_turn",
      taskTitle: taskSummary?.title || prepared.session.title,
    };
    const mem0Result = await mem0Client?.addMessages?.({
      sessionId: prepared.session.sessionId,
      taskLineId: prepared.session.taskLineId,
      turnId: turn.turnId,
      messages: [
        { role: "user", content: turn.userText },
        { role: "assistant", content: turn.assistantText },
      ],
      metadata,
      infer: true,
    }).catch((error) => {
      logger.warn?.("Mem0 add failed", error);
      return { skipped: true, reason: error.message };
    });
    sqliteStore.logMem0Sync({
      sessionId: prepared.session.sessionId,
      turnId: turn.turnId,
      action: mem0Result?.skipped ? "skipped" : "add",
      mem0Id: mem0Result?.id || null,
      metadata: { ...metadata, result: mem0Result },
    });
    await redisCache?.saveWindowState?.(prepared.session.sessionId, window);
    return loadSessionView(prepared.session.sessionId);
  }

  return {
    ensureTaskSession,
    syncSessionsFromBoardMemory,
    refreshSessionWindow,
    loadSessionView,
    listSessionViews,
    prepareChat,
    completeChat,
  };
}
