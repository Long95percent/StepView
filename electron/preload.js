import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("stepview", {
  loadBoard: () => ipcRenderer.invoke("board:load"),
  saveBoard: (board) => ipcRenderer.invoke("board:save", board),
  revealDataFile: () => ipcRenderer.invoke("board:reveal"),
  loadAgentJournal: () => ipcRenderer.invoke("agent:load-journal"),
  loadAgentSession: (request) => ipcRenderer.invoke("agent:load-session", request),
  chatAgent: (request) => ipcRenderer.invoke("agent:chat", request),
  askOpenAI: (request) => ipcRenderer.invoke("ai:ask-openai", request),
});
