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
    saveBoard: (board) => request("/board", { method: "PUT", body: board }),
    loadAgentJournal: () => request("/agent/journal"),
    chatAgent: (input) => request("/agent/chat", { method: "POST", body: input }),
  };
}
