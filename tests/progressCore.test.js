import { describe, expect, it } from "vitest";
import {
  addMilestoneAfter,
  buildTask,
  completeTask,
  createEmojiSticker,
  deleteTask,
  formatCompactDate,
  moveCanvasItem,
  normalizeBoard,
  restoreTask,
} from "../src/progressCore";

describe("progress board core", () => {
  it("creates a task with start and finish points around the goal", () => {
    const task = buildTask("发布 StepView 首版", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));

    expect(task.title).toBe("发布 StepView 首版");
    expect(task.status).toBe("active");
    expect(task.nodes).toHaveLength(2);
    expect(task.nodes[0]).toMatchObject({ kind: "start", emoji: "🚀", x: 520, y: 420 });
    expect(task.nodes[1]).toMatchObject({ kind: "finish", emoji: "🏁", x: 800, y: 420 });
  });

  it("adds a milestone to the right of an existing point with note metadata", () => {
    const task = buildTask("完成里程碑", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const updated = addMilestoneAfter(task, task.nodes[0].id, {
      title: "完成调研",
      detail: "明确技术栈和交互",
      timestamp: "2026-05-19T12:00:00.000Z",
    });

    expect(updated.nodes).toHaveLength(3);
    expect(updated.nodes[1]).toMatchObject({ kind: "milestone", title: "完成调研", detail: "明确技术栈和交互" });
    expect(updated.nodes[1].x).toBeGreaterThan(task.nodes[0].x);
    expect(updated.edges.some((edge) => edge.from === task.nodes[0].id && edge.to === updated.nodes[1].id)).toBe(true);
  });

  it("moves nodes and emoji stickers without mutating the original board", () => {
    const task = buildTask("可拖拽", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const sticker = createEmojiSticker("✨", { x: 100, y: 100 });
    const board = { tasks: [task], stickers: [sticker] };

    const movedNode = moveCanvasItem(board, task.nodes[0].id, { x: 42, y: 84 });
    const movedSticker = moveCanvasItem(board, sticker.id, { x: 200, y: 220 });

    expect(movedNode.tasks[0].nodes[0]).toMatchObject({ x: 42, y: 84 });
    expect(movedSticker.stickers[0]).toMatchObject({ x: 200, y: 220 });
    expect(board.tasks[0].nodes[0].x).not.toBe(42);
  });

  it("marks connected tasks complete and can restore them", () => {
    const task = buildTask("打通路径", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const board = { tasks: [task], stickers: [] };
    const completed = completeTask(board, task.id, new Date("2026-05-20T08:00:00Z"));
    const restored = restoreTask(completed, task.id);

    expect(completed.tasks[0].status).toBe("completed");
    expect(completed.tasks[0].completedAt).toBe("2026-05-20T08:00:00.000Z");
    expect(restored.tasks[0].status).toBe("active");
    expect(restored.tasks[0].completedAt).toBeUndefined();
  });

  it("deletes a task and normalizes stored board data", () => {
    const task = buildTask("删除目标", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [task], stickers: null });
    const deleted = deleteTask(board, task.id);

    expect(board.stickers).toEqual([]);
    expect(deleted.tasks).toEqual([]);
  });

  it("formats compact labels as year and date", () => {
    expect(formatCompactDate("2026-05-18T09:30:00.000Z")).toBe("2026/05/18");
  });
});