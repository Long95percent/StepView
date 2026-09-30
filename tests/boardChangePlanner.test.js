import { describe, expect, it } from "vitest";
import { BoardChangeError, BOARD_CHANGE_OPERATIONS, listBoardChangeOperations, planBoardChange } from "../electron/agent/boardChangePlanner.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const NOW = new Date("2026-05-20T10:00:00.000Z");

function makeBoard(title = "考研") {
  return deepFreeze(normalizeBoard({ tasks: [buildTask(title, { x: 100, y: 100 }, NOW)] }));
}

describe("board change planner", () => {
  it("creates a task line without mutating the input board", () => {
    const board = deepFreeze(normalizeBoard({ tasks: [] }));
    const result = planBoardChange(board, { operation: "task.create", title: "考研" }, { now: NOW });
    expect(result.summary).toBe("新建任务线「考研」");
    expect(result.board.tasks).toHaveLength(1);
    expect(board.tasks).toHaveLength(0);
    expect(Object.isFrozen(result.board.tasks[0])).toBe(false);
  });

  it("adds milestone and plan nodes after a source node", () => {
    const board = makeBoard();
    const task = board.tasks[0];
    const milestone = planBoardChange(board, { operation: "node.add_milestone", taskId: task.id, sourceNodeId: task.nodes[0].id, title: "复习高数", detail: "第一章" }, { now: NOW });
    expect(milestone.summary).toBe("在「考研」新增里程碑「复习高数」");
    expect(milestone.board.tasks[0].nodes).toHaveLength(3);
    expect(milestone.affected.nodeId).toBeTruthy();

    const plan = planBoardChange(board, { operation: "node.add_plan", taskId: task.id, sourceNodeId: task.nodes[0].id, title: "报名" }, { now: NOW });
    const added = plan.board.tasks[0].nodes.find((node) => node.id === plan.affected.nodeId);
    expect(added).toMatchObject({ kind: "plan-milestone", status: "planned" });
  });

  it("keeps the finish node title in sync when renaming a task line", () => {
    const board = makeBoard();
    const result = planBoardChange(board, { operation: "task.rename", taskId: board.tasks[0].id, title: "考研数学" });
    expect(result.summary).toBe("重命名任务线「考研」为「考研数学」");
    expect(result.board.tasks[0].nodes.find((node) => node.kind === "finish").title).toBe("考研数学");
  });

  it("completes and restores a task line", () => {
    const board = makeBoard();
    const taskId = board.tasks[0].id;
    const completed = planBoardChange(board, { operation: "task.complete", taskId }, { now: NOW });
    expect(completed.board.tasks[0]).toMatchObject({ status: "completed" });
    const restored = planBoardChange(completed.board, { operation: "task.restore", taskId });
    expect(restored.board.tasks[0].status).toBe("active");
  });

  it("supports stickers and refuses protected nodes", () => {
    const board = makeBoard();
    const task = board.tasks[0];
    const added = planBoardChange(board, { operation: "sticker.add", emoji: "🌱", x: 5, y: 6 });
    expect(added.board.stickers).toHaveLength(1);
    const removed = planBoardChange(added.board, { operation: "sticker.remove", stickerId: added.affected.stickerId });
    expect(removed.board.stickers).toHaveLength(0);

    expect(() => planBoardChange(board, { operation: "node.delete", nodeId: task.nodes[0].id })).toThrow(BoardChangeError);
  });

  it("reports precise error codes for invalid operations and references", () => {
    const board = makeBoard();
    const code = (input) => {
      try {
        planBoardChange(board, input);
        return null;
      } catch (error) {
        return error.code;
      }
    };
    expect(code({ operation: "nope" })).toBe("BOARD_CHANGE_UNSUPPORTED_OPERATION");
    expect(code({ operation: "task.rename", taskId: "missing", title: "x" })).toBe("BOARD_CHANGE_UNKNOWN_TASK");
    expect(code({ operation: "node.update", nodeId: "missing", title: "x" })).toBe("BOARD_CHANGE_UNKNOWN_NODE");
    expect(code({ operation: "task.create", title: "   " })).toBe("BOARD_CHANGE_MISSING_FIELD");
    expect(code({ operation: "task.complete", taskId: board.tasks[0].id })).toBe(null);
    expect(code({ operation: "task.complete", taskId: board.tasks[0].id })).toBe(null);
  });

  it("rejects no-op operations", () => {
    const board = makeBoard();
    const completed = planBoardChange(board, { operation: "task.complete", taskId: board.tasks[0].id }, { now: NOW });
    expect(() => planBoardChange(completed.board, { operation: "task.complete", taskId: board.tasks[0].id })).toThrow("already completed");
  });

  it("exposes a stable operation list", () => {
    expect(listBoardChangeOperations()).toEqual([...BOARD_CHANGE_OPERATIONS]);
    expect(BOARD_CHANGE_OPERATIONS).toEqual(expect.arrayContaining(["task.create", "node.add_milestone", "node.add_plan", "sticker.add", "sticker.remove"]));
    expect(BOARD_CHANGE_OPERATIONS).toHaveLength(new Set(BOARD_CHANGE_OPERATIONS).size);
  });
});
