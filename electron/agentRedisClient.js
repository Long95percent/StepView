import net from "node:net";

const DEFAULT_REDIS_URL = "redis://127.0.0.1:6379/0";

export function encodeRedisCommand(args) {
  const parts = [`*${args.length}\r\n`];
  for (const arg of args) {
    const value = Buffer.from(String(arg), "utf8");
    parts.push(`$${value.length}\r\n`);
    parts.push(value);
    parts.push("\r\n");
  }
  return Buffer.concat(parts.map((part) => Buffer.isBuffer(part) ? part : Buffer.from(part)));
}

function readLine(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  return { line: buffer.slice(offset, end).toString("utf8"), next: end + 2 };
}

export function parseRedisReply(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset]);
  const line = readLine(buffer, offset + 1);
  if (!line) return null;

  if (prefix === "+") return { value: line.line, next: line.next };
  if (prefix === "-") return { error: new Error(line.line), next: line.next };
  if (prefix === ":") return { value: Number(line.line), next: line.next };

  if (prefix === "$") {
    const length = Number(line.line);
    if (length === -1) return { value: null, next: line.next };
    const start = line.next;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.slice(start, end).toString("utf8"), next: end + 2 };
  }

  if (prefix === "*") {
    const count = Number(line.line);
    if (count === -1) return { value: null, next: line.next };
    const values = [];
    let next = line.next;
    for (let index = 0; index < count; index += 1) {
      const parsed = parseRedisReply(buffer, next);
      if (!parsed) return null;
      if (parsed.error) return { error: parsed.error, next: parsed.next };
      values.push(parsed.value);
      next = parsed.next;
    }
    return { value: values, next };
  }

  throw new Error(`Unsupported Redis reply prefix: ${prefix}`);
}

function parseRedisUrl(redisUrl) {
  const url = new URL(redisUrl || DEFAULT_REDIS_URL);
  const dbIndex = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname || "127.0.0.1",
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    db: Number.isFinite(dbIndex) ? dbIndex : 0,
    tls: url.protocol === "rediss:",
  };
}

function pairsToObject(values) {
  const object = {};
  for (let index = 0; index < values.length; index += 2) {
    object[values[index]] = values[index + 1];
  }
  return object;
}

export function createRedisClient({ url = process.env.REDIS_URL || DEFAULT_REDIS_URL } = {}) {
  const config = parseRedisUrl(url);
  let socket = null;
  let connected = false;
  let connecting = null;
  let buffer = Buffer.alloc(0);
  const pending = [];

  function rejectAll(error) {
    while (pending.length) pending.shift().reject(error);
  }

  function handleData(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    while (pending.length) {
      const parsed = parseRedisReply(buffer);
      if (!parsed) return;
      buffer = buffer.slice(parsed.next);
      const request = pending.shift();
      if (parsed.error) request.reject(parsed.error);
      else request.resolve(parsed.value);
    }
  }

  async function connect() {
    if (connected) return;
    if (connecting) return connecting;
    connecting = new Promise((resolve, reject) => {
      socket = net.createConnection({ host: config.host, port: config.port }, resolve);
      socket.on("data", handleData);
      socket.on("error", (error) => {
        connected = false;
        rejectAll(error);
        reject(error);
      });
      socket.on("close", () => {
        connected = false;
        rejectAll(new Error("Redis connection closed."));
      });
    });
    await connecting;
    connected = true;
    connecting = null;
    if (config.password) {
      if (config.username) await command("AUTH", config.username, config.password);
      else await command("AUTH", config.password);
    }
    if (config.db) await command("SELECT", config.db);
  }

  async function command(...args) {
    if (!connected) await connect();
    return new Promise((resolve, reject) => {
      pending.push({ resolve, reject });
      socket.write(encodeRedisCommand(args));
    });
  }

  async function close() {
    if (!socket) return;
    try {
      await command("QUIT");
    } catch {
      // Closing should be best-effort; Redis may already have dropped the socket.
    }
    socket.destroy();
    socket = null;
    connected = false;
  }

  return { command, connect, close };
}

export function createRedisAgentCache({
  url = process.env.REDIS_URL || DEFAULT_REDIS_URL,
  namespace = "stepview:agent",
  client = createRedisClient({ url }),
} = {}) {
  const sessionSetKey = `${namespace}:sessions`;
  const promptKey = (sessionId) => `${namespace}:session:${sessionId}:prompt`;
  const windowKey = (sessionId) => `${namespace}:session:${sessionId}:window`;

  async function writeJsonHash(key, payload) {
    const updatedAt = new Date().toISOString();
    await client.command("HSET", key, "json", JSON.stringify(payload), "updatedAt", updatedAt);
    return { ...payload, updatedAt };
  }

  async function readJsonHash(key, fallback = null) {
    const values = await client.command("HGETALL", key);
    if (!Array.isArray(values) || values.length === 0) return fallback;
    const object = pairsToObject(values);
    if (!object.json) return fallback;
    try {
      return JSON.parse(object.json);
    } catch {
      return fallback;
    }
  }

  async function savePromptState(sessionId, promptState) {
    await client.command("SADD", sessionSetKey, sessionId);
    return writeJsonHash(promptKey(sessionId), promptState);
  }

  async function loadPromptState(sessionId) {
    return readJsonHash(promptKey(sessionId), null);
  }

  async function saveWindowState(sessionId, windowState) {
    await client.command("SADD", sessionSetKey, sessionId);
    return writeJsonHash(windowKey(sessionId), windowState);
  }

  async function loadWindowState(sessionId) {
    return readJsonHash(windowKey(sessionId), null);
  }

  async function listSessionIds() {
    const values = await client.command("SMEMBERS", sessionSetKey);
    return Array.isArray(values) ? values : [];
  }

  return {
    connect: client.connect,
    close: client.close,
    savePromptState,
    loadPromptState,
    saveWindowState,
    loadWindowState,
    listSessionIds,
  };
}

