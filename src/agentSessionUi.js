import { buildAgentMemory } from "./agentMemory";

function getActiveTaskIds(board) {
  return new Set(
    (Array.isArray(board?.tasks) ? board.tasks : [])
      .filter((task) => task.status === "active")
      .map((task) => task.id),
  );
}

export function getActiveAgentScopeOptions(board, memory = buildAgentMemory(board)) {
  const activeTaskIds = getActiveTaskIds(board);
  const taskSummaries = Array.isArray(memory?.taskLineSummaries) ? memory.taskLineSummaries : [];
  const taskOptions = taskSummaries
    .filter((summary) => activeTaskIds.has(summary.taskLineId))
    .map((summary) => ({
      id: `task:${summary.taskLineId}`,
      label: summary.title,
      detail: "任务线会话",
    }));

  return taskOptions;
}

export function sanitizeAgentScopeId(board, scopeId, memory = buildAgentMemory(board)) {
  const options = getActiveAgentScopeOptions(board, memory);
  if (options.some((option) => option.id === scopeId)) return scopeId;
  return options[0]?.id || "global";
}

export function getAgentSessionTurns(journal, scopeId = "global") {
  const sessions = journal?.sessions && typeof journal.sessions === "object" ? journal.sessions : null;
  if (!sessions) {
    const turns = Array.isArray(journal?.rawTurns) ? journal.rawTurns : [];
    if (scopeId === "global") return turns;
    return turns.filter((turn) => turn.scopeId === scopeId);
  }
  if (scopeId === "global") {
    return Object.values(sessions)
      .flatMap((session) => Array.isArray(session?.rawTurns) ? session.rawTurns : [])
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  }
  return Array.isArray(sessions[scopeId]?.rawTurns) ? sessions[scopeId].rawTurns : [];
}
