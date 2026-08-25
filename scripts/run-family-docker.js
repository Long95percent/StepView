import { spawn, spawnSync } from "node:child_process";
import { runPreflight } from "../electron/preflight.js";

function dockerResult(args) {
  return spawnSync("docker", args, { encoding: "utf8" });
}

function requireDocker() {
  const version = dockerResult(["compose", "version"]);
  if (version.status !== 0) throw new Error("未找到 Docker Compose。请安装并启动 Docker Desktop。");
  const daemon = dockerResult(["info", "--format", "{{.ServerVersion}}"]);
  if (daemon.status !== 0) throw new Error("Docker Desktop 尚未运行。请启动 Docker Desktop 后重试。");
  return daemon.stdout.trim();
}

function requireLocalImages() {
  const requiredImages = ["node:22-bookworm-slim", "nginx:1.27-alpine", "redis:7.4-alpine"];
  const missing = requiredImages.filter((image) => dockerResult(["image", "inspect", image]).status !== 0);
  if (missing.length) {
    throw new Error(`本机缺少镜像：${missing.join(", ")}。启动器已禁用自动拉取，请先显式执行 docker pull。`);
  }
  return requiredImages;
}

function printChecks(report) {
  console.log("\nStepView family Docker 启动前检查");
  for (const check of report.checks) {
    console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    if (!check.ok && check.fix) console.log(`  修复：${check.fix}`);
  }
}

try {
  const checkOnly = process.argv.includes("--check");
  const dockerVersion = requireDocker();
  const localImages = requireLocalImages();
  const report = await runPreflight({ mode: "family", skipRedis: true });
  printChecks(report);
  console.log(`✓ Docker Engine: ${dockerVersion}`);
  console.log(`✓ 本地镜像: ${localImages.join(", ")}`);
  if (!report.ok) throw new Error("启动前检查未通过。");
  if (checkOnly) {
    console.log("\n所有家庭版 Docker 启动检查均已通过。\n");
    process.exit(0);
  }
  console.log("\n正在使用本机已有镜像构建并启动 StepView（禁止自动拉取）...\n");
  const child = spawn("docker", ["compose", "up", "--build", "--pull", "never"], { stdio: "inherit" });
  child.once("exit", (code) => { process.exitCode = code ?? 1; });
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
} catch (error) {
  console.error(`\n✗ 启动失败：${error.message}\n`);
  process.exitCode = 1;
}
