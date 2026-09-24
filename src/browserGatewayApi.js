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
    if (!response.ok) throw toRequestError(payload, response.status);
    return payload;
  }

  /**
   * 把 HTTP 失败还原成一个带 code / statusCode 的错误。
   *
   * 只抛一句 message 的话，界面区分不了"版本冲突该重新载入"和"输入不合法该改内容"，
   * 只能靠比对中文字符串——那是最脆的做法。这里让两边（IPC 抛的错、这里抛的错）
   * 拿到的字段一致。
   */
  function toRequestError(payload, status) {
    const error = new Error(payload?.error || `Gateway request failed (${status}).`);
    error.statusCode = status;
    error.code = payload?.code || null;
    return error;
  }

  function acceptSession(payload) {
    sessionId = payload.sessionId;
    localStorage.setItem(SESSION_KEY, sessionId);
    return payload.account;
  }

  function query(params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : "";
  }

  /**
   * 日记通道。
   *
   * 形状必须和 electron/preload.js 里的 `diary: { ... }` 完全一致——方法名、参数、
   * 连"读一条要传 { diaryId } 而不是裸 id"这种细节也要一样。界面只认 desktopApi.diary.*，
   * 两边一旦漂移，就会出现"桌面模式好好的、家庭模式报 undefined"。
   */
  const diary = {
    list: (options = {}) => request(`/diary${query(options)}`),
    get: (input = {}) => request(`/diary/${encodeURIComponent(input.diaryId)}`),
    create: (input = {}) => request("/diary", { method: "POST", body: input }),
    update: (input = {}) => request(`/diary/${encodeURIComponent(input.diaryId)}`, { method: "PUT", body: input }),
    trash: (input = {}) => request(`/diary/${encodeURIComponent(input.diaryId)}`, { method: "DELETE" }),
    restore: (input = {}) => request(`/diary/${encodeURIComponent(input.diaryId)}/restore`, { method: "POST" }),
    remove: (input = {}) => request(`/diary/${encodeURIComponent(input.diaryId)}?purge=1`, { method: "DELETE" }),
    search: (options = {}) => {
      const { query: text, ...rest } = options;
      return request(`/diary/search${query({ ...rest, q: text })}`);
    },
    timeline: (options = {}) => request(`/diary/timeline${query(options)}`),
    listTags: () => request("/diary/tags"),
    listRevisions: (input = {}) => request(`/diary/${encodeURIComponent(input.diaryId)}/revisions${query({ limit: input.limit })}`),
    listNodeEntries: (input = {}) => request(`/diary${query({ kind: "node", targetType: "node", targetId: input.nodeId, status: input.status, from: input.from, to: input.to, limit: input.limit, offset: input.offset })}`),
    listDailyDays: (input = {}) => request(`/diary/days${query({ nodeId: input.nodeId, status: input.status, from: input.from, to: input.to })}`),
    previewNodeNotes: () => request("/diary/import-node-notes"),
    importNodeNotes: (input = {}) => request("/diary/import-node-notes", { method: "POST", body: input }),
  };

  return {
    isBrowserGateway: true,
    diary,
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
    listAgentApprovals: () => request("/agent/approvals"),
    decideAgentApproval: (input) => request("/agent/approvals/decide", { method: "POST", body: input }),
    chatAgent: (input) => request("/agent/chat", { method: "POST", body: input }),
    async chatAgentStream(input, onDelta) {
      const response = await fetch(`${apiBaseUrl()}/agent/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sessionId ? { Authorization: `Bearer ${sessionId}` } : {}) },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw toRequestError(payload, response.status);
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
