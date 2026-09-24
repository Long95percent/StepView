import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openAccountDatabase, openGlobalDatabase } from "../electron/db/index.js";
import {
  ACCOUNT_REQUIRED_TABLES,
  ARCHIVE_FORMAT,
  ARCHIVE_MANIFEST_FILE,
  ArchiveError,
  GLOBAL_REQUIRED_TABLES,
  exportArchive,
  inspectArchive,
  listArchiveContents,
  restoreArchive,
} from "../electron/db/archive.js";
import { createApprovalRepository } from "../electron/db/repositories/approvalRepository.js";
import { createBoardRepository } from "../electron/db/repositories/boardRepository.js";
import { createDiaryRepository } from "../electron/db/repositories/diaryRepository.js";
import { createAccountStore } from "../electron/gateway/accountStore.js";
import { MIGRATIONS } from "../electron/db/migrations/index.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";

const NOW = new Date("2026-09-24T10:00:00.000Z");
const SILENT = { info() {}, warn() {} };
const SUPPORTED = { global: 1, account: 8 };
const REQUIRED = { global: GLOBAL_REQUIRED_TABLES, account: ACCOUNT_REQUIRED_TABLES };

describe("database archive", () => {
  let tempDir;
  const opened = [];

  afterEach(async () => {
    while (opened.length) opened.pop().close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  /** 造一份"正在使用"的数据目录：全局库 + 账号库，都塞点真实数据。 */
  async function makeDataDir(name = "source") {
    const dataDir = path.join(tempDir, name);
    fs.mkdirSync(dataDir, { recursive: true });

    const globalDb = openGlobalDatabase({ dataDir });
    opened.push(globalDb);
    const accountStore = createAccountStore({ dataDir, globalDatabase: globalDb });
    accountStore.registerAccount({ username: "alice", password: "password-1" });
    accountStore.close();

    const accountDb = openAccountDatabase({ dataDir });
    opened.push(accountDb);
    createBoardRepository({ connection: accountDb }).save(normalizeBoard({ tasks: [buildTask("考研", { x: 1, y: 2 }, NOW)] }));
    createApprovalRepository({ connection: accountDb }).create({
      approvalId: "approval-1",
      accountId: "account-a",
      kind: "memory_upsert",
      status: "pending",
      summary: "记住这件事",
      createdAt: NOW.toISOString(),
    });
    createDiaryRepository({ connection: accountDb, accountId: "account-a" }).create(
      { occurredAt: NOW.toISOString(), occurredDay: "2026-09-24", timezone: "UTC", title: "第一篇", content: "写点什么", status: "active", source: "manual", tags: [], links: [] },
      { now: NOW },
    );
    return { dataDir, globalDbPath: path.join(dataDir, "gateway.sqlite"), accountDbPath: path.join(dataDir, "stepview.sqlite") };
  }

  function closeAll() {
    while (opened.length) opened.pop().close();
  }

  it("exports both databases into one directory with a manifest", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");

    const result = exportArchive({ ...source, targetDir, logger: SILENT, now: NOW, appVersion: "1.0.0", label: "manual" });
    expect(result.manifest).toMatchObject({ format: ARCHIVE_FORMAT, formatVersion: 1, appVersion: "1.0.0", exportedAt: NOW.toISOString() });
    expect(result.manifest.databases.map((entry) => entry.name)).toEqual(["global", "account"]);
    expect(fs.existsSync(path.join(targetDir, "gateway.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "stepview.sqlite"))).toBe(true);

    const account = result.manifest.databases[1];
    expect(account.schemaVersion).toBe(8);
    const rowsOf = (name) => account.tables.find((table) => table.name === name)?.rows;
    expect(rowsOf("board_documents")).toBe(1);
    expect(rowsOf("approvals")).toBe(1);
    expect(rowsOf("diary_entries")).toBe(1);
    // FTS5 的影子表不该出现在清单里
    expect(account.tables.some((table) => table.name.startsWith("diary_fts_"))).toBe(false);
    expect(account.tables.some((table) => table.name === "diary_fts")).toBe(true);
  });

  it("tolerates a database that legitimately does not exist, but only when told to", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export-account-only");
    const missingGlobal = { ...source, globalDbPath: path.join(tempDir, "not-there.sqlite") };

    // 个人模式没有全局库：标成可选就只导账号库，并如实告诉调用方少了谁。
    const result = exportArchive({ ...missingGlobal, targetDir, logger: SILENT, optionalDatabases: ["global"] });
    expect(result.manifest.databases.map((entry) => entry.name)).toEqual(["account"]);
    expect(result.skipped).toEqual(["global"]);
    expect(inspectArchive({ dir: targetDir, expectedSchemaVersion: SUPPORTED, requiredTables: REQUIRED }).ok).toBe(true);

    // 没标可选的库不见了，必须报错：否则用户会拿到一份看着正常、其实缺数据的备份。
    const strictDir = path.join(tempDir, "export-strict");
    expect(() => exportArchive({ ...missingGlobal, targetDir: strictDir, logger: SILENT })).toThrowError(
      expect.objectContaining({ code: "ARCHIVE_DB_MISSING" }),
    );
    expect(fs.existsSync(strictDir)).toBe(false);
  });

  it("reads back the manifest that was written to disk", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW });

    const onDisk = JSON.parse(await readFile(path.join(targetDir, ARCHIVE_MANIFEST_FILE), "utf8"));
    expect(onDisk.databases).toHaveLength(2);
    expect(listArchiveContents(targetDir).databases.map((entry) => entry.fileName)).toEqual(["gateway.sqlite", "stepview.sqlite"]);
  });

  it("accepts a good archive and reports what is inside it", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW });

    const report = inspectArchive({ dir: targetDir, expectedSchemaVersion: SUPPORTED, requiredTables: REQUIRED });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.databases[1]).toMatchObject({ name: "account", actual: { schemaVersion: 8 } });
  });

  it("reports every problem it finds instead of stopping at the first one", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW });

    fs.rmSync(path.join(targetDir, "stepview.sqlite"));
    // 两个互不相关的问题：账号库文件不见了，全局库又少了一张要求的表。两个都要报出来。
    const report = inspectArchive({
      dir: targetDir,
      expectedSchemaVersion: SUPPORTED,
      requiredTables: { global: [...GLOBAL_REQUIRED_TABLES, "kv"], account: ACCOUNT_REQUIRED_TABLES },
    });
    expect(report.ok).toBe(false);
    const codes = report.problems.map((problem) => problem.code);
    expect(codes).toContain("ARCHIVE_DB_MISSING");
    expect(codes).toContain("ARCHIVE_TABLE_MISSING");
  });

  it("refuses a corrupt database file", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW });
    await writeFile(path.join(targetDir, "stepview.sqlite"), "this is not a database at all", "utf8");

    const report = inspectArchive({ dir: targetDir, expectedSchemaVersion: SUPPORTED, requiredTables: REQUIRED });
    expect(report.ok).toBe(false);
    expect(report.problems.map((problem) => problem.code)).toContain("ARCHIVE_DB_CORRUPT");
  });

  it("refuses an archive written by a newer schema", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW });

    const report = inspectArchive({ dir: targetDir, expectedSchemaVersion: { account: 3 }, requiredTables: REQUIRED });
    expect(report.ok).toBe(false);
    expect(report.problems.map((problem) => problem.code)).toContain("ARCHIVE_SCHEMA_TOO_NEW");
  });

  it("refuses something that is not an archive at all", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stepview-archive-"));
    expect(() => inspectArchive({ dir: tempDir })).not.toThrow();
    expect(inspectArchive({ dir: tempDir })).toMatchObject({ ok: false, problems: [{ code: "ARCHIVE_MANIFEST_MISSING" }] });
  });

  it("accepts a backup taken with an older schema and upgrades it on open", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const sourceDir = path.join(tempDir, "old");
    // 用只跑到第 6 版的迁移建库：这份备份天然没有日记相关的表。
    const oldDb = openAccountDatabase({ dataDir: sourceDir, migrations: MIGRATIONS.slice(0, 6), importLegacy: false });
    createBoardRepository({ connection: oldDb }).save(normalizeBoard({ tasks: [buildTask("老备份", { x: 1, y: 2 }, NOW)] }));
    oldDb.close();

    const targetDir = path.join(tempDir, "export-old");
    const result = exportArchive({
      accountDbPath: path.join(sourceDir, "stepview.sqlite"),
      targetDir,
      logger: SILENT,
      optionalDatabases: ["global"],
    });
    expect(result.manifest.databases[0].schemaVersion).toBe(6);

    // 老备份缺后来才加的表，不算"备份不完整"——把新表列成必需会让三个月前的备份无法恢复。
    const report = inspectArchive({ dir: targetDir });
    expect(report.problems).toEqual([]);
    expect(report.ok).toBe(true);

    // 恢复之后照常打开：迁移补齐到当前版本，数据还在。
    const restoredDir = path.join(tempDir, "restored-old");
    fs.mkdirSync(restoredDir, { recursive: true });
    restoreArchive({ dir: targetDir, targets: { account: path.join(restoredDir, "stepview.sqlite") }, now: NOW });

    const reopened = openAccountDatabase({ dataDir: restoredDir });
    opened.push(reopened);
    expect(createBoardRepository({ connection: reopened }).readBoard().tasks[0].title).toBe("老备份");
    expect(reopened.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version).toBe(8);
  });

  it("checks a backup without touching a single byte of it", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT });

    const snapshot = (name) => {
      const stats = fs.statSync(path.join(targetDir, name));
      return { bytes: stats.size, mtimeMs: stats.mtimeMs };
    };
    const before = { entries: fs.readdirSync(targetDir).sort(), sqlite: snapshot("stepview.sqlite") };

    expect(inspectArchive({ dir: targetDir }).ok).toBe(true);
    expect(listArchiveContents(targetDir).databases).toHaveLength(2);

    // 校验是只读的：备份文件一个字节都不能变，也不能多出 -wal / -shm 之类的边角文件。
    expect(fs.readdirSync(targetDir).sort()).toEqual(before.entries);
    expect(snapshot("stepview.sqlite")).toEqual(before.sqlite);
  });

  it("keeps the current databases aside and cleans stale WAL files on restore", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW, label: "before-wipe" });
    closeAll();

    // 用户把数据改坏/清空：备份恢复后应该回到导出时的状态。
    const wiped = path.join(tempDir, "wiped");
    fs.mkdirSync(wiped, { recursive: true });
    const wipedDb = openAccountDatabase({ dataDir: wiped });
    createBoardRepository({ connection: wipedDb }).save(normalizeBoard({ tasks: [] }));
    wipedDb.close();
    fs.writeFileSync(path.join(wiped, "stepview.sqlite-wal"), "stale wal", "utf8");

    const result = restoreArchive({
      dir: targetDir,
      targets: { global: path.join(wiped, "gateway.sqlite"), account: path.join(wiped, "stepview.sqlite") },
      expectedSchemaVersion: SUPPORTED,
      requiredTables: REQUIRED,
      now: new Date("2026-09-25T00:00:00.000Z"),
    });

    expect(result.restored.map((entry) => entry.name)).toEqual(["global", "account"]);
    expect(result.kept.map((entry) => entry.name)).toEqual(["account"]);
    expect(result.kept[0].path).toBe(path.join(wiped, "stepview.sqlite.pre-restore-2026-09-25T00-00-00-000Z"));
    // 旧库原样留着，没被删掉
    expect(fs.existsSync(result.kept[0].path)).toBe(true);
    // 旧库的 WAL 不能留下：套在新库上会把新库读坏
    expect(fs.existsSync(path.join(wiped, "stepview.sqlite-wal"))).toBe(false);

    const restoredDb = openAccountDatabase({ dataDir: wiped });
    opened.push(restoredDb);
    const board = createBoardRepository({ connection: restoredDb }).readBoard();
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0].title).toBe("考研");
  });

  it("changes nothing when the archive does not pass inspection", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW });
    await writeFile(path.join(targetDir, "stepview.sqlite"), "broken", "utf8");
    closeAll();

    const wiped = path.join(tempDir, "wiped");
    fs.mkdirSync(wiped, { recursive: true });
    const wipedDb = openAccountDatabase({ dataDir: wiped });
    createBoardRepository({ connection: wipedDb }).save(normalizeBoard({ tasks: [buildTask("本来的数据", { x: 0, y: 0 }, NOW)] }));
    wipedDb.close();

    expect(() =>
      restoreArchive({
        dir: targetDir,
        targets: { account: path.join(wiped, "stepview.sqlite") },
        expectedSchemaVersion: SUPPORTED,
        requiredTables: REQUIRED,
      }),
    ).toThrow(ArchiveError);
    expect(fs.readdirSync(wiped).filter((name) => name.includes("pre-restore"))).toEqual([]);

    const stillThere = openAccountDatabase({ dataDir: wiped });
    opened.push(stillThere);
    expect(createBoardRepository({ connection: stillThere }).readBoard().tasks[0].title).toBe("本来的数据");
  });

  it("refuses to replace databases while the app still holds a connection", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-archive-"));
    const source = await makeDataDir("source");
    const targetDir = path.join(tempDir, "export");
    exportArchive({ ...source, targetDir, logger: SILENT, now: NOW });
    closeAll();

    expect(() =>
      restoreArchive({
        dir: targetDir,
        targets: { account: source.accountDbPath },
        expectedSchemaVersion: SUPPORTED,
        requiredTables: REQUIRED,
        canRestore: () => false,
      }),
    ).toThrowError(expect.objectContaining({ code: "ARCHIVE_DB_IN_USE" }));
  });
});
