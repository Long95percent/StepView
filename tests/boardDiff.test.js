import { describe, expect, it } from "vitest";
import { diffBoards } from "../electron/agent/boardDiff.js";
import { normalizeBoard, buildTask } from "../src/progressCore.js";
import { planBoardChange } from "../electron/agent/boardChangePlanner.js";

const NOW = new Date("2026-05-20T10:00:00.000Z");

function boardWithTask() {
  return normalizeBoard({ tasks: [buildTask("考研", { x: 100, y: 100 }, NOW)] });
}

describe("board diff", () => {
  it("reports no changes for identical boards", () => {
    const board = boardWithTask();
    const diff = diffBoards(board, normalizeBoard(board));
    expect(diff.isEmpty).toBe(true);
    expect(diff.lines).toEqual([]);
    expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0 });
  });

  it("describes added nodes and edge rewiring on an existing task", () => {
    const before = boardWithTask();
    const task = before.tasks[0];
    const after = planBoardChange(before, { operation: "node.add_milestone", taskId: task.id, sourceNodeId: task.nodes[0].id, title: "复习高数" }, { now: NOW }).board;
    const diff = diffBoards(before, after);
    expect(diff.lines).toEqual([
      "在「考研」新增里程碑「复习高数」",
      "「考研」的连接关系已调整",
    ]);
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.modified).toBe(1);
  });

  it("summarises a brand new task line without walking its nodes", () => {
    const diff = diffBoards(normalizeBoard({ tasks: [] }), boardWithTask());
    expect(diff.lines).toEqual(["新增任务线「考研」"]);
  });

  it("reports completions, renames and stickers", () => {
    const before = boardWithTask();
    const taskId = before.tasks[0].id;
    const renamed = planBoardChange(before, { operation: "task.rename", taskId, title: "考研数学" }).board;
    expect(diffBoards(before, renamed).lines).toEqual(["任务线重命名「考研」→「考研数学」"]);

    const completed = planBoardChange(before, { operation: "task.complete", taskId }, { now: NOW }).board;
    expect(diffBoards(before, completed).lines).toEqual(["完成任务线「考研」"]);

    const withSticker = planBoardChange(before, { operation: "sticker.add", emoji: "🌱", x: 1, y: 2 }).board;
    expect(diffBoards(before, withSticker).lines).toEqual(["添加贴纸 🌱"]);
  });

  it("reports removed tasks and nodes", () => {
    const before = boardWithTask();
    const after = { ...before, tasks: [] };
    expect(diffBoards(before, after).lines).toEqual(["删除任务线「考研」"]);

    const task = before.tasks[0];
    const withNode = planBoardChange(before, { operation: "node.add_milestone", taskId: task.id, sourceNodeId: task.nodes[0].id, title: "复习高数" }, { now: NOW }).board;
    const lines = diffBoards(withNode, before).lines;
    expect(lines).toContain("在「考研」删除里程碑「复习高数」");
  });
});
