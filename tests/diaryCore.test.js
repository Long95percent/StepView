import { describe, expect, it } from "vitest";
import {
  DIARY_KINDS,
  DIARY_TAG_LIMIT,
  DiaryInputError,
  dayKeyFromInstant,
  normalizeDiaryInput,
  normalizeTags,
  planDiarySearch,
  summarizeDiaryEntry,
} from "../src/diaryCore.js";

const NOW = new Date("2026-09-24T10:00:00.000Z");

describe("diary core", () => {
  it("works out which day an instant belongs to in the writer's timezone", () => {
    expect(dayKeyFromInstant("2026-09-24T16:30:00.000Z", "Asia/Shanghai")).toBe("2026-09-25");
    expect(dayKeyFromInstant("2026-09-24T16:30:00.000Z", "UTC")).toBe("2026-09-24");
    expect(dayKeyFromInstant("2026-09-24T02:00:00.000Z", "America/New_York")).toBe("2026-09-23");
    expect(dayKeyFromInstant(NOW)).toBe("2026-09-24");
    expect(() => dayKeyFromInstant("这不是时间", "UTC")).toThrow(DiaryInputError);
    expect(() => dayKeyFromInstant("2026-09-24T10:00:00.000Z", "Mars/Olympus")).toThrow(/时区/);
  });

  it("validates and normalises an entry", () => {
    const normalized = normalizeDiaryInput(
      {
        title: "  重构落地  ",
        content: "  今天完成了数据库重构  ",
        occurredAt: "2026-09-24T09:00:00.000Z",
        timezone: "Asia/Shanghai",
        tags: ["重构", "重构", "  ", "复盘"],
        links: [{ targetType: "node", targetId: "node-1", role: "primary" }, { targetType: "node", targetId: "node-1" }],
      },
      { now: NOW },
    );

    expect(normalized).toMatchObject({
      title: "重构落地",
      content: "今天完成了数据库重构",
      occurredAt: "2026-09-24T09:00:00.000Z",
      occurredDay: "2026-09-24",
      status: "active",
      source: "manual",
    });
    expect(normalized.tags).toEqual(["重构", "复盘"]);
    expect(normalized.links).toHaveLength(1);
    expect(normalized.links[0]).toMatchObject({ targetType: "node", targetId: "node-1", role: "primary", createdBy: "user" });
  });

  it("refuses empty, oversized and unknown input", () => {
    expect(() => normalizeDiaryInput({}, { now: NOW })).toThrow(/标题或正文/);
    expect(() => normalizeDiaryInput({ content: "   ", title: "  " }, { now: NOW })).toThrow(/标题或正文/);
    expect(() => normalizeDiaryInput({ content: "x".repeat(20001) }, { now: NOW })).toThrow(/正文最多/);
    expect(() => normalizeDiaryInput({ title: "x".repeat(121) }, { now: NOW })).toThrow(/标题最多/);
    expect(() => normalizeDiaryInput({ content: "ok", status: "burned" }, { now: NOW })).toThrow(/status/);
    expect(() => normalizeDiaryInput({ content: "ok", source: "telepathy" }, { now: NOW })).toThrow(/source/);
    expect(() => normalizeDiaryInput({ content: "ok", links: [{ targetType: "moon", targetId: "1" }] }, { now: NOW })).toThrow(/关联目标类型/);
    expect(() => normalizeDiaryInput({ content: "ok", occurredAt: "昨天" }, { now: NOW })).toThrow(/时间格式/);
  });

  it("keeps daily and node diaries apart, and makes node diaries carry a node link", () => {
    // 不给 kind 时默认是每日日记：老调用方不需要改。
    expect(normalizeDiaryInput({ content: "随手记一句" }, { now: NOW }).kind).toBe("daily");
    expect(DIARY_KINDS).toEqual(["daily", "node"]);

    // 每日日记可以关联节点，也可以不关联。
    expect(normalizeDiaryInput({ content: "今天的记录", kind: "daily", links: [{ targetType: "node", targetId: "node-1" }] }, { now: NOW }).kind).toBe("daily");
    expect(normalizeDiaryInput({ content: "今天的记录", kind: "daily" }, { now: NOW }).links).toEqual([]);

    // 节点日记必须挂在节点上。
    expect(
      normalizeDiaryInput({ content: "节点上的记录", kind: "node", links: [{ targetType: "node", targetId: "node-1" }] }, { now: NOW }).kind,
    ).toBe("node");
    expect(() => normalizeDiaryInput({ content: "节点上的记录", kind: "node" }, { now: NOW })).toThrow(/必须关联至少一个节点/);
    // 只关联任务/支线不算：节点日记要的是节点。
    expect(() => normalizeDiaryInput({ content: "节点上的记录", kind: "node", links: [{ targetType: "task", targetId: "task-1" }] }, { now: NOW })).toThrow(/必须关联至少一个节点/);

    expect(() => normalizeDiaryInput({ content: "ok", kind: "weekly" }, { now: NOW })).toThrow(/kind/);
  });

  it("uses the injected clock when no time is given", () => {
    const normalized = normalizeDiaryInput({ content: "随手记一句" }, { now: NOW });
    expect(normalized.occurredAt).toBe(NOW.toISOString());
    expect(normalized.occurredDay).toBe("2026-09-24");
    expect(normalized.timezone).toBe("UTC");
  });

  it("caps and de-duplicates tags", () => {
    const tags = normalizeTags(["  A  ", "a", ...Array.from({ length: 40 }, (_, index) => `tag-${index}`)]);
    expect(tags[0]).toBe("A");
    expect(tags).toHaveLength(DIARY_TAG_LIMIT);
    expect(normalizeTags("not an array")).toEqual([]);
  });

  it("plans a search: index for long terms, LIKE for short ones", () => {
    expect(planDiarySearch("")).toEqual({ mode: "empty", terms: [] });
    expect(planDiarySearch("数据库")).toMatchObject({ mode: "match", expression: '"数据库"' });
    expect(planDiarySearch('数据库 "重构"')).toMatchObject({ mode: "match", expression: '"数据库" AND """重构"""' });
    expect(planDiarySearch("考研")).toMatchObject({ mode: "like", patterns: ["%考研%"] });
    expect(planDiarySearch("数据库 重构")).toMatchObject({ mode: "like", patterns: ["%数据库%", "%重构%"] });
    // 三个字以上走索引，通配符在索引里就是普通字符。
    expect(planDiarySearch("50%_a")).toMatchObject({ mode: "match", expression: '"50%_a"' });
    // 短词走 LIKE 时通配符必须转义，否则用户搜 "_" 会命中所有内容。
    expect(planDiarySearch("a%")).toMatchObject({ mode: "like", patterns: ["%a\\%%"] });
  });

  it("summarises an entry for lists and agent context", () => {
    expect(summarizeDiaryEntry({ content: "  第一行\n第二行  " })).toBe("第一行 第二行");
    expect(summarizeDiaryEntry({ title: "只有标题" })).toBe("只有标题");
    expect(summarizeDiaryEntry({ content: "x".repeat(200) }, { length: 10 })).toBe(`${"x".repeat(10)}…`);
    expect(summarizeDiaryEntry({})).toBe("");
  });
});
