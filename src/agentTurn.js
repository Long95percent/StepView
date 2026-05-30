function normalizeText(value) {
  return String(value || "").trim();
}

export function buildAgentTurn({
  id,
  question,
  scopeId,
  localResponse,
  createdAt = new Date().toISOString(),
}) {
  return {
    id,
    userText: normalizeText(question),
    assistantText: normalizeText(localResponse?.answer),
    scopeId: scopeId || "global",
    route: localResponse?.route || { type: "global" },
    source: "local",
    createdAt,
  };
}

export function markAgentTurnOpenAI(turn, { text, model } = {}) {
  const assistantText = normalizeText(text) || turn.assistantText;
  const nextTurn = {
    ...turn,
    assistantText,
    source: "openai",
  };

  if (model !== undefined) {
    nextTurn.model = normalizeText(model);
  }

  return nextTurn;
}

export function markAgentTurnFallback(turn) {
  return {
    ...turn,
    source: "local-fallback",
  };
}
