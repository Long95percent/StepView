import path from "node:path";
import { spawn } from "node:child_process";
import { loadConfig } from "../electron/config.js";
import { runPreflight } from "../electron/preflight.js";
import { startManagedRedis, stopManagedRedis } from "../electron/redisManager.js";

const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) || "personal";
const cwd = process.cwd();
const config = loadConfig({ env: { ...process.env, STEPVIEW_MODE: mode }, envFilePath: path.join(cwd, ".env.local") });
const dataDir = config.dataDir ? path.resolve(config.dataDir) : path.join(cwd, mode === "family" ? ".stepview-family-data" : ".stepview-personal-data");
let redisInstance;
let application;
let shuttingDown = false;

function printChecks(report) {
  console.log(`\nStepView ${mode} 启动前检查`);
  for (const check of report.checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    if (!check.ok && check.fix) console.log(`  修复：${check.fix}`);
  }
}

async function shutdown(signal = "SIGTERM") {
  if (shuttingDown) return;
  shuttingDown = true;
  if (application?.exitCode === null) application.kill(signal);
  await stopManagedRedis(redisInstance);
}

try {
  const report = await runPreflight({ mode, skipRedis: true });
  printChecks(report);
  if (!report.ok) throw new Error("启动前基础检查未通过。");
  redisInstance = await startManagedRedis({ redisUrl: config.redisUrl, dataDir });
  console.log(`✓ Redis: ${redisInstance.detail}`);
  console.log("\n所有必需检查通过，开始启动 StepView。\n");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const script = mode === "family" ? "start:family" : "start:desktop";
  application = spawn(npmCommand, ["run", script], { cwd, env: { ...process.env, STEPVIEW_MODE: mode, REDIS_URL: config.redisUrl }, stdio: "inherit" });
  application.once("exit", async (code, signal) => {
    await shutdown(signal || "SIGTERM");
    process.exitCode = code ?? 1;
  });
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
} catch (error) {
  console.error(`\n✗ 启动失败：${error.message}\n`);
  await shutdown();
  process.exitCode = 1;
}
