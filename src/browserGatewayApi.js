const SESSION_KEY = "stepview-family-session-v1";

function apiBaseUrl() {
  const configured = import.meta.env.VITE_STEPVIEW_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${window.location.protocol}//${window.location.hostname}:3210/api`;
}

export function createBrowserGatewayApi() {
  let sessionId = localStorage.getItem(SESSION_KEY) || "";

  async function request(path, options = {}) {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method || "GET",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Gateway request failed (${response.status}).`);
    return payload;
  }

  function acceptSession(payload) {
    sessionId = payload.sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
    return payload.account;
  }

  return {
    isBrowserGateway: true,
    getGatewayInfo: () => request("/gateway"),
    registerAccount: (input) => request("/accounts/register", { method: "POST", body: input }).then(acceptSession),
    login: (input) => request("/accounts/login", { method: "POST", body: input }).then(acceptSession),
    async logout() {
      try {
        await request("/accounts/logout", { method: "POST" });
      } finally {
        sessionId = "";
        localStorage.removeItem(SESSION_KEY);
      }
    },
    loadBoard: () => request("/board"),
    loadSettings: () => request("/settings"),
    saveSettings: (settings) => request("/settings", { method: "PUT", body: settings }),
    saveBoard: (board) => request("/board", { method: "PUT", body: board }),
    loadAgentJournal: () => request("/agent/journal"),
    chatAgent: (input) => request("/agent/chat", { method: "POST", body: input }),
    async chatAgentStream(input, onDelta) {
      const response = await fetch(`${apiBaseUrl()}/agent/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}) },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Gateway request failed (${response.status}).`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let result;
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) {
          const line = block.split(/\r?\n/).find((entry) => entry.startsWith("data:"));
          if (!line) continue;
          const event = JSON.parse(line.slice(5).trim());
          if (event.type === "delta") onDelta(event.delta);
          if (event.type === "complete") result = event.result;
          if (event.type === "error") throw new Error(event.error);
        }
        if (done) break;
      }
      if (!result) throw new Error("Agent stream ended before completion.");
      return result;
    },
  };
}
