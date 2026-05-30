const DEFAULT_MEM0_BASE_URL = "https://api.mem0.ai/v1";

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_MEM0_BASE_URL).replace(/\/+$/, "");
}

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.detail || payload?.error || payload?.message || `Mem0 request failed with ${response.status}.`);
  }
  return payload;
}

export function createMem0Client({
  apiKey = process.env.MEM0_API_KEY || "",
  baseUrl = process.env.MEM0_BASE_URL || DEFAULT_MEM0_BASE_URL,
  userId = process.env.STEPVIEW_USER_ID || "stepview-local-user",
  agentId = "stepview-agent",
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const enabled = Boolean(String(apiKey || "").trim());

  function headers() {
    if (!enabled) throw new Error("Missing MEM0_API_KEY.");
    return {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async function addMessages({
    sessionId,
    taskLineId,
    turnId,
    messages,
    metadata = {},
    infer = true,
  }) {
    if (!enabled) return { skipped: true, reason: "missing-api-key" };
    const response = await fetchImpl(`${normalizedBaseUrl}/memories`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        messages,
        user_id: userId,
        agent_id: agentId,
        run_id: sessionId,
        metadata: {
          sessionId,
          taskLineId,
          turnId,
          ...metadata,
        },
        infer,
      }),
    });
    return readJsonResponse(response);
  }

  async function searchMemories({
    sessionId,
    taskLineId,
    query,
    limit = 5,
    metadata = {},
  }) {
    if (!enabled) return [];
    const response = await fetchImpl(`${normalizedBaseUrl}/memories/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        query,
        user_id: userId,
        agent_id: agentId,
        run_id: sessionId,
        limit,
        metadata: {
          sessionId,
          taskLineId,
          ...metadata,
        },
      }),
    });
    const payload = await readJsonResponse(response);
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.results)) return payload.results;
    if (Array.isArray(payload.memories)) return payload.memories;
    return [];
  }

  return {
    enabled,
    addMessages,
    searchMemories,
  };
}

