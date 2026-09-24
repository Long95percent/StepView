import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAccountDatabase } from "../electron/db/index.js";
import { createDiaryRepository, DiaryRevisionConflictError } from "../electron/db/repositories/diaryRepository.js";
import { createDiaryService } from "../electron/diaryService.js";

const NOW = new Date("2026-09-24T10:00:00.000Z");

function nodeBoard() {
  return {
    tasks: [
      {
        id: "task-1",
        title: "考研复习",
        nodes: [
          { id: "node-1", title: "背单词", detail: "今天背了 50 个词，明天继续", timestamp: "2026-09-23T12:00:00.000Z" },
          { id: "node-2", title: "有标题没正文" },
          { id: "node-3", title: "空备注", detail: "   " },
        ],
      },
      { id: "task-2", title: "健身", nodes: [{ id: "node-4", detail: "跑了 5 公里" }] },
    ],
  };
}

describe("diary service", () => {
  let tempDir;
  let database;
  let service;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-diary-service-"));
    database = openAccountDatabase({ dataDir: tempDir });
    service = createDiaryService({
      repository: createDiaryRepository({ connection: database, accountId: "account-a" }),
      accountId: "account-a",
      now: () => NOW,
    });
  });

  afterEach(async () => {
    database?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("creates, reads and lists an entry", () => {
    const created = service.create({ title: "第一篇", content: "开始写日记", timezone: "Asia/Shanghai", tags: ["生活"] });
    expect(created).toMatchObject({ rev: 1, status: "active", source: "manual", occurredDay: "2026-09-24" });

    expect(service.get(created.diaryId)).toMatchObject({ diaryId: created.diaryId, links: [] });
    expect(service.list()).toHaveLength(1);
    expect(service.listTags()).toEqual([{ name: "生活", count: 1 }]);
    expect(service.timeline({ limit: 10 })[0]).toMatchObject({ diaryId: created.diaryId, title: "第一篇" });
  });

  it("merges partial updates and keeps the revision bumping", () => {
    const created = service.create({ title: "标题", content: "正文", tags: ["a"] });
    const updated = service.update(created.diaryId, { title: "新标题" }, { expectedRev: created.rev });

    expect(updated).toMatchObject({ rev: 2, title: "新标题", content: "正文", tags: ["a"] });
  });

  it("refuses to overwrite a newer revision", () => {
    const created = service.create({ content: "第一版" });
    service.update(created.diaryId, { content: "第二版" }, { expectedRev: created.rev });

    expect(() => service.update(created.diaryId, { content: "抢写" }, { expectedRev: created.rev })).toThrow(DiaryRevisionConflictError);
  });

  it("reports invalid input as a 400 and a missing entry as a 404", () => {
    expect(() => service.create({ title: "  ", content: "  " })).toThrowError(expect.objectContaining({ statusCode: 400 }));
    expect(() => service.get("diary-missing")).toThrowError(expect.objectContaining({ statusCode: 404, code: "DIARY_NOT_FOUND" }));
    expect(() => service.update("diary-missing", { title: "x" })).toThrowError(expect.objectContaining({ statusCode: 404 }));
    expect(() => service.remove("diary-missing")).toThrowError(expect.objectContaining({ statusCode: 404 }));
  });

  it("moves an entry to the trash and back, then deletes it for good", () => {
    const created = service.create({ content: "临时记录" });
    expect(service.trash(created.diaryId)).toMatchObject({ status: "trashed" });
    expect(service.list()).toHaveLength(0);
    expect(service.list({ status: "trashed" })).toHaveLength(1);

    expect(service.restore(created.diaryId)).toMatchObject({ status: "active", deletedAt: null });
    expect(service.list()).toHaveLength(1);

    expect(service.remove(created.diaryId)).toEqual({ ok: true, diaryId: created.diaryId });
    expect(service.list({ status: "all" })).toHaveLength(0);
  });

  it("lists entries linked to a canvas node", () => {
    const linked = service.create({ content: "挂在节点上", links: [{ targetType: "node", targetId: "node-1", role: "primary" }] });
    service.create({ content: "没关联" });

    expect(service.listForTarget({ targetType: "node", targetId: "node-1" }).map((entry) => entry.diaryId)).toEqual([linked.diaryId]);
    expect(service.listForTarget({ targetType: "node", targetId: "node-9" })).toHaveLength(0);
  });

  it("previews a node-note import without writing anything", () => {
    const board = nodeBoard();
    const preview = service.previewNodeNoteImport(board);

    // 只有真正有备注文字的节点是候选：node-2 没正文，node-3 是空白。
    expect(preview.map((item) => item.nodeId)).toEqual(["node-1", "node-4"]);
    expect(preview[0]).toMatchObject({ title: "背单词", occurredAt: "2026-09-23T12:00:00.000Z", alreadyImported: false });
    expect(preview[1]).toMatchObject({ title: "健身", nodeId: "node-4" });
    expect(service.list({ status: "all" })).toHaveLength(0);
  });

  it("imports node notes only after confirmation and leaves the board untouched", () => {
    const board = nodeBoard();

    const staged = service.importNodeNotes(board);
    expect(staged).toMatchObject({ confirmed: false, total: 2, created: 0, skipped: 0, pending: 2 });
    expect(service.list()).toHaveLength(0);

    const result = service.importNodeNotes(board, { confirm: true, timezone: "Asia/Shanghai" });
    expect(result).toMatchObject({ confirmed: true, total: 2, created: 2, skipped: 0, pending: 0 });

    const entries = service.list({ status: "all" });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.source === "node-note-import")).toBe(true);
    expect(entries[0].links).toBeUndefined();
    expect(service.get(entries[0].diaryId).links[0]).toMatchObject({ targetType: "node", targetId: "node-4", role: "primary" });

    // 导入是只读画布的：节点原文一个字都不动。
    expect(board).toEqual(nodeBoard());
  });

  it("does not import the same node twice, even after the imported entry is deleted", () => {
    const board = nodeBoard();
    const first = service.importNodeNotes(board, { confirm: true });
    expect(first.created).toBe(2);

    const second = service.importNodeNotes(board, { confirm: true });
    expect(second).toMatchObject({ confirmed: true, created: 0, skipped: 2, pending: 0 });
    expect(service.list({ status: "all" })).toHaveLength(2);

    // 用户把导入的日记删掉之后，节点也不该被重新导入——否则删了会自己长回来。
    const imported = service.list({ status: "all" });
    for (const entry of imported) expect(service.remove(entry.diaryId).ok).toBe(true);
    expect(service.importNodeNotes(board, { confirm: true })).toMatchObject({ created: 0, skipped: 2 });
    expect(service.list({ status: "all" })).toHaveLength(0);
  });

  it("keeps accounts isolated", () => {
    const created = service.create({ content: "只属于 account-a" });
    const other = createDiaryService({
      repository: createDiaryRepository({ connection: database, accountId: "account-b" }),
      accountId: "account-b",
      now: () => NOW,
    });

    expect(other.list()).toHaveLength(0);
    expect(() => other.get(created.diaryId)).toThrowError(expect.objectContaining({ statusCode: 404 }));
    expect(other.importNodeNotes(nodeBoard(), { confirm: true }).created).toBe(2);
    expect(service.list()).toHaveLength(1);
  });
});
