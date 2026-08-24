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
  askOpenAI: (request) => ipcRenderer.invoke("ai:ask-openai", request),
});
