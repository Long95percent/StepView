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
});
