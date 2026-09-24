import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAccountDatabase } from "../electron/db/index.js";
import {
  DiaryNodeLinkRequiredError,
  DiaryRevisionConflictError,
  createDiaryRepository,
} from "../electron/db/repositories/diaryRepository.js";
import { normalizeDiaryInput } from "../src/diaryCore.js";

const NOW = new Date("2026-09-24T10:00:00.000Z");

function entry(input) {
  return normalizeDiaryInput(input, { now: NOW });
}

describe("diary repository", () => {
  let tempDir;
  let database;
  let diary;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-diary-"));
    database = openAccountDatabase({ dataDir: tempDir });
    diary = createDiaryRepository({ connection: database, accountId: "account-a" });
  });

  afterEach(async () => {
    database?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("stores an entry with its tags, links, revision and search row", () => {
    const created = diary.create(
      entry({
        title: "重构落地",
        content: "今天完成了数据库重构，心情不错",
        occurredAt: "2026-09-24T09:00:00.000Z",
        timezone: "Asia/Shanghai",
        tags: ["重构", "重构", " 复盘 "],
        links: [
          { targetType: "node", targetId: "node-1", role: "primary", taskId: "task-1" },
          { targetType: "node", targetId: "node-1" },
        ],
      }),
    );

    expect(created).toMatchObject({ rev: 1, occurredDay: "2026-09-24", timezone: "Asia/Shanghai", status: "active", source: "manual" });
    // 标签去重后按名字排序；同一个目标重复出现只留一条关联。
    expect(created.tags).toEqual(["复盘", "重构"]);
    expect(diary.listLinks(created.diaryId)).toHaveLength(1);
    expect(diary.listLinks(created.diaryId)[0]).toMatchObject({ targetType: "node", targetId: "node-1", role: "primary", taskId: "task-1" });
    expect(diary.listRevisions(created.diaryId)).toHaveLength(1);
    expect(diary.search({ query: "数据库重" })).toHaveLength(1);
  });

  it("bumps the revision on every update and refuses a stale one", () => {
    const created = diary.create(entry({ content: "第一版内容" }));

    const updated = diary.update(created.diaryId, entry({ content: "第二版内容", title: "改过的标题" }), { expectedRev: created.rev });
    expect(updated).toMatchObject({ rev: 2, title: "改过的标题", content: "第二版内容" });

    expect(() => diary.update(created.diaryId, entry({ content: "第三版内容" }), { expectedRev: 1 })).toThrow(DiaryRevisionConflictError);
    expect(diary.get(created.diaryId)).toMatchObject({ rev: 2, content: "第二版内容" });
    expect(diary.listRevisions(created.diaryId).map((revision) => revision.rev)).toEqual([2, 1]);
  });

  it("searches three-character queries through the index and short ones through LIKE", () => {
    diary.create(entry({ title: "焦虑的一天", content: "今天为汇报焦虑了很久" }));
    diary.create(entry({ title: "平静的一天", content: "读完了数据库实现原理" }));

    // 三字及以上：走 FTS5 的 trigram 分词器
    expect(diary.search({ query: "数据库" }).map((item) => item.title)).toEqual(["平静的一天"]);
    // 两个字：trigram 搜不到，回退 LIKE
    expect(diary.search({ query: "焦虑" }).map((item) => item.title)).toEqual(["焦虑的一天"]);
    // 两个词里有一个不足三个字：整条查询回退 LIKE，并且要求两个词都出现
    expect(diary.search({ query: "数据库 原理" }).map((item) => item.title)).toEqual(["平静的一天"]);
    expect(diary.search({ query: "数据库 焦虑" })).toEqual([]);
  });

  it("keeps the index in sync when content changes", () => {
    const created = diary.create(entry({ content: "今天完成了数据库重构" }));

    diary.update(created.diaryId, entry({ content: "今天换成了写界面" }), { expectedRev: created.rev });

    expect(diary.search({ query: "数据库" })).toEqual([]);
    expect(diary.search({ query: "写界面" }).map((item) => item.diaryId)).toEqual([created.diaryId]);
  });

  it("filters by day, tag and linked canvas target", () => {
    const older = diary.create(entry({ content: "上周的事情", occurredAt: "2026-09-10T02:00:00.000Z", tags: ["周记"], links: [{ targetType: "node", targetId: "node-1" }] }));
    const recent = diary.create(entry({ content: "今天的记录", occurredAt: "2026-09-24T02:00:00.000Z", tags: ["日更"] }));

    expect(diary.list({}).map((item) => item.diaryId)).toEqual([recent.diaryId, older.diaryId]);
    expect(diary.list({ from: "2026-09-20" }).map((item) => item.diaryId)).toEqual([recent.diaryId]);
    expect(diary.list({ tag: "周记" }).map((item) => item.diaryId)).toEqual([older.diaryId]);
    expect(diary.list({ targetType: "node", targetId: "node-1" }).map((item) => item.diaryId)).toEqual([older.diaryId]);
    expect(diary.listTags()).toEqual([{ name: "周记", count: 1 }, { name: "日更", count: 1 }]);
    expect(diary.count()).toBe(2);
  });

  it("moves entries to the trash, restores them, and deletes them for good", () => {
    const created = diary.create(entry({ content: "先写点什么" }));

    const trashed = diary.setStatus(created.diaryId, "trashed");
    expect(trashed).toMatchObject({ status: "trashed" });
    expect(trashed.deletedAt).toBeTruthy();
    expect(diary.list({})).toEqual([]);
    expect(diary.list({ status: "all" }).map((item) => item.diaryId)).toEqual([created.diaryId]);
    expect(diary.search({ query: "先写点" })).toEqual([]);

    const restored = diary.setStatus(created.diaryId, "active");
    expect(restored).toMatchObject({ status: "active", deletedAt: null });
    expect(diary.search({ query: "先写点" })).toHaveLength(1);

    expect(diary.remove(created.diaryId)).toBe(true);
    expect(diary.remove(created.diaryId)).toBe(false);
    expect(diary.get(created.diaryId)).toBe(null);
    expect(diary.search({ query: "先写点" })).toEqual([]);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM diary_links WHERE diary_id = ?").get(created.diaryId).count).toBe(0);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM diary_entry_tags WHERE diary_id = ?").get(created.diaryId).count).toBe(0);
  });

  it("replaces links on update instead of colliding with the unique key", () => {
    const created = diary.create(entry({ content: "第一版", links: [{ targetType: "node", targetId: "node-1" }] }));

    // 同一条关联再写一次不该报 UNIQUE 冲突；换成别的目标时旧的必须消失。
    const updated = diary.update(created.diaryId, entry({ content: "第二版", links: [{ targetType: "node", targetId: "node-1" }] }), { expectedRev: created.rev });
    expect(diary.listLinks(updated.diaryId)).toHaveLength(1);

    diary.update(created.diaryId, entry({ content: "第三版", links: [{ targetType: "task", targetId: "task-1" }] }), { expectedRev: updated.rev });
    expect(diary.listLinks(created.diaryId).map((link) => link.targetId)).toEqual(["task-1"]);
  });

  it("keeps an orphaned link orphaned when the entry is edited", () => {
    const created = diary.create(entry({ content: "第一版", links: [{ targetType: "node", targetId: "node-9", role: "primary" }] }));
    diary.markLinksOrphaned({ targetType: "node", targetId: "node-9", now: NOW });

    // 用户只是改了个字，把关联原样又交回来一次：orphaned_at 不能被抹掉。
    diary.update(created.diaryId, entry({ content: "第二版", links: diary.listLinks(created.diaryId) }), { expectedRev: created.rev });
    expect(diary.listLinks(created.diaryId)).toHaveLength(1);
    expect(diary.listLinks(created.diaryId)[0].orphanedAt).toBe(NOW.toISOString());

    // 换成另一个目标时，旧的那条才真的消失。
    diary.update(created.diaryId, entry({ content: "第三版", links: [{ targetType: "node", targetId: "node-10" }] }), { expectedRev: 2 });
    expect(diary.listLinks(created.diaryId).map((link) => link.targetId)).toEqual(["node-10"]);
  });

  it("applies the same day and target filters to search as to list", () => {
    const linked = diary.create(entry({ content: "数据库重构的记录", occurredAt: "2026-09-10T02:00:00.000Z", links: [{ targetType: "node", targetId: "node-1" }] }));
    diary.create(entry({ content: "数据库重构的复述", occurredAt: "2026-09-24T02:00:00.000Z" }));

    expect(diary.search({ query: "数据库重构" })).toHaveLength(2);
    expect(diary.search({ query: "数据库重构", from: "2026-09-20" }).map((item) => item.diaryId)).toEqual([diary.list({ from: "2026-09-20" })[0].diaryId]);
    expect(diary.search({ query: "数据库重构", to: "2026-09-20" }).map((item) => item.diaryId)).toEqual([linked.diaryId]);
    expect(diary.search({ query: "数据库重构", targetType: "node", targetId: "node-1" }).map((item) => item.diaryId)).toEqual([linked.diaryId]);
  });

  it("reports a revision conflict as a 409-flavoured error", () => {
    const created = diary.create(entry({ content: "第一版" }));
    diary.update(created.diaryId, entry({ content: "第二版" }), { expectedRev: created.rev });

    try {
      diary.update(created.diaryId, entry({ content: "抢写" }), { expectedRev: 1 });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DiaryRevisionConflictError);
      expect(error.statusCode).toBe(409);
      expect(error.actualRev).toBe(2);
    }
  });

  it("marks canvas links as orphaned instead of deleting the diary", () => {
    const created = diary.create(entry({ content: "关联了一个节点", links: [{ targetType: "node", targetId: "node-9" }] }));

    expect(diary.markLinksOrphaned({ targetType: "node", targetId: "node-9", now: NOW })).toBe(1);
    expect(diary.markLinksOrphaned({ targetType: "node", targetId: "node-9", now: NOW })).toBe(0);

    const [link] = diary.listLinks(created.diaryId);
    expect(link.orphanedAt).toBe(NOW.toISOString());
    expect(diary.get(created.diaryId)).not.toBe(null);
  });

  it("keeps accounts apart and exposes a compact timeline", () => {
    diary.create(entry({ title: "我的记录", content: "只属于 account-a 的内容" }));
    const other = createDiaryRepository({ connection: database, accountId: "account-b" });

    expect(other.list()).toEqual([]);
    expect(other.search({ query: "account-a" })).toEqual([]);
    expect(other.get(diary.list()[0].diaryId)).toBe(null);

    const [item] = diary.timeline();
    expect(item).toMatchObject({ occurredDay: "2026-09-24", title: "我的记录", tags: [] });
    expect(item.summary.length).toBeGreaterThan(0);
  });

  it("refuses a node diary with no node link and rolls the whole write back", () => {
    // 故意绕过 diaryCore 的校验直接构造：界面/纯函数是第一道防线，仓储必须自己再拦一次，
    // 否则任何绕过 normalizeDiaryInput 的调用方都能塞进一条没有归属的节点日记。
    const orphan = { ...entry({ content: "一条没有归属的节点日记" }), kind: "node" };

    expect(() => diary.create(orphan)).toThrow(DiaryNodeLinkRequiredError);
    // 整笔回滚：条目、全文索引、变更日志一个字都不该留下。
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM diary_entries").get().count).toBe(0);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM diary_fts").get().count).toBe(0);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM diary_revisions").get().count).toBe(0);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM diary_links").get().count).toBe(0);
  });

  it("refuses to unlink the last node from a node diary", () => {
    const created = diary.create(
      entry({
        content: "挂在节点上的记录",
        kind: "node",
        links: [
          { targetType: "node", targetId: "node-1", role: "primary" },
          { targetType: "task", targetId: "task-1" },
        ],
      }),
    );
    expect(created.kind).toBe("node");

    // 改成只关联任务：节点关联被摘掉，这条节点日记就没有归属了，必须拒绝并整笔回滚。
    // diaryCore 会在界面那一层先拦一次，所以这里绕过它，单独验证仓储这道防线——
    // 少了任何一层，调用方都能把一条节点日记改成没有归属的孤儿。
    const taskOnly = {
      ...entry({ content: "改成只关联任务", links: [{ targetType: "task", targetId: "task-1" }] }),
      kind: "node",
    };
    expect(() => diary.update(created.diaryId, taskOnly, { expectedRev: created.rev })).toThrow(DiaryNodeLinkRequiredError);

    expect(diary.get(created.diaryId)).toMatchObject({ rev: 1, content: "挂在节点上的记录", kind: "node" });
    expect(diary.listLinks(created.diaryId).map((link) => link.targetType).sort()).toEqual(["node", "task"]);

    // 保留节点关联的前提下把别的关联换掉，是允许的。
    const updated = diary.update(
      created.diaryId,
      entry({
        content: "换个任务关联",
        kind: "node",
        links: [
          { targetType: "node", targetId: "node-1", role: "primary" },
          { targetType: "task", targetId: "task-2" },
        ],
      }),
      { expectedRev: created.rev },
    );
    expect(updated.rev).toBe(2);
    expect(diary.listLinks(created.diaryId).map((link) => link.targetId).sort()).toEqual(["node-1", "task-2"]);
  });

  it("filters list, search and timeline by kind", () => {
    const daily = diary.create(entry({ title: "每日记录", content: "今天在写界面", occurredAt: "2026-09-24T02:00:00.000Z" }));
    const nodeDiary = diary.create(
      entry({
        title: "节点记录",
        content: "这个节点上的实现细节",
        occurredAt: "2026-09-24T01:00:00.000Z",
        kind: "node",
        links: [{ targetType: "node", targetId: "node-1", role: "primary" }],
      }),
    );

    // 默认是每日日记，老调用方不需要改。
    expect(daily.kind).toBe("daily");
    expect(nodeDiary.kind).toBe("node");

    expect(diary.list({ kind: "daily" }).map((item) => item.diaryId)).toEqual([daily.diaryId]);
    expect(diary.list({ kind: "node" }).map((item) => item.diaryId)).toEqual([nodeDiary.diaryId]);
    expect(diary.list({}).map((item) => item.diaryId)).toEqual([daily.diaryId, nodeDiary.diaryId]);

    expect(diary.search({ query: "写界面", kind: "daily" }).map((item) => item.diaryId)).toEqual([daily.diaryId]);
    expect(diary.search({ query: "实现细节", kind: "node" }).map((item) => item.diaryId)).toEqual([nodeDiary.diaryId]);
    expect(diary.search({ query: "实现细节", kind: "daily" })).toEqual([]);

    expect(diary.timeline({ kind: "node" }).map((item) => item.diaryId)).toEqual([nodeDiary.diaryId]);
    expect(diary.timeline().map((item) => item.diaryId)).toEqual([daily.diaryId, nodeDiary.diaryId]);
  });

  it("never leaves a node diary without a node link, across the whole database", () => {
    // 全库不变量：任何写入路径都不该产出一条没有归属的节点日记。
    // 单点测试只能覆盖走过的路径，这条扫描是用来兜住"将来新增的写入路径忘了校验"的。
    diary.create(entry({ content: "普通的一天" }));
    diary.create(entry({ content: "挂在节点上", kind: "node", links: [{ targetType: "node", targetId: "node-1" }] }));
    const nodeDiary = diary.create(
      entry({ content: "两个节点上", kind: "node", links: [{ targetType: "node", targetId: "node-2" }, { targetType: "node", targetId: "node-3" }] }),
    );
    // 顺带把"归档 / 回收站 / 编辑"这几条路径也走一遍。
    diary.update(nodeDiary.diaryId, entry({ content: "改了内容", kind: "node", links: diary.listLinks(nodeDiary.diaryId).map(({ targetType, targetId, role }) => ({ targetType, targetId, role })) }), {
      expectedRev: nodeDiary.rev,
    });
    diary.setStatus(nodeDiary.diaryId, "trashed");
    diary.setStatus(nodeDiary.diaryId, "active");

    const strays = database.db
      .prepare(
        `SELECT e.id AS id FROM diary_entries e
         WHERE e.kind = 'node'
           AND NOT EXISTS (
             SELECT 1 FROM diary_links l
             WHERE l.diary_id = e.id AND l.target_type = 'node'
           )`,
      )
      .all();

    expect(strays).toEqual([]);
    // 确认扫描本身是有效的：真的塞一条孤儿进去，它必须被抓出来。
    database.db
      .prepare("INSERT INTO diary_entries (id, account_id, rev, kind, occurred_at, occurred_day, timezone, title, content, status, source, created_at, updated_at) VALUES (?, ?, 1, 'node', ?, ?, 'UTC', '', '孤儿', 'active', 'manual', ?, ?)")
      .run("diary-stray", "account-a", NOW.toISOString(), "2026-09-24", NOW.toISOString(), NOW.toISOString());
    expect(
      database.db
        .prepare("SELECT id FROM diary_entries e WHERE e.kind = 'node' AND NOT EXISTS (SELECT 1 FROM diary_links l WHERE l.diary_id = e.id AND l.target_type = 'node')")
        .all()
        .map((row) => row.id),
    ).toEqual(["diary-stray"]);
  });
});
