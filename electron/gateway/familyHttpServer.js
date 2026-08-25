import http from "node:http";
import path from "node:path";
import { buildAgentMemory } from "../../src/agentMemory.js";
import { createAccountContext } from "./accountContext.js";
import { createAccountStore } from "./accountStore.js";
import { streamOpenAIChat } from "../openAiStream.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

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

async function askOpenAI({ apiKey, model, baseUrl, messages }) {
  if (!String(apiKey || "").trim()) throw Object.assign(new Error("Missing OpenAI API key."), { statusCode: 400 });
  const selectedModel = String(model || "gpt-5.1").trim() || "gpt-5.1";
  const root = String(baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, "");
  const response = await fetch(`${root}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${String(apiKey).trim()}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: selectedModel, messages }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || `OpenAI request failed with ${response.status}.`), { statusCode: 502 });
  return { text: payload.choices?.[0]?.message?.content?.trim() || "OpenAI returned an empty response.", model: selectedModel };
}

export function createFamilyHttpServer({ config, dataDir, accountStoreFactory = createAccountStore, accountContextFactory = createAccountContext, openAiStream = streamOpenAIChat } = {}) {
  if (config?.mode !== "family") throw new Error("Family HTTP server requires STEPVIEW_MODE=family.");
  const accountStore = accountStoreFactory({ dataDir, sessionTtlHours: config.sessionTtlHours });
  const contexts = new Map();

  function authenticated(request) {
    const sessionId = sessionFrom(request);
    const account = accountStore.getAccountForSession(sessionId);
    if (!account) throw Object.assign(new Error("Authentication required."), { statusCode: 401 });
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
      const result = await openAiStream({ ...input, messages: prepared.prompt.messages, onDelta: (delta) => send({ type: "delta", delta }) });
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
      if (request.method === "GET" && url.pathname === "/api/agent/journal") {
        const { context } = authenticated(request);
        await context.boardStorage.flushWrites();
        context.agentService.syncSessionsFromBoardMemory(buildAgentMemory(await context.boardStorage.readBoard()));
        return json(response, 200, serializeSessionViews(context.agentService.listSessionViews()), origin);
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
          const result = await askOpenAI({ ...input, messages: prepared.prompt.messages });
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
      return json(response, error.statusCode || 500, { error: error.message || "Gateway request failed." }, origin);
    }
  });

  return {
    server,
    listen: () => new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.httpPort, config.bindHost, () => resolve(server.address())); }),
    close: async () => {
      await Promise.all([...contexts.values()].map((context) => context.close()));
      accountStore.close();
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
