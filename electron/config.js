import fs from "node:fs";
import path from "node:path";

const DEFAULTS = {
  mode: "personal",
  gateway: "local",
  dataDir: "",
  llmProvider: "openai",
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiModel: "gpt-5.1",
  allowRegistration: true,
  sessionTtlHours: 168,
  httpPort: 3210,
  bindHost: "127.0.0.1",
  allowedOrigins: "",
  secretKey: "",
  allowLan: false,
  enableUpnp: false,
  redisUrl: "redis://127.0.0.1:6379/0",
  containerized: false,
};

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of String(contents || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function booleanValue(value, key) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${key} must be true or false.`);
}

function positiveNumber(value, key) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${key} must be a positive number.`);
  return parsed;
}

/**
 * 逗号分隔的跨域白名单。
 *
 * 默认**空**，也就是"不发任何 CORS 响应头"。正常部署里前端和网关同源
 * （都走同一个反向代理），浏览器压根不发跨域请求，不需要白名单。
 * 只有前端确实部署在另一个源时，才在这里列出它。
 */
function originList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function loadConfig({ env = process.env, envFilePath = path.resolve(process.cwd(), ".env.local"), fsApi = fs } = {}) {
  let fileEnv = {};
  try {
    fileEnv = parseEnvFile(fsApi.readFileSync(envFilePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const values = { ...fileEnv, ...env };
  const mode = values.STEPVIEW_MODE || DEFAULTS.mode;
  const gateway = values.STEPVIEW_GATEWAY || DEFAULTS.gateway;
  if (!['personal', 'family'].includes(mode)) throw new Error("STEPVIEW_MODE must be personal or family.");
  if (gateway !== "local") throw new Error("STEPVIEW_GATEWAY must be local.");

  return {
    mode,
    gateway,
    dataDir: values.STEPVIEW_DATA_DIR || DEFAULTS.dataDir,
    llmProvider: values.STEPVIEW_LLM_PROVIDER || DEFAULTS.llmProvider,
    openAiBaseUrl: values.STEPVIEW_OPENAI_BASE_URL || DEFAULTS.openAiBaseUrl,
    openAiModel: values.STEPVIEW_OPENAI_MODEL || DEFAULTS.openAiModel,
    allowRegistration: booleanValue(values.STEPVIEW_ALLOW_REGISTRATION ?? DEFAULTS.allowRegistration, "STEPVIEW_ALLOW_REGISTRATION"),
    sessionTtlHours: positiveNumber(values.STEPVIEW_SESSION_TTL_HOURS ?? DEFAULTS.sessionTtlHours, "STEPVIEW_SESSION_TTL_HOURS"),
    httpPort: positiveNumber(values.STEPVIEW_HTTP_PORT ?? DEFAULTS.httpPort, "STEPVIEW_HTTP_PORT"),
    bindHost: values.STEPVIEW_BIND_HOST || DEFAULTS.bindHost,
    allowedOrigins: originList(values.STEPVIEW_ALLOWED_ORIGINS ?? DEFAULTS.allowedOrigins),
    // 用来加密落库的 API Key（见 electron/secretBox.js）。不进数据库，只从环境来。
    secretKey: values.STEPVIEW_SECRET_KEY || DEFAULTS.secretKey,
    allowLan: booleanValue(values.STEPVIEW_ALLOW_LAN ?? DEFAULTS.allowLan, "STEPVIEW_ALLOW_LAN"),
    enableUpnp: booleanValue(values.STEPVIEW_ENABLE_UPNP ?? DEFAULTS.enableUpnp, "STEPVIEW_ENABLE_UPNP"),
    redisUrl: values.REDIS_URL || DEFAULTS.redisUrl,
    containerized: booleanValue(values.STEPVIEW_CONTAINERIZED ?? DEFAULTS.containerized, "STEPVIEW_CONTAINERIZED"),
  };
}

export const defaultConfig = DEFAULTS;

/**
 * 数据目录到底在哪。
 *
 * "数据存在哪"这件事只应该有一处答案：启动脚本、启动自检、建号 CLI 都走这里，
 * 否则迟早会出现"CLI 建的账号服务端看不见"。
 */
export function resolveDataDir({ mode = DEFAULTS.mode, dataDir = "", cwd = process.cwd() } = {}) {
  if (dataDir) return path.resolve(dataDir);
  return path.resolve(cwd, mode === "family" ? ".stepview-family-data" : ".stepview-personal-data");
}
