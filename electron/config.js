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
  };
}

export const defaultConfig = DEFAULTS;