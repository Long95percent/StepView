import { describe, expect, it } from "vitest";
import {
  collectNodeOptions,
  formatDayChip,
  formatDayHeading,
  formatEntryTime,
  groupEntriesByDay,
  isDayKey,
  nodeLabelById,
  placePopover,
  sortEntriesNewestFirst,
} from "../src/diary/diaryViewCore.js";

function entry(id, day, at) {
  return { diaryId: id, occurredDay: day, occurredAt: at, title: id, content: `${id} 的正文` };
}

describe("diary view core", () => {
  it("recognises a day key", () => {
    expect(isDayKey("2026-09-24")).toBe(true);
    expect(isDayKey("2026-9-24")).toBe(false);
    expect(isDayKey("今天")).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });

  it("orders entries newest first, with a stable tie-break", () => {
    const entries = [entry("b", "2026-09-24", "2026-09-24T02:00:00.000Z"), entry("a", "2026-09-24", "2026-09-24T09:00:00.000Z")];
    expect(sortEntriesNewestFirst(entries).map((item) => item.diaryId)).toEqual(["a", "b"]);

    // 同一时刻的两条：靠 id 兜底，顺序必须稳定，否则每次刷新都像被调换了。
    const sameMoment = [entry("x", "2026-09-24", "2026-09-24T09:00:00.000Z"), entry("y", "2026-09-24", "2026-09-24T09:00:00.000Z")];
    expect(sortEntriesNewestFirst(sameMoment).map((item) => item.diaryId)).toEqual(["y", "x"]);
    expect(sortEntriesNewestFirst(sameMoment).map((item) => item.diaryId)).toEqual(
      sortEntriesNewestFirst([...sameMoment].reverse()).map((item) => item.diaryId),
    );

    // 不改动入参
    const original = [entry("b", "2026-09-24", "2026-09-24T02:00:00.000Z"), entry("a", "2026-09-24", "2026-09-24T09:00:00.000Z")];
    sortEntriesNewestFirst(original);
    expect(original.map((item) => item.diaryId)).toEqual(["b", "a"]);
  });

  it("groups by day, newest day first, and never merges several entries on the same day", () => {
    const groups = groupEntriesByDay([
      entry("old", "2026-09-19", "2026-09-19T02:00:00.000Z"),
      entry("mid", "2026-09-24", "2026-09-24T02:00:00.000Z"),
      entry("late", "2026-09-24", "2026-09-24T09:00:00.000Z"),
    ]);

    expect(groups.map((group) => group.day)).toEqual(["2026-09-24", "2026-09-19"]);
    // 同一天两条并列，不合并
    expect(groups[0]).toMatchObject({ day: "2026-09-24", count: 2 });
    expect(groups[0].entries.map((item) => item.diaryId)).toEqual(["late", "mid"]);
    expect(groups[1]).toMatchObject({ day: "2026-09-19", count: 1 });
  });

  it("keeps entries that have no usable day instead of dropping them", () => {
    const groups = groupEntriesByDay([entry("ok", "2026-09-24", "2026-09-24T02:00:00.000Z"), { diaryId: "broken", occurredDay: null }]);
    expect(groups.map((group) => group.day)).toEqual(["2026-09-24", "未知日期"]);
    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(2);
  });

  it("labels today and yesterday in the writer's timezone", () => {
    // 北京时间已经是 9 月 25 日，UTC 还是 9 月 24 日。
    const now = new Date("2026-09-24T16:30:00.000Z");
    expect(formatDayHeading("2026-09-25", { now, timezone: "Asia/Shanghai" })).toBe("今天");
    expect(formatDayHeading("2026-09-24", { now, timezone: "Asia/Shanghai" })).toBe("昨天");
    expect(formatDayHeading("2026-09-24", { now, timezone: "UTC" })).toBe("今天");
    expect(formatDayHeading("2026-09-19", { now, timezone: "Asia/Shanghai" })).toBe("2026年9月19日 星期六");
    // 非法日期键原样返回，不炸
    expect(formatDayHeading("未知日期", { now })).toBe("未知日期");
  });

  it("subtracts a day by the calendar, not by 24 hours", () => {
    // 3 月 1 日的前一天是 2 月 28 日（2026 不是闰年）
    expect(formatDayHeading("2026-02-28", { now: new Date("2026-03-01T12:00:00.000Z"), timezone: "UTC" })).toBe("昨天");
    // 跨月、跨年
    expect(formatDayHeading("2026-12-31", { now: new Date("2027-01-01T12:00:00.000Z"), timezone: "UTC" })).toBe("昨天");
  });

  it("formats the time shown on each row", () => {
    expect(formatEntryTime("2026-09-24T09:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatEntryTime("不是时间")).toBe("");
  });

  it("places the day popover next to the chip without letting it leave the window", () => {
    const viewport = { width: 1440, height: 900 };

    // 常态：居中在按钮下方，宽度固定。
    const below = placePopover({ left: 700, width: 40, top: 300, bottom: 320 }, viewport);
    expect(below).toMatchObject({ left: 700 + 20 - 192, top: 330, width: 384 });
    expect(below.maxHeight).toBe(900 - 320 - 10 - 12);
    expect(below.bottom).toBeUndefined();

    // 贴着右边缘：整体左移，不能有一截跑到窗口外。
    const rightEdge = placePopover({ left: 1420, width: 40, top: 300, bottom: 320 }, viewport);
    expect(rightEdge.left).toBe(1440 - 384 - 12);
    const leftEdge = placePopover({ left: -20, width: 40, top: 300, bottom: 320 }, viewport);
    expect(leftEdge.left).toBe(12);

    // 按钮在窗口底部：翻到上方，并且用 transform 抬上去。
    const above = placePopover({ left: 700, width: 40, top: 820, bottom: 840 }, viewport);
    // 翻到上方用 bottom 定位，不用 transform：弹层里嵌着 fixed 的编辑器弹窗，
    // transform / backdrop-filter 会给固定定位后代创建包含块，把编辑器困在弹层里。
    expect(above).toMatchObject({ bottom: 900 - 820 + 10 });
    expect(above.top).toBeUndefined();
    expect(above.maxHeight).toBe(820 - 10 - 12);

    // 窗口很矮、上下都放不下时，也要留出可滚动的高度，不能算出 0 或负数。
    const cramped = placePopover({ left: 700, width: 40, top: 100, bottom: 120 }, { width: 1440, height: 200 });
    expect(cramped.maxHeight).toBeGreaterThanOrEqual(180);
  });

  it("labels the day chips short enough to sit in a row", () => {
    const now = new Date("2026-09-24T16:30:00.000Z");
    // 今天/昨天跟着时区走，和组头同一口径：北京时间已经过了零点。
    expect(formatDayChip("2026-09-25", { now, timezone: "Asia/Shanghai" })).toBe("今天");
    expect(formatDayChip("2026-09-24", { now, timezone: "Asia/Shanghai" })).toBe("昨天");
    expect(formatDayChip("2026-09-24", { now, timezone: "UTC" })).toBe("今天");
    // 同一年省掉年份，不是同一年才写全 —— 芯片宽度不能忽长忽短。
    expect(formatDayChip("2026-09-19", { now, timezone: "UTC" })).toBe("9月19日");
    expect(formatDayChip("2025-12-31", { now, timezone: "UTC" })).toBe("2025年12月31日");
    // 非法日期键原样返回，不炸
    expect(formatDayChip(undefined, { now })).toBe("");
  });

  it("collects linkable nodes from the board and skips the ones with no id", () => {
    const board = {
      tasks: [
        { id: "task-1", title: "求职", nodes: [{ id: "node-1", title: "投简历" }, { title: "没有 id" }, { id: "node-2" }] },
        { id: "task-2", nodes: [{ id: "node-3", title: "面试" }] },
      ],
    };
    const options = collectNodeOptions(board);
    expect(options).toEqual([
      { id: "node-1", label: "求职 · 投简历" },
      { id: "node-2", label: "求职" },
      { id: "node-3", label: "面试" },
    ]);
    expect(nodeLabelById(options).get("node-1")).toBe("求职 · 投简历");
    expect(collectNodeOptions(undefined)).toEqual([]);
  });
});
