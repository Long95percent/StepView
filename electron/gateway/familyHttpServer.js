import http from "node:http";
import path from "node:path";
import { buildAgentMemory } from "../../src/agentMemory.js";
import { createAccountContext } from "./accountContext.js";
import { createAccountStore } from "./accountStore.js";
import { createContextCache } from "./contextCache.js";
import { streamOpenAIChat } from "../openAiStream.js";
import { createToolRunner, openAiToolSchemas } from "../agent/toolBridge.js";
import { completeChatWithTools } from "../agentChatCompletion.js";

function json(response, status, payload, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": origin || "null",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    Vary: "Origin",
  });
  response.end(JSON.stringify(payload));
}

function sessionFrom(request) {
  const value = String(request.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw Object.assign(new Error("Request body is too large."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 });
  }
}

function toRendererTurn(turn) {
  return { id: turn.turnId, turnId: turn.turnId, userText: turn.userText, assistantText: turn.assistantText, scopeId: turn.sessionId, sessionId: turn.sessionId, route: turn.route, source: turn.source, model: turn.model, status: turn.status, createdAt: turn.createdAt, updatedAt: turn.updatedAt };
}

function serializeSessionView(view) {
  if (!view) return null;
  const turns = (view.turns || []).map(toRendererTurn);
  return { session: view.session, rawTurns: turns, turns, rollingSummary: view.window?.rollingSummary || { text: "", coveredTurnIds: [], updatedAt: null }, sessionState: view.window?.sessionState || {}, promptState: view.window?.promptState || {}, redisPromptState: view.redisPromptState || null, redisWindowState: view.redisWindowState || null, signals: view.signals || [], updatedAt: view.window?.updatedAt || null };
}

function serializeSessionViews(views) {
  return { sessions: Object.fromEntries(Object.entries(views || {}).map(([id, view]) => [id, serializeSessionView(view)])), updatedAt: new Date().toISOString() };
}

async function askOpenAI({ apiKey, model, baseUrl, messages, tools, runTool, complete = completeChatWithTools }) {
  if (!String(apiKey || "").trim()) throw Object.assign(new Error("Missing OpenAI API key."), { statusCode: 400 });
  try {
    return await complete({ apiKey, model, baseUrl, messages, tools, runTool });
  } catch (error) {
    throw Object.assign(new Error(error.message || "OpenAI request failed."), { statusCode: 502 });
  }
}

function diaryListOptions(url) {
  const numberOrUndefined = (name) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : undefined);
  return {
    status: url.searchParams.get("status") || undefined,
    kind: url.searchParams.get("kind") || undefined,
    from: url.searchParams.get("from") || undefined,
    to: url.searchParams.get("to") || undefined,
    tag: url.searchParams.get("tag") || undefined,
    targetType: url.searchParams.get("targetType") || undefined,
    targetId: url.searchParams.get("targetId") || undefined,
    limit: numberOrUndefined("limit"),
    offset: numberOrUndefined("offset"),
  };
}

export function createFamilyHttpServer({ config, dataDir, accountStoreFactory = createAccountStore, accountContextFactory = createAccountContext, openAiStream = streamOpenAIChat, openAiComplete = completeChatWithTools, contextCacheFactory = createContextCache } = {}) {
  if (config?.mode !== "family") throw new Error("Family HTTP server requires STEPVIEW_MODE=family.");
  const accountStore = accountStoreFactory({ dataDir, sessionTtlHours: config.sessionTtlHours });
  const contexts = contextCacheFactory();

  function authenticated(request) {
    const sessionId = sessionFrom(request);
    const account = accountStore.getAccountForSession(sessionId);
    if (!account) throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
    contexts.sweep();
    let context = contexts.get(account.accountId);
    if (!context) {
      context = accountContextFactory({ account, accountsDir: path.join(dataDir, "accounts") });
      contexts.set(account.accountId, context);
    }
    return { sessionId, account, context };
  }

  async function streamAgent(request, response, origin) {
    const { context } = authenticated(request);
    const input = await readBody(request);
    const userText = String(input.userText || "").trim();
    const sessionId = String(input.sessionId || "").trim();
    if (!userText || !sessionId || sessionId === "global") throw Object.assign(new Error("请选择一条活跃任务线会话。"), { statusCode: 400 });
    await context.boardStorage.flushWrites();
    const boardMemory = buildAgentMemory(await context.boardStorage.readBoard());
    context.agentService.syncSessionsFromBoardMemory(boardMemory);
    const prepared = await context.agentService.prepareChat({ sessionId, userText, boardMemory, model: input.model || "gpt-5.1" });
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin || "null",
      Vary: "Origin",
    });
    const send = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      const result = await openAiStream({
        ...input,
        messages: prepared.prompt.messages,
        tools: openAiToolSchemas(context.toolRegistry),
        runTool: createToolRunner(context, sessionId),
        onDelta: (delta) => send({ type: "delta", delta }),
      });
      const view = await context.agentService.completeChat(prepared, { assistantText: result.text, model: result.model, source: "openai" });
      send({ type: "complete", result: { text: result.text, model: result.model, sessionId, session: serializeSessionView(view) } });
    } catch (error) {
      context.agentSqliteStore.completeTurn({ turnId: prepared.turn.turnId, assistantText: "", source: "openai-error", model: input.model || "gpt-5.1", status: "failed" });
      context.agentService.refreshSessionWindow(sessionId);
      send({ type: "error", error: error.message || "Agent stream failed." });
    } finally {
      response.end();
    }
  }

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    if (request.method === "OPTIONS") return json(response, 204, {}, origin);
    const url = new URL(request.url, "http://gateway.local");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { ok: true, mode: "family" }, origin);
      if (request.method === "POST" && url.pathname === "/api/agent/chat/stream") return await streamAgent(request, response, origin);
      if (request.method === "GET" && url.pathname === "/api/gateway") {
        const sessionId = sessionFrom(request);
        return json(response, 200, { mode: "family", account: accountStore.getAccountForSession(sessionId) }, origin);
      }
      if (request.method === "GET" && url.pathname === "/api/settings") {
        authenticated(request);
        return json(response, 200, { openaiApiKey: accountStore.getSetting("openaiApiKey"), openaiBaseUrl: accountStore.getSetting("openaiBaseUrl"), agentModel: accountStore.getSetting("agentModel") }, origin);
      }
      if (request.method === "PUT" && url.pathname === "/api/settings") {
        authenticated(request);
        const input = await readBody(request);
        for (const key of ["openaiApiKey", "openaiBaseUrl", "agentModel"]) if (input[key] !== undefined) accountStore.setSetting(key, input[key]);
        return json(response, 200, { ok: true }, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/accounts/register") {
        if (!config.allowRegistration) throw Object.assign(new Error("Registration is disabled."), { statusCode: 403 });
        const input = await readBody(request);
        accountStore.registerAccount(input);
        return json(response, 201, accountStore.login(input), origin);
      }
      if (request.method === "POST" && url.pathname === "/api/accounts/login") return json(response, 200, accountStore.login(await readBody(request)), origin);
      if (request.method === "POST" && url.pathname === "/api/accounts/logout") {
        const { sessionId } = authenticated(request);
        accountStore.logout(sessionId);
        return json(response, 200, { ok: true }, origin);
      }
      if (request.method === "GET" && url.pathname === "/api/board") return json(response, 200, await authenticated(request).context.boardStorage.readBoard(), origin);
      if (request.method === "PUT" && url.pathname === "/api/board") return json(response, 200, await authenticated(request).context.boardStorage.writeBoard(await readBody(request)), origin);
      // 日记：Electron IPC 与这里共用同一个 diaryService，行为与鉴权完全一致。
      if (request.method === "GET" && url.pathname === "/api/diary") {
        const { context } = authenticated(request);
        return json(response, 200, context.diaryService.list(diaryListOptions(url)), origin);
      }
      if (request.method === "POST" && url.pathname === "/api/diary") {
        const { context } = authenticated(request);
        return json(response, 201, context.diaryService.create(await readBody(request)), origin);
      }
      if (request.method === "GET" && url.pathname === "/api/diary/search") {
        const { context } = authenticated(request);
        const input = diaryListOptions(url);
        return json(response, 200, context.diaryService.search({ ...input, query: url.searchParams.get("q") || "" }), origin);
      }
      if (request.method === "GET" && url.pathname === "/api/diary/tags") {
        const { context } = authenticated(request);
        return json(response, 200, context.diaryService.listTags(), origin);
      }
      if (request.method === "GET" && url.pathname === "/api/diary/timeline") {
        const { context } = authenticated(request);
        return json(response, 200, context.diaryService.timeline(diaryListOptions(url)), origin);
      }
      // 节点上那排"标有日期的按钮"的数据源：某个节点关联到的每日日记，按天去重。
      // 必须放在下面的通用 /api/diary/:id 之前，否则 "days" 会被当成一条日记的 id。
      if (request.method === "GET" && url.pathname === "/api/diary/days") {
        const { context } = authenticated(request);
        return json(response, 200, context.diaryService.listDailyDaysForNode(url.searchParams.get("nodeId") || "", diaryListOptions(url)), origin);
      }
      if (url.pathname === "/api/diary/import-node-notes") {
        const { context } = authenticated(request);
        await context.boardStorage.flushWrites();
        const board = await context.boardStorage.readBoard();
        if (request.method === "GET") return json(response, 200, context.diaryService.previewNodeNoteImport(board), origin);
        if (request.method === "POST") return json(response, 200, context.diaryService.importNodeNotes(board, await readBody(request)), origin);
      }
      const diaryRestoreMatch = /^\/api\/diary\/([^/]+)\/restore$/.exec(url.pathname);
      if (diaryRestoreMatch && request.method === "POST") {
        const { context } = authenticated(request);
        return json(response, 200, context.diaryService.restore(decodeURIComponent(diaryRestoreMatch[1])), origin);
      }
      const diaryRevisionsMatch = /^\/api\/diary\/([^/]+)\/revisions$/.exec(url.pathname);
      if (diaryRevisionsMatch && request.method === "GET") {
        const { context } = authenticated(request);
        const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
        return json(response, 200, context.diaryService.listRevisions(decodeURIComponent(diaryRevisionsMatch[1]), { limit }), origin);
      }
      const diaryEntryMatch = /^\/api\/diary\/([^/]+)$/.exec(url.pathname);
      if (diaryEntryMatch) {
        const { context } = authenticated(request);
        const diaryId = decodeURIComponent(diaryEntryMatch[1]);
        if (request.method === "GET") return json(response, 200, context.diaryService.get(diaryId), origin);
        if (request.method === "PUT") {
          const input = await readBody(request);
          return json(response, 200, context.diaryService.update(diaryId, input, { expectedRev: input?.expectedRev ?? input?.rev }), origin);
        }
        if (request.method === "DELETE") {
          return json(
            response,
            200,
            url.searchParams.get("purge") === "1" ? context.diaryService.remove(diaryId) : context.diaryService.trash(diaryId),
            origin,
          );
        }
      }
      if (request.method === "GET" && url.pathname === "/api/agent/journal") {
        const { context } = authenticated(request);
        await context.boardStorage.flushWrites();
        context.agentService.syncSessionsFromBoardMemory(buildAgentMemory(await context.boardStorage.readBoard()));
        return json(response, 200, serializeSessionViews(await context.agentService.listSessionViews()), origin);
      }
      if (request.method === "GET" && url.pathname === "/api/agent/approvals") {
        const { context } = authenticated(request);
        return json(response, 200, await context.approvalService.list(context.accountId), origin);
      }
      if (request.method === "POST" && url.pathname === "/api/agent/approvals/decide") {
        const { context } = authenticated(request);
        const input = await readBody(request);
        const result = await context.approvalService.decide(String(input.approvalId || ""), context.accountId, String(input.decision || ""));
        return json(response, 200, result, origin);
      }
      if (request.method === "POST" && url.pathname === "/api/agent/chat") {
        const { context } = authenticated(request);
        const input = await readBody(request);
        const userText = String(input.userText || "").trim();
        const sessionId = String(input.sessionId || "").trim();
        if (!userText || !sessionId || sessionId === "global") throw Object.assign(new Error("请选择一条活跃任务线会话。"), { statusCode: 400 });
        await context.boardStorage.flushWrites();
        const boardMemory = buildAgentMemory(await context.boardStorage.readBoard());
        context.agentService.syncSessionsFromBoardMemory(boardMemory);
        const prepared = await context.agentService.prepareChat({ sessionId, userText, boardMemory, model: input.model || "gpt-5.1" });
        try {
          const result = await askOpenAI({
            ...input,
            messages: prepared.prompt.messages,
            tools: openAiToolSchemas(context.toolRegistry),
            runTool: createToolRunner(context, sessionId),
            complete: openAiComplete,
          });
          const view = await context.agentService.completeChat(prepared, { assistantText: result.text, model: result.model, source: "openai" });
          return json(response, 200, { text: result.text, model: result.model, sessionId, session: serializeSessionView(view) }, origin);
        } catch (error) {
          context.agentSqliteStore.completeTurn({ turnId: prepared.turn.turnId, assistantText: "", source: "openai-error", model: input.model || "gpt-5.1", status: "failed" });
          context.agentService.refreshSessionWindow(sessionId);
          throw error;
        }
      }
      return json(response, 404, { error: "Not found." }, origin);
    } catch (error) {
      // 带上 code：界面要靠它区分"版本冲突（重新载入）"和"输入不合法（改内容）"，
      // 只靠 HTTP 状态码不够精确，而且这里和 IPC 通道要能被同一组用例对拍。
      return json(response, error.statusCode || 500, { error: error.message || "Gateway request failed.", code: error.code || null }, origin);
    }
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.httpPort, config.bindHost, () => resolve(server.address())); }),
    close: async () => {
      await contexts.closeAll();
      accountStore.close();
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
