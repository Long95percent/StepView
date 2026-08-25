import { runPreflight } from "../electron/preflight.js";
import { findRedisServer, isManagedRedisUrl } from "../electron/redisManager.js";
import { checkRedis } from "../electron/preflight.js";

const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="));
const mode = modeArgument?.slice("--mode=".length) || process.env.STEPVIEW_MODE || "personal";

try {
  const report = await runPreflight({ mode, skipRedis: true });
  const redisCheck = isManagedRedisUrl(report.config.redisUrl)
    ? await findRedisServer()
      ? { name: "Redis 运行环境", ok: true, detail: "redis-server 已安装，将由 StepView 自动启动" }
      : { name: "Redis 运行环境", ok: false, detail: "未找到 redis-server", fix: "macOS 运行 brew install redis；以后无需单独启动。" }
    : await checkRedis({ url: report.config.redisUrl });
  report.checks.push(redisCheck);
  report.ok = report.checks.every((check) => check.ok);
  console.log(`\nStepView ${report.mode} 启动前检查`);
  for (const check of report.checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    if (!check.ok && check.fix) console.log(`  修复：${check.fix}`);
  }
  if (!report.ok) {
    console.error("\n启动已中止：请修复以上必需项后重试。\n");
    process.exitCode = 1;
  } else {
    console.log("\n所有必需检查通过，开始启动 StepView。\n");
  }
} catch (error) {
  console.error(`\n✗ 配置检查失败：${error.message}`);
  console.error("启动已中止，请修复 .env.local 配置后重试。\n");
  process.exitCode = 1;
}
