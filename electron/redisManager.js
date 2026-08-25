import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRedisClient } from "./agentRedisClient.js";

export function isManagedRedisUrl(redisUrl) {
  const url = new URL(redisUrl);
  return ["127.0.0.1", "localhost", "::1"].includes(url.hostname) && !url.username && !url.password;
}

export function redisServerArguments({ redisUrl, dataDir }) {
  const url = new URL(redisUrl);
  return [
    "--bind", url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
    "--port", url.port || "6379",
    "--protected-mode", "yes",
    "--dir", path.join(dataDir, "redis"),
    "--appendonly", "yes",
    "--appendfsync", "everysec",
    "--save", "60", "100",
    "--daemonize", "no",
  ];
}

export async function findRedisServer({ env = process.env, platform = process.platform } = {}) {
  const candidates = [
    env.STEPVIEW_REDIS_SERVER,
    ...(platform === "win32" ? ["redis-server.exe"] : ["redis-server", "/opt/homebrew/bin/redis-server", "/usr/local/bin/redis-server"]),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {}
      continue;
    }
    const paths = String(env.PATH || "").split(path.delimiter).filter(Boolean);
    for (const directory of paths) {
      const resolved = path.join(directory, candidate);
      try {
        await fs.access(resolved);
        return resolved;
      } catch {}
    }
  }
  return null;
}

async function redisPing(redisUrl, timeoutMs = 1000) {
  const client = createRedisClient({ url: redisUrl });
  try {
    return await Promise.race([
      client.command("PING"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis PING timeout")), timeoutMs)),
    ]);
  } finally {
    await client.close();
  }
}

export async function startManagedRedis({ redisUrl, dataDir, executable, spawnApi = spawn } = {}) {
  try {
    if (await redisPing(redisUrl) === "PONG") return { owned: false, process: null, detail: "复用已运行的 Redis" };
  } catch {}
  if (!isManagedRedisUrl(redisUrl)) throw new Error(`外部 Redis 不可连接：${new URL(redisUrl).host}`);
  const redisExecutable = executable || await findRedisServer();
  if (!redisExecutable) throw new Error("未找到 redis-server。macOS 请运行 brew install redis；或设置 STEPVIEW_REDIS_SERVER。")
  await fs.mkdir(path.join(dataDir, "redis"), { recursive: true });
  const child = spawnApi(redisExecutable, redisServerArguments({ redisUrl, dataDir }), { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr?.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-2000); });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Redis 启动失败：${stderr.trim() || `exit ${child.exitCode}`}`);
    try {
      if (await redisPing(redisUrl, 500) === "PONG") return { owned: true, process: child, detail: `项目 Redis 已启动，数据目录 ${path.join(dataDir, "redis")}` };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error(`Redis 启动超时：${stderr.trim()}`);
}

export async function stopManagedRedis(instance, timeoutMs = 5000) {
  if (!instance?.owned || !instance.process || instance.process.exitCode !== null) return;
  const child = instance.process;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
