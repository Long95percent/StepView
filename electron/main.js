import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL;
const dataFile = () => path.join(app.getPath("userData"), "stepview-board.json");

async function readBoard() {
  try {
    const text = await fs.readFile(dataFile(), "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Failed to read board", error);
    return { tasks: [], stickers: [] };
  }
}

async function writeBoard(board) {
  await fs.mkdir(path.dirname(dataFile()), { recursive: true });
  await fs.writeFile(dataFile(), JSON.stringify(board, null, 2), "utf8");
  return { ok: true, path: dataFile() };
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
  ipcMain.handle("board:load", readBoard);
  ipcMain.handle("board:save", (_event, board) => writeBoard(board));
  ipcMain.handle("board:reveal", async () => {
    await fs.mkdir(path.dirname(dataFile()), { recursive: true });
    await shell.showItemInFolder(dataFile());
    return dataFile();
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});