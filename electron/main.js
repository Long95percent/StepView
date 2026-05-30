import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentMemory } from "../src/agentMemory.js";
import { createMem0Client } from "./agentMem0Client.js";
import { createRedisAgentCache } from "./agentRedisClient.js";
import { createAgentService } from "./agentService.js";
import { createAgentSqliteStore } from "./agentSqliteStore.js";
import { createBoardStorage } from "./boardStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL;
app.setName("StepView");
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const boardStorage = createBoardStorage({ dataDir: app.getPath("userData") });
const agentSqliteStore = createAgentSqliteStore({ dataDir: app.getPath("userData") });
const agentRedisCache = createRedisAgentCache();
const agentMem0Client = createMem0Client();
const agentService = createAgentService({
  sqliteStore: agentSqliteStore,
  redisCache: agentRedisCache,
  mem0Client: agentMem0Client,
});
let isQuittingAfterStorageFlush = false;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.1";

function getChatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "");
  return `${normalized}/chat/completions`;
}

function toRendererTurn(turn) {
  return {
    id: turn.turnId,
    turnId: turn.turnId,
    userText: turn.userText,
    assistantText: turn.assistantText,
    scopeId: turn.sessionId,
    sessionId: turn.sessionId,
    route: turn.route,
    source: turn.source,
    model: turn.model,
    status: turn.status,
    createdAt: turn.createdAt,
    updatedAt: turn.updatedAt,
  };
}

function serializeSessionView(view) {
  if (!view) return null;
  return {
    session: view.session,
    rawTurns: (view.turns || []).map(toRendererTurn),
    turns: (view.turns || []).map(toRendererTurn),
    rollingSummary: view.window?.rollingSummary || { text: "", coveredTurnIds: [], updatedAt: null },
    sessionState: view.window?.sessionState || {},
    promptState: view.window?.promptState || {},
    redisPromptState: view.redisPromptState || null,
    redisWindowState: view.redisWindowState || null,
    signals: view.signals || [],
    updatedAt: view.window?.updatedAt || null,
  };
}

function serializeSessionViews(views) {
  const sessions = {};
  for (const [sessionId, view] of Object.entries(views || {})) {
    sessions[sessionId] = serializeSessionView(view);
  }
  return { sessions, updatedAt: new Date().toISOString() };
}

async function loadCurrentBoardMemory() {
  await boardStorage.flushWrites();
  const board = await boardStorage.readBoard();
  return buildAgentMemory(board);
}

async function askOpenAIWithMessages({
  apiKey,
  model,
  baseUrl,
  messages,
}) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) throw new Error("Missing OpenAI API key.");
  const selectedModel = String(model || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  const selectedBaseUrl = String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL;

  const response = await fetch(getChatCompletionsUrl(selectedBaseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${normalizedApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: selectedModel, messages }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI request failed with ${response.status}.`);
  }
  const text = payload.choices?.[0]?.message?.content?.trim();
  return { text: text || "OpenAI returned an empty response.", model: selectedModel };
}

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
  ipcMain.handle("agent:load-journal", async () => {
    const memory = await loadCurrentBoardMemory();
    agentService.syncSessionsFromBoardMemory(memory);
    return serializeSessionViews(await agentService.listSessionViews());
  });
  ipcMain.handle("agent:load-session", async (_event, request = {}) =>
    serializeSessionView(await agentService.loadSessionView(request.sessionId)),
  );
  ipcMain.handle("agent:chat", async (_event, request = {}) => {
    const userText = String(request.userText || request.question || "").trim();
    if (!userText) throw new Error("Agent message is empty.");
    const memory = await loadCurrentBoardMemory();
    agentService.syncSessionsFromBoardMemory(memory);
    const sessionId = String(request.sessionId || request.scopeId || "").trim();
    if (!sessionId || sessionId === "global") throw new Error("请选择一条活跃任务线会话。");
    const prepared = await agentService.prepareChat({
      sessionId,
      userText,
      boardMemory: memory,
      model: request.model || DEFAULT_OPENAI_MODEL,
    });
    try {
      const result = await askOpenAIWithMessages({
        apiKey: request.apiKey,
        model: request.model,
        baseUrl: request.baseUrl,
        messages: prepared.prompt.messages,
      });
      const view = await agentService.completeChat(prepared, {
        assistantText: result.text,
        model: result.model,
        source: "openai",
      });
      return {
        text: result.text,
        model: result.model,
        sessionId,
        session: serializeSessionView(view),
      };
    } catch (error) {
      agentSqliteStore.completeTurn({
        turnId: prepared.turn.turnId,
        assistantText: "",
        source: "openai-error",
        model: request.model || DEFAULT_OPENAI_MODEL,
        status: "failed",
      });
      agentService.refreshSessionWindow(sessionId);
      throw error;
    }
  });
  ipcMain.handle("ai:ask-openai", async (_event, request = {}) => {
    const question = String(request.question || "").trim();
    const localAnswer = String(request.localAnswer || "").trim();
    const route = request.route || { type: "global" };
    const memory = request.memory || {};

    return askOpenAIWithMessages({
      apiKey: request.apiKey,
      model: request.model,
      baseUrl: request.baseUrl,
      messages: [
        {
          role: "system",
          content: [
            "你是 StepView 的任务线 Agent。",
            "你必须用中文回答。",
            "优先基于传入的任务线摘要、支线记忆、节点日记信号和用户状态快照回答。",
            "不要编造不存在的任务、支线、日记或心理结论。",
            "默认给陪伴式、结构化、低压力的下一步建议。",
            "心理需求分析只能作为动机和行为模式推测，不能做医学诊断。",
            "如果信息不足，直接说明需要用户补充哪个任务线、分支或节点日记。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            question,
            route,
            localAnswer,
            memory: {
              userStateSnapshot: memory.userStateSnapshot,
              taskLineSummaries: memory.taskLineSummaries,
              branchMemories: memory.branchMemories,
              diarySignals: (memory.diarySignals || []).slice(-12),
              userMemoryFacts: memory.userMemoryFacts,
            },
          }, null, 2),
        },
      ],
    });
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
  Promise.all([boardStorage.flushWrites(), agentRedisCache.close?.()]).finally(() => {
    agentSqliteStore.close();
    isQuittingAfterStorageFlush = true;
    app.quit();
  });
});
