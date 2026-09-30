import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("stepview", {
  getGatewayInfo: () => ipcRenderer.invoke("gateway:info"),
  listAccounts: () => ipcRenderer.invoke("account:list"),
  registerAccount: (input) => ipcRenderer.invoke("account:register", input),
  login: (input) => ipcRenderer.invoke("account:login", input),
  logout: () => ipcRenderer.invoke("account:logout"),
  getCurrentAccount: () => ipcRenderer.invoke("account:current"),
  switchAccount: (input) => ipcRenderer.invoke("account:switch", input),
  importPersonalData: (input) => ipcRenderer.invoke("account:import-personal-data", input),
  loadBoard: () => ipcRenderer.invoke("board:load"),
  saveBoard: (board) => ipcRenderer.invoke("board:save", board),
  revealDataFile: () => ipcRenderer.invoke("board:reveal"),
  loadAgentJournal: () => ipcRenderer.invoke("agent:load-journal"),
  loadAgentSession: (request) => ipcRenderer.invoke("agent:load-session", request),
  chatAgent: (request) => ipcRenderer.invoke("agent:chat", request),
  chatAgentStream: (request, onDelta) => {
    const streamId = globalThis.crypto.randomUUID();
    const listener = (_event, message) => {
      if (message?.streamId === streamId && message.type === "delta") onDelta(message.delta);
    };
    ipcRenderer.on("agent:chat-stream:event", listener);
    return ipcRenderer.invoke("agent:chat-stream", { ...request, streamId }).finally(() => {
      ipcRenderer.removeListener("agent:chat-stream:event", listener);
    });
  },
  listAgentTools: () => ipcRenderer.invoke("agent:tools:list"),
  runAgentTool: (request) => ipcRenderer.invoke("agent:tools:run", request),
  listAgentApprovals: () => ipcRenderer.invoke("agent:approvals:list"),
  decideAgentApproval: (request) => ipcRenderer.invoke("agent:approvals:decide", request),
  listAgentMemories: (options) => ipcRenderer.invoke("agent:memory:list", options),
  updateAgentMemory: (request) => ipcRenderer.invoke("agent:memory:feedback", request),
  listAgentMemoryEvidence: (request) => ipcRenderer.invoke("agent:memory:evidence", request),
  askOpenAI: (request) => ipcRenderer.invoke("ai:ask-openai", request),
  data: {
    exportArchive: () => ipcRenderer.invoke("data:export-archive"),
    inspectArchive: (request) => ipcRenderer.invoke("data:inspect-archive", request),
    restoreArchive: (request) => ipcRenderer.invoke("data:restore-archive", request),
  },
  diary: {
    list: (options) => ipcRenderer.invoke("diary:list", options),
    get: (request) => ipcRenderer.invoke("diary:get", request),
    create: (input) => ipcRenderer.invoke("diary:create", input),
    update: (request) => ipcRenderer.invoke("diary:update", request),
    trash: (request) => ipcRenderer.invoke("diary:trash", request),
    restore: (request) => ipcRenderer.invoke("diary:restore", request),
    remove: (request) => ipcRenderer.invoke("diary:remove", request),
    search: (options) => ipcRenderer.invoke("diary:search", options),
    timeline: (options) => ipcRenderer.invoke("diary:timeline", options),
    listTags: () => ipcRenderer.invoke("diary:tags"),
    listRevisions: (request) => ipcRenderer.invoke("diary:list-revisions", request),
    listNodeEntries: (request) => ipcRenderer.invoke("diary:list-node-entries", request),
    listDailyDays: (request) => ipcRenderer.invoke("diary:list-daily-days", request),
    previewNodeNotes: () => ipcRenderer.invoke("diary:preview-node-notes"),
    importNodeNotes: (input) => ipcRenderer.invoke("diary:import-node-notes", input),
  },
});
