import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBoardStorage } from "./boardStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL;
app.setName("StepView");
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const boardStorage = createBoardStorage({ dataDir: app.getPath("userData") });
let isQuittingAfterStorageFlush = false;

if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "StepView",
    backgroundColor: "#070912",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    window.loadURL(isDev);
  } else {
    window.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  ipcMain.handle("board:load", boardStorage.readBoard);
  ipcMain.handle("board:save", (_event, board) => boardStorage.writeBoard(board));
  ipcMain.handle("board:reveal", async () => {
    await fs.mkdir(path.dirname(boardStorage.boardPath()), { recursive: true });
    await shell.showItemInFolder(boardStorage.boardPath());
    return boardStorage.boardPath();
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (isQuittingAfterStorageFlush) return;
  event.preventDefault();
  boardStorage.flushWrites().finally(() => {
    isQuittingAfterStorageFlush = true;
    app.quit();
  });
});
