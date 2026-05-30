import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("stepview", {
  loadBoard: () => ipcRenderer.invoke("board:load"),
  saveBoard: (board) => ipcRenderer.invoke("board:save", board),
  revealDataFile: () => ipcRenderer.invoke("board:reveal"),
  loadAgentJournal: () => ipcRenderer.invoke("agent:load-journal"),
  appendAgentTurn: (request) => ipcRenderer.invoke("agent:append-turn", request),
  updateAgentTurn: (request) => ipcRenderer.invoke("agent:update-turn", request),
});