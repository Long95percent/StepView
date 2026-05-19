import { describe, expect, it } from "vitest";
import {
  addCrossTaskLink,
  ACHIEVEMENTS,
  addMilestoneAfter,
  addPlanMilestoneAfter,
  buildTask,
  chooseStoredBoard,
  completeTask,
  createConfettiBurst,
  createEmojiSticker,
  deleteCrossTaskLink,
  deleteTask,
  findNodeInBoard,
  formatCompactDate,
  getCompletedTaskSummary,
  getCrossTaskLinkSegments,
  getAchievementCollection,
  getNewlyUnlockedAchievements,
  getTaskProcessEntries,
  getUnifiedEdges,
  hasBoardContent,
  moveCanvasItem,
  nodeHasOutgoingNext,
  normalizeBoard,
  restoreTask,
  togglePlanMilestoneComplete,
  wouldCreateCycle,
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

  it("adds an incomplete plan milestone that can be marked complete", () => {
    const task = buildTask("规划路径", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const planned = addPlanMilestoneAfter(task, task.nodes[0].id, {
      title: "先做登录",
      detail: "计划中的阶段",
      timestamp: "2026-05-19T12:00:00.000Z",
    });
    const planNode = planned.nodes[1];
    const completed = togglePlanMilestoneComplete(planned, planNode.id, new Date("2026-05-20T08:00:00Z"));

    expect(planNode).toMatchObject({ kind: "plan-milestone", status: "planned", title: "先做登录" });
    expect(completed.nodes[1]).toMatchObject({ status: "completed", completedAt: "2026-05-20T08:00:00.000Z" });
    expect(task.nodes).toHaveLength(2);
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

  it("creates a compact confetti burst around a completion point", () => {
    const burst = createConfettiBurst({ x: 120, y: 240 }, 6);

    expect(burst).toHaveLength(6);
    expect(burst[0]).toMatchObject({ x: 120, y: 240 });
    expect(burst.every((piece) => piece.id.startsWith("confetti-") && piece.color && piece.rotation !== undefined)).toBe(true);
  });

  it("adds and deletes an isolated cross-task link", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] });
    const linked = addCrossTaskLink(board, aiTask.nodes[1].id, kbTask.nodes[0].id, new Date("2026-05-19T12:00:00Z"));
    const deleted = deleteCrossTaskLink(linked, linked.links[0].id);

    expect(linked.links).toHaveLength(1);
    expect(linked.links[0]).toMatchObject({
      fromTaskId: aiTask.id,
      fromNodeId: aiTask.nodes[1].id,
      toTaskId: kbTask.id,
      toNodeId: kbTask.nodes[0].id,
      kind: "cross-task",
      createdAt: "2026-05-19T12:00:00.000Z",
    });
    expect(deleted.links).toEqual([]);
    expect(board.links).toEqual([]);
  });

  it("unlocks the first cross-task link achievement only once", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] });
    const linked = addCrossTaskLink(board, aiTask.nodes[1].id, kbTask.nodes[0].id);
    const alreadyUnlocked = normalizeBoard({ ...linked, achievements: [ACHIEVEMENTS.firstCrossTaskLink.id] });

    expect(getNewlyUnlockedAchievements(board, linked).map((achievement) => achievement.id)).toEqual([ACHIEVEMENTS.firstCrossTaskLink.id]);
    expect(getNewlyUnlockedAchievements(linked, alreadyUnlocked)).toEqual([]);
  });

  it("builds an achievement collection with unlocked status", () => {
    const board = normalizeBoard({ achievements: [ACHIEVEMENTS.firstCrossTaskLink.id] });

    expect(getAchievementCollection(board)).toEqual([
      expect.objectContaining({
        id: ACHIEVEMENTS.firstCrossTaskLink.id,
        title: ACHIEVEMENTS.firstCrossTaskLink.title,
        unlocked: true,
      }),
    ]);
  });

  it("rejects same-task links", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] });

    expect(() => addCrossTaskLink(board, aiTask.nodes[1].id, aiTask.nodes[0].id)).toThrow("Cross-task links only for now.");
  });

  it("allows one node to have multiple cross-task next links", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const writingTask = buildTask("写文章", { x: 1600, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [aiTask, kbTask, writingTask], stickers: [] });
    const first = addCrossTaskLink(board, aiTask.nodes[0].id, kbTask.nodes[0].id);
    const second = addCrossTaskLink(first, aiTask.nodes[0].id, writingTask.nodes[0].id);

    expect(second.links).toHaveLength(2);
    expect(second.links.map((link) => link.fromNodeId)).toEqual([aiTask.nodes[0].id, aiTask.nodes[0].id]);
  });

  it("allows multiple incoming links to one target and rejects cycles", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const writingTask = buildTask("写文章", { x: 1600, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [aiTask, kbTask, writingTask], stickers: [] });
    const first = addCrossTaskLink(board, aiTask.nodes[1].id, kbTask.nodes[0].id);
    const second = addCrossTaskLink(first, writingTask.nodes[1].id, kbTask.nodes[0].id);

    expect(second.links).toHaveLength(2);
    expect(wouldCreateCycle(second, kbTask.nodes[1].id, aiTask.nodes[0].id)).toBe(true);
    expect(() => addCrossTaskLink(second, kbTask.nodes[1].id, aiTask.nodes[0].id)).toThrow("This link would create a loop.");
  });

  it("finds nodes and combines internal edges with cross-task links", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = addCrossTaskLink(normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] }), aiTask.nodes[1].id, kbTask.nodes[0].id);

    expect(findNodeInBoard(board, kbTask.nodes[0].id)).toMatchObject({ taskId: kbTask.id, taskTitle: "知识库" });
    expect(getUnifiedEdges(board)).toHaveLength(3);
    expect(nodeHasOutgoingNext(board, aiTask.nodes[0].id)).toBe(true);
    expect(nodeHasOutgoingNext(board, aiTask.nodes[1].id)).toBe(true);
  });

  it("builds renderable cross-task link segments with endpoint coordinates", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 620 }, new Date("2026-05-18T09:30:00Z"));
    const board = addCrossTaskLink(normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] }), aiTask.nodes[1].id, kbTask.nodes[0].id);

    expect(getCrossTaskLinkSegments(board)).toEqual([
      {
        id: board.links[0].id,
        fromTaskId: aiTask.id,
        toTaskId: kbTask.id,
        x1: aiTask.nodes[1].x,
        y1: aiTask.nodes[1].y,
        x2: kbTask.nodes[0].x,
        y2: kbTask.nodes[0].y,
      },
    ]);
  });

  it("summarizes completed tasks for readable process cards", () => {
    const task = buildTask("上线用户可见卡片", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const withMilestone = addMilestoneAfter(task, task.nodes[0].id, {
      title: "整理完整过程",
      detail: "把开始、里程碑和终点串成用户能读懂的时间线",
      timestamp: "2026-05-19T12:00:00.000Z",
    });
    const completed = completeTask({ tasks: [withMilestone], stickers: [] }, task.id, new Date("2026-05-20T08:00:00Z"));

    expect(getCompletedTaskSummary(completed.tasks[0])).toEqual({
      totalSteps: 3,
      milestoneCount: 1,
      startedAt: "2026-05-18T09:30:00.000Z",
      completedAt: "2026-05-20T08:00:00.000Z",
    });
  });

  it("orders task process entries by the connected path", () => {
    const task = buildTask("展示完整路径", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const withFirst = addMilestoneAfter(task, task.nodes[0].id, {
      title: "第一步",
      detail: "先完成基础能力",
      timestamp: "2026-05-19T12:00:00.000Z",
    });
    const withSecond = addMilestoneAfter(withFirst, withFirst.nodes[1].id, {
      title: "第二步",
      detail: "再优化视觉呈现",
      timestamp: "2026-05-20T12:00:00.000Z",
    });

    expect(getTaskProcessEntries(withSecond).map((entry) => entry.title)).toEqual(["Start", "第一步", "第二步", "展示完整路径"]);
    expect(getTaskProcessEntries(withSecond).map((entry) => entry.label)).toEqual(["Start", "Milestone", "Milestone", "Finish"]);
  });

  it("keeps board-aware journey on the internal path when there are no cross-task links", () => {
    const task = buildTask("内部路径", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [task], stickers: [] });

    expect(getTaskProcessEntries(board, task).map((entry) => entry.title)).toEqual(["Start", "内部路径"]);
    expect(getTaskProcessEntries(board, task).map((entry) => entry.taskTitle)).toEqual(["内部路径", "内部路径"]);
  });

  it("follows cross-task links in a board-aware journey and keeps task metadata", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = addCrossTaskLink(normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] }), aiTask.nodes[1].id, kbTask.nodes[0].id);

    expect(getTaskProcessEntries(board, aiTask).map((entry) => entry.title)).toEqual(["Start", "AI 项目", "Start", "知识库"]);
    expect(getTaskProcessEntries(board, aiTask).map((entry) => entry.taskTitle)).toEqual(["AI 项目", "AI 项目", "知识库", "知识库"]);
  });

  it("summarizes completed tasks with board-aware cross-task journey steps", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const linked = addCrossTaskLink(normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] }), aiTask.nodes[1].id, kbTask.nodes[0].id);
    const completed = completeTask(linked, aiTask.id, new Date("2026-05-20T08:00:00Z"));

    expect(getCompletedTaskSummary(completed, completed.tasks[0])).toMatchObject({
      totalSteps: 4,
      milestoneCount: 0,
      startedAt: "2026-05-18T09:30:00.000Z",
      completedAt: "2026-05-20T08:00:00.000Z",
    });
  });

  it("labels plan milestones separately in the connected path", () => {
    const task = buildTask("展示计划路径", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const planned = addPlanMilestoneAfter(task, task.nodes[0].id, {
      title: "准备素材",
      detail: "还没完成",
      timestamp: "2026-05-19T12:00:00.000Z",
    });

    expect(getTaskProcessEntries(planned).map((entry) => entry.label)).toEqual(["Start", "Plan", "Finish"]);
  });

  it("deletes a task and normalizes stored board data", () => {
    const task = buildTask("删除目标", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const board = normalizeBoard({ tasks: [task], stickers: null });
    const deleted = deleteTask(board, task.id);

    expect(board.stickers).toEqual([]);
    expect(board.links).toEqual([]);
    expect(board.achievements).toEqual([]);
    expect(deleted.tasks).toEqual([]);
  });

  it("removes cross-task links attached to a deleted task", () => {
    const aiTask = buildTask("AI 项目", { x: 800, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const kbTask = buildTask("知识库", { x: 1200, y: 420 }, new Date("2026-05-18T09:30:00Z"));
    const board = addCrossTaskLink(normalizeBoard({ tasks: [aiTask, kbTask], stickers: [] }), aiTask.nodes[1].id, kbTask.nodes[0].id);
    const deleted = deleteTask(board, kbTask.id);

    expect(deleted.tasks.map((task) => task.id)).toEqual([aiTask.id]);
    expect(deleted.links).toEqual([]);
  });

  it("detects whether a stored board has recoverable user content", () => {
    const task = buildTask("旧数据", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));

    expect(hasBoardContent({ tasks: [], stickers: [] })).toBe(false);
    expect(hasBoardContent({ tasks: [task], stickers: [] })).toBe(true);
    expect(hasBoardContent({ tasks: [], stickers: [createEmojiSticker("✨", { x: 1, y: 2 })] })).toBe(true);
  });

  it("recovers backup content when the primary stored board is empty", () => {
    const task = buildTask("旧数据", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const backup = { tasks: [task], stickers: [] };
    const primary = { tasks: [], stickers: [] };

    expect(chooseStoredBoard(primary, backup)).toEqual(normalizeBoard(backup));
    expect(chooseStoredBoard(backup, primary)).toEqual(normalizeBoard(backup));
  });

  it("uses the newest stored board when both primary and backup have content", () => {
    const oldTask = buildTask("旧文件", { x: 600, y: 240 }, new Date("2026-05-18T09:30:00Z"));
    const newTask = buildTask("浏览器备份", { x: 900, y: 240 }, new Date("2026-05-19T09:30:00Z"));
    const primary = { tasks: [oldTask], stickers: [], updatedAt: "2026-05-18T09:30:00.000Z" };
    const backup = { tasks: [newTask], stickers: [], updatedAt: "2026-05-19T09:30:00.000Z" };

    expect(chooseStoredBoard(primary, backup)).toEqual(normalizeBoard(backup));
  });

  it("formats compact labels as year and date", () => {
    expect(formatCompactDate("2026-05-18T09:30:00.000Z")).toBe("2026/05/18");
  });
});
