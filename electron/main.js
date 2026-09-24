import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAgentMemory } from "../src/agentMemory.js";
import { loadConfig } from "./config.js";
import { createGateway } from "./gateway/createGateway.js";
import { streamOpenAIChat } from "./openAiStream.js";
import { createToolContext, createToolRunner, openAiToolSchemas } from "./agent/toolBridge.js";
import { completeChatWithTools } from "./agentChatCompletion.js";
import { exportArchive, inspectArchive, restoreArchive } from "./db/archive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL;
app.setName("StepView");
const gotSingleInstanceLock = app.requestSingleInstanceLock();
const config = loadConfig();
const gateway = createGateway({ config, appDataDir: app.getPath("userData") });
let isQuittingAfterStorageFlush = false;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5.1";

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
  const context = gateway.getContext();
  await context.boardStorage.flushWrites();
  const board = await context.boardStorage.readBoard();
  return buildAgentMemory(board);
}

async function askOpenAIWithMessages({
  apiKey,
  model,
  baseUrl,
  messages,
  tools,
  runTool,
}) {
  return completeChatWithTools({
    apiKey,
    model: String(model || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL,
    baseUrl: String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL,
    messages,
    tools,
    runTool,
  });
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

app.whenReady().then(async () => {
  await gateway.initialize();

  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  ipcMain.handle("board:load", () => gateway.loadBoard());
  ipcMain.handle("board:save", (_event, board) => gateway.saveBoard(board));
  ipcMain.handle("gateway:info", () => ({ mode: gateway.getMode(), account: gateway.getCurrentAccount() }));
  ipcMain.handle("account:list", () => gateway.listAccounts());
  ipcMain.handle("account:register", (_event, input) => gateway.registerAccount(input));
  ipcMain.handle("account:login", (_event, input) => gateway.login(input));
  ipcMain.handle("account:logout", () => gateway.logout());
  ipcMain.handle("account:current", () => gateway.getCurrentAccount());
  ipcMain.handle("account:switch", (_event, input) => gateway.switchAccount(input));
  ipcMain.handle("account:import-personal-data", (_event, input) => gateway.importPersonalData(input));
  ipcMain.handle("board:reveal", async () => {
    // 画布已经落库，这里先把库里的画布导出成 JSON 再打开，用户看到的始终是当前数据。
    const context = gateway.getContext();
    const exportedPath = await context.boardStorage.exportBoard();
    await shell.showItemInFolder(exportedPath);
    return exportedPath;
  });
  // 统一的备份与恢复。导出只读两个库，恢复先校验再替换，当前数据改名保留不删除。
  // 校验标准（支持的 schema 版本、必须有的表）由 electron/db/archive.js 定义，这里不再抄一份。
  async function pickArchiveDirectory({ title, create }) {
    const properties = ["openDirectory"];
    if (create) properties.push("createDirectory");
    const choice = await dialog.showOpenDialog({ title, properties });
    if (choice.canceled || !choice.filePaths[0]) return null;
    return choice.filePaths[0];
  }

  ipcMain.handle("data:export-archive", async () => {
    const parentDir = await pickArchiveDirectory({ title: "选择备份导出的位置", create: true });
    if (!parentDir) return { ok: false, canceled: true };
    const paths = gateway.getDatabasePaths();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const result = exportArchive({
      globalDbPath: paths.global,
      accountDbPath: paths.account,
      targetDir: path.join(parentDir, `stepview-backup-${stamp}`),
      appVersion: app.getVersion(),
      label: "manual",
      // 个人模式不会建全局库文件，少它一份不算问题。
      optionalDatabases: gateway.getMode() === "personal" ? ["global"] : [],
    });
    await shell.showItemInFolder(result.manifestPath);
    return {
      ok: true,
      dir: result.dir,
      databases: result.manifest.databases.map((database) => database.name),
      skipped: result.skipped,
      tables: result.manifest.databases.reduce((sum, database) => sum + database.tables.length, 0),
    };
  });

  ipcMain.handle("data:inspect-archive", async (_event, request = {}) => {
    const dir = request.dir || (await pickArchiveDirectory({ title: "选择要检查的备份目录" }));
    if (!dir) return { ok: false, canceled: true };
    const report = inspectArchive({ dir });
    return { ok: report.ok, dir, exportedAt: report.manifest?.exportedAt || null, problems: report.problems, databases: report.databases };
  });

  ipcMain.handle("data:restore-archive", async (_event, request = {}) => {
    const dir = request.dir || (await pickArchiveDirectory({ title: "选择要恢复的备份目录" }));
    if (!dir) return { ok: false, canceled: true };

    const report = inspectArchive({ dir });
    if (!report.ok) return { ok: false, dir, problems: report.problems };

    const confirmation = await dialog.showMessageBox({
      type: "warning",
      buttons: ["取消", "恢复并重启"],
      defaultId: 0,
      cancelId: 0,
      message: "用这份备份替换当前数据？",
      detail: `备份时间：${report.manifest?.exportedAt || "未知"}\n\n当前的数据库会改名保留在数据目录里（后缀 .pre-restore-时间），不会被删除。替换完成后应用会自动重启。`,
    });
    if (confirmation.response !== 1) return { ok: false, canceled: true };

    // 路径要在关闭网关之前取：家庭模式下账号库的位置取决于当前登录的账号。
    const paths = gateway.getDatabasePaths();
    // 先把所有连接关掉，再动文件：SQLite 还有连接打开时替换文件会读到半截状态。
    await gateway.close();
    let result;
    try {
      result = restoreArchive({ dir, targets: paths });
    } catch (error) {
      // 网关已经关了：把原来的数据重新打开，别把用户留在一个开不了画布的应用里。
      await gateway.initialize();
      throw error;
    }
    isQuittingAfterStorageFlush = true;
    app.relaunch();
    app.exit(0);
    return { ok: true, restored: result.restored.map((entry) => entry.name), kept: result.kept.map((entry) => entry.path) };
  });

  ipcMain.handle("diary:list", (_event, options = {}) => gateway.getContext().diaryService.list(options || {}));
  ipcMain.handle("diary:get", (_event, request = {}) => gateway.getContext().diaryService.get(request.diaryId));
  ipcMain.handle("diary:create", (_event, input = {}) => gateway.getContext().diaryService.create(input));
  ipcMain.handle("diary:update", (_event, request = {}) => gateway.getContext().diaryService.update(request.diaryId, request, { expectedRev: request.expectedRev ?? request.rev }));
  ipcMain.handle("diary:trash", (_event, request = {}) => gateway.getContext().diaryService.trash(request.diaryId));
  ipcMain.handle("diary:restore", (_event, request = {}) => gateway.getContext().diaryService.restore(request.diaryId));
  ipcMain.handle("diary:remove", (_event, request = {}) => gateway.getContext().diaryService.remove(request.diaryId));
  ipcMain.handle("diary:search", (_event, options = {}) => gateway.getContext().diaryService.search(options || {}));
  ipcMain.handle("diary:timeline", (_event, options = {}) => gateway.getContext().diaryService.timeline(options || {}));
  ipcMain.handle("diary:tags", () => gateway.getContext().diaryService.listTags());
  ipcMain.handle("diary:list-revisions", (_event, request = {}) => gateway.getContext().diaryService.listRevisions(request.diaryId, request));
  ipcMain.handle("diary:preview-node-notes", async () => {
    const context = gateway.getContext();
    await context.boardStorage.flushWrites();
    return context.diaryService.previewNodeNoteImport(await context.boardStorage.readBoard());
  });
  ipcMain.handle("diary:import-node-notes", async (_event, input = {}) => {
    const context = gateway.getContext();
    await context.boardStorage.flushWrites();
    return context.diaryService.importNodeNotes(await context.boardStorage.readBoard(), input || {});
  });
  ipcMain.handle("agent:load-journal", async () => {
    return serializeSessionViews(await gateway.loadAgentJournal());
  });
  ipcMain.handle("agent:tools:list", () => gateway.getContext().toolRegistry.list());
  ipcMain.handle("agent:tools:run", async (_event, request = {}) => {
    const context = gateway.getContext();
    const sessionId = request.sessionId || null;
    const result = await context.toolRuntime.run(request.toolId, request.input || {}, createToolContext(context, sessionId, { workspaceId: request.workspaceId || null }));
    if (result.result?.type === "board_change") return result;
    if (result.result?.type?.endsWith?.("_proposal") || result.result?.type === "memory_upsert") {
      return { ...result, approval: context.approvalManager.submit(result.result, { accountId: context.accountId, sessionId }) };
    }
    return result;
  });
  ipcMain.handle("agent:approvals:list", () => {
    const context = gateway.getContext();
    return context.approvalService.list(context.accountId);
  });
  ipcMain.handle("agent:approvals:decide", (_event, request = {}) => {
    const context = gateway.getContext();
    return context.approvalService.decide(request.approvalId, context.accountId, request.decision);
  });
  ipcMain.handle("agent:memory:list", (_event, options = {}) => gateway.getContext().memoryRepository.list(options));
  ipcMain.handle("agent:memory:feedback", (_event, request = {}) => gateway.getContext().memoryRepository.feedback(request.memoryId, request.action, { nextValue: request.nextValue, reason: request.reason }));
  ipcMain.handle("agent:memory:evidence", (_event, request = {}) => gateway.getContext().memoryRepository.listEvidence(request.memoryId));
  ipcMain.handle("agent:load-session", async (_event, request = {}) =>
    serializeSessionView(await gateway.getContext().agentService.loadSessionView(request.sessionId)),
  );
  ipcMain.handle("agent:chat", async (_event, request = {}) => {
    const activeContext = gateway.getContext();
    const activeGeneration = gateway.getContextGeneration();
    const userText = String(request.userText || request.question || "").trim();
    if (!userText) throw new Error("Agent message is empty.");
    const memory = await loadCurrentBoardMemory();
    activeContext.agentService.syncSessionsFromBoardMemory(memory);
    const sessionId = String(request.sessionId || request.scopeId || "").trim();
    if (!sessionId || sessionId === "global") throw new Error("请选择一条活跃任务线会话。");
    const prepared = await activeContext.agentService.prepareChat({
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
        tools: openAiToolSchemas(activeContext.toolRegistry),
        runTool: createToolRunner(activeContext, sessionId),
      });
      if (!gateway.isCurrentContext(activeContext, activeGeneration)) throw new Error("Account changed during Agent request.");
      const view = await activeContext.agentService.completeChat(prepared, {
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
      if (gateway.isCurrentContext(activeContext, activeGeneration)) {
        activeContext.agentSqliteStore.completeTurn({
          turnId: prepared.turn.turnId,
          assistantText: "",
          source: "openai-error",
          model: request.model || DEFAULT_OPENAI_MODEL,
          status: "failed",
        });
        activeContext.agentService.refreshSessionWindow(sessionId);
      }
      throw error;
    }
  });
  ipcMain.handle("agent:chat-stream", async (event, request = {}) => {
    const activeContext = gateway.getContext();
    const activeGeneration = gateway.getContextGeneration();
    const userText = String(request.userText || "").trim();
    const sessionId = String(request.sessionId || "").trim();
    if (!userText) throw new Error("Agent message is empty.");
    if (!sessionId || sessionId === "global") throw new Error("请选择一条活跃任务线会话。");
    const memory = await loadCurrentBoardMemory();
    activeContext.agentService.syncSessionsFromBoardMemory(memory);
    const prepared = await activeContext.agentService.prepareChat({ sessionId, userText, boardMemory: memory, model: request.model || DEFAULT_OPENAI_MODEL });
    try {
      const result = await streamOpenAIChat({
        apiKey: request.apiKey,
        model: request.model,
        baseUrl: request.baseUrl,
        messages: prepared.prompt.messages,
        tools: openAiToolSchemas(activeContext.toolRegistry),
        runTool: createToolRunner(activeContext, sessionId),
        onDelta: (delta) => event.sender.send("agent:chat-stream:event", { streamId: request.streamId, type: "delta", delta }),
      });
      if (!gateway.isCurrentContext(activeContext, activeGeneration)) throw new Error("Account changed during Agent request.");
      const view = await activeContext.agentService.completeChat(prepared, { assistantText: result.text, model: result.model, source: "openai" });
      return { text: result.text, model: result.model, sessionId, session: serializeSessionView(view) };
    } catch (error) {
      if (gateway.isCurrentContext(activeContext, activeGeneration)) {
        activeContext.agentSqliteStore.completeTurn({ turnId: prepared.turn.turnId, assistantText: "", source: "openai-error", model: request.model || DEFAULT_OPENAI_MODEL, status: "failed" });
        activeContext.agentService.refreshSessionWindow(sessionId);
      }
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
  gateway.close().finally(() => {
    isQuittingAfterStorageFlush = true;
    app.quit();
  });
});
