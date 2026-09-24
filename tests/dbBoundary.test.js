import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["electron", "src"];
const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const DB_LAYER = "electron/db/";

/**
 * 数据库层边界。
 *
 * 这些规则不靠自觉，靠这个测试强制执行：新增违规会让测试失败，
 * 重构完成后没删掉豁免项也会让测试失败（豁免名单只能变小，不能变大）。
 */
const RULES = [
  {
    id: "sqlite-driver",
    description: "只有 electron/db/ 可以直接使用 SQLite 驱动，其他模块必须通过仓储访问数据。",
    pattern: /\bnode:sqlite\b/g,
    allowPrefixes: [DB_LAYER],
  },
  {
    id: "fs-write",
    description: "只有 electron/db/ 可以直接写文件，其他模块必须通过仓储访问数据。",
    pattern: /\.(?:writeFile|writeFileSync|mkdir|mkdirSync|unlink|unlinkSync|renameSync|copyFile|copyFileSync|appendFile|appendFileSync|rmSync|createWriteStream)\(/g,
    allowPrefixes: [DB_LAYER],
  },
  {
    id: "raw-sql",
    description: "只有 electron/db/ 可以执行 SQL，其他模块必须通过仓储访问数据。",
    pattern: /\b(?:db|database|connection|sqliteStore)\s*\.\s*(?:prepare|exec)\s*\(/g,
    allowPrefixes: [DB_LAYER],
  },
  {
    id: "raw-delete",
    description: "删除语句只允许出现在 electron/db/ 内，批量清理只能由 retention.js 执行。",
    pattern: /\bDELETE\s+FROM\b/gi,
    allowPrefixes: [DB_LAYER],
  },
  {
    id: "plaintext-password",
    description: "不得把密码写入 localStorage。",
    pattern: /localStorage\.setItem\([^\n]*\bpassword\b/g,
    allowPrefixes: [],
  },
];

/**
 * 历史遗留豁免名单。
 *
 * 每一项都必须在计划里的对应阶段被移除。重构完成后如果条目变成“已经没有违规”，
 * 测试会失败，提醒你把它删掉，避免豁免名单悄悄扩大。
 */
const DEBT = [
  { file: "electron/preflight.js", rules: ["sqlite-driver", "fs-write", "raw-sql"], permanent: true, reason: "环境自检探针，需要真实探测 SQLite 可写与驱动可用" },
  { file: "electron/redisManager.js", rules: ["fs-write"], permanent: true, reason: "负责探测与拉起本机 Redis 进程" },
  { file: "electron/gateway/accountStore.js", rules: ["sqlite-driver", "fs-write", "raw-sql", "raw-delete"], removeIn: "Phase 4", reason: "全局库仍是手写建表，改为迁移器管理" },
  { file: "electron/agentJournalStorage.js", rules: ["fs-write"], removeIn: "Phase 4", reason: "已被 Agent SQLite 库取代的死代码，待删除" },
  { file: "electron/agent/knowledgeBaseRegistry.js", rules: ["fs-write"], removeIn: "Phase 4", reason: "知识库用 JSON 目录，迁入表与 blobs 后删除" },
  { file: "src/main.jsx", rules: ["plaintext-password"], removeIn: "Phase 5", reason: "浏览器模式把明文密码写进了 localStorage" },
];

function walk(dir, collected = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, collected);
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name))) collected.push(full);
  }
  return collected;
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function scanSourceFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = path.join(ROOT, dir);
    if (!statSync(full).isDirectory()) continue;
    for (const file of walk(full)) files.push({ file: relative(file), text: readFileSync(file, "utf8") });
  }
  return files;
}

function isAllowed(file, rule) {
  return rule.allowPrefixes.some((prefix) => file === prefix.replace(/\/$/, "") || file.startsWith(prefix));
}

function findViolations() {
  const violations = [];
  for (const { file, text } of scanSourceFiles()) {
    for (const rule of RULES) {
      if (isAllowed(file, rule)) continue;
      const matches = text.match(rule.pattern);
      if (matches?.length) violations.push({ file, ruleId: rule.id, count: matches.length });
    }
  }
  return violations;
}

const debtFor = (file) => DEBT.find((entry) => entry.file === file);

describe("database layer boundary", () => {
  it("defines every boundary rule with a human readable description", () => {
    for (const rule of RULES) {
      expect(rule.description.length).toBeGreaterThan(10);
      expect(rule.allowPrefixes).toBeInstanceOf(Array);
    }
  });

  it("keeps sqlite, file writes and raw SQL inside electron/db/", () => {
    const unlisted = findViolations().filter((violation) => {
      const debt = debtFor(violation.file);
      return !debt || !debt.rules.includes(violation.ruleId);
    });
    const summary = unlisted.map((violation) => {
      const rule = RULES.find((candidate) => candidate.id === violation.ruleId);
      return `${violation.file} 违反「${violation.ruleId}」：${rule.description}`;
    });
    expect(summary).toEqual([]);
  });

  it("does not keep stale exemption entries around", () => {
    const violations = findViolations();
    const stale = [];
    for (const entry of DEBT) {
      // 逐条规则检查：某一条豁免已经不再违规也算失效，必须删掉，
      // 否则豁免名单会只增不减地糊在文件上。
      for (const ruleId of entry.rules) {
        const hits = violations.filter((violation) => violation.file === entry.file && violation.ruleId === ruleId);
        if (hits.length === 0) stale.push(`${entry.file}#${ruleId}`);
      }
      expect(entry.permanent || entry.removeIn, `${entry.file} 必须标注永久豁免或计划移除阶段`).toBeTruthy();
      expect(entry.reason, `${entry.file} 必须写明豁免原因`).toBeTruthy();
    }
    expect(stale, `以下豁免已经失效，请从 DEBT 名单中删除：${stale.join("、")}`).toEqual([]);
  });

  it("points every remaining exemption at a phase in the plan", () => {
    const temporary = DEBT.filter((entry) => !entry.permanent);
    expect(temporary.length).toBeGreaterThan(0);
    for (const entry of temporary) {
      expect(entry.removeIn).toMatch(/^Phase \d+$/);
    }
  });
});
