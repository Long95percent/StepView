import fs from "node:fs/promises";
import fsSync from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { loadConfig } from "./config.js";
import { validateNetworkPolicy } from "./gateway/networkPolicy.js";
import { createRedisClient } from "./agentRedisClient.js";

const MIN_NODE_MAJOR = 22;
const REQUIRED_PACKAGES = ["vite", "react", "react-dom", "npm-run-all", "cross-env"];

function result(name, ok, detail, fix = "") {
  return { name, ok, detail, fix };
}

export function checkNodeVersion(version = process.versions.node) {
  const major = Number(String(version).split(".")[0]);
  return Number.isInteger(major) && major >= MIN_NODE_MAJOR
    ? result("Node.js", true, `v${version}`)
    : result("Node.js", false, `需要 Node.js >= ${MIN_NODE_MAJOR}，当前为 v${version}`, `安装 Node.js ${MIN_NODE_MAJOR} 或更高版本。`);
}

export function checkDependencies({ cwd = process.cwd(), packages = REQUIRED_PACKAGES } = {}) {
  const require = createRequire(path.join(cwd, "package.json"));
  const missing = packages.filter((packageName) => {
    if (fsSync.existsSync(path.join(cwd, "node_modules", packageName, "package.json"))) return false;
    try {
      require.resolve(packageName);
      return false;
    } catch {
      return true;
    }
  });
  return missing.length
    ? result("项目依赖", false, `缺少：${missing.join(", ")}`, "运行 npm install。")
    : result("项目依赖", true, `${packages.length} 个核心包已安装`);
}

export async function checkDataDirectory(dataDir) {
  const resolved = path.resolve(dataDir);
  const probePath = path.join(resolved, `.stepview-preflight-${process.pid}`);
  try {
    await fs.mkdir(resolved, { recursive: true });
    await fs.writeFile(probePath, "StepView preflight\n", "utf8");
    await fs.unlink(probePath);
    const database = new DatabaseSync(":memory:");
    database.exec("CREATE TABLE preflight (ok INTEGER)");
    database.close();
    return result("存储与 SQLite", true, resolved);
  } catch (error) {
    await fs.unlink(probePath).catch(() => {});
    return result("存储与 SQLite", false, error.message, `确认目录可写：${resolved}`);
  }
}

export function checkPortAvailable({ host, port }) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => resolve(result(`端口 ${port}`, false, `${host}:${port} ${error.code || error.message}`, `停止占用 ${port} 端口的进程，或修改对应端口配置。`)));
    server.listen(port, host, () => server.close(() => resolve(result(`端口 ${port}`, true, `${host}:${port} 可用`))));
  });
}

export async function checkRedis({ url = process.env.REDIS_URL || "redis://127.0.0.1:6379/0", clientFactory = createRedisClient } = {}) {
  let client;
  try {
    client = clientFactory({ url });
    const reply = await Promise.race([
      client.command("PING"),
      new Promise((_, reject) => setTimeout(() => reject(new Error("连接超时")), 3000)),
    ]);
    if (reply !== "PONG") throw new Error(`PING 返回 ${String(reply)}`);
    return result("Redis", true, new URL(url).host);
  } catch (error) {
    return result("Redis", false, `${new URL(url).host} ${error.code || error.message}`, "启动 Redis 后确认 redis-cli ping 返回 PONG；或设置正确的 REDIS_URL。")
  } finally {
    await client?.close?.();
  }
}

export async function runPreflight({ mode = process.env.STEPVIEW_MODE || "personal", cwd = process.cwd(), env = process.env, skipRedis = false } = {}) {
  const config = loadConfig({ env: { ...env, STEPVIEW_MODE: mode }, envFilePath: path.join(cwd, ".env.local") });
  validateNetworkPolicy({ mode: config.mode, host: config.bindHost, allowLan: config.allowLan, enableUpnp: config.enableUpnp, containerized: config.containerized });
  const dataDir = config.dataDir
    ? path.resolve(config.dataDir)
    : mode === "family" ? path.join(cwd, ".stepview-family-data") : path.join(cwd, ".stepview-personal-data");
  const checks = [
    checkNodeVersion(),
    checkDependencies({ cwd }),
    await checkDataDirectory(dataDir),
    await checkPortAvailable({ host: "0.0.0.0", port: 5173 }),
    ...(mode === "family" ? [await checkPortAvailable({ host: config.bindHost, port: config.httpPort })] : []),
    ...(!skipRedis ? [await checkRedis({ url: config.redisUrl })] : []),
  ];
  return { mode, config, checks, ok: checks.every((check) => check.ok) };
}
