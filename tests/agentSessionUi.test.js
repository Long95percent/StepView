import { describe, expect, it } from "vitest";
import { buildAgentMemory } from "../src/agentMemory";
import { buildTask, normalizeBoard } from "../src/progressCore";
import { getActiveAgentScopeOptions, getAgentSessionTurns, sanitizeAgentScopeId } from "../src/agentSessionUi";

describe("agent session ui", () => {
  it("shows only active task sessions in scope options", () => {
    const activeTask = buildTask("active canvas task", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const completedTask = {
      ...buildTask("completed canvas task", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z")),
      status: "completed",
      completedAt: "2026-05-20T08:00:00.000Z",
    };
    const board = normalizeBoard({
      tasks: [
        { ...activeTask, status: "active" },
        completedTask,
      ],
      stickers: [],
    });
    const memory = buildAgentMemory(board);

    const options = getActiveAgentScopeOptions(board, memory);

    expect(options.map((option) => option.id)).toEqual([`task:${activeTask.id}`]);
  });

  it("drops completed or missing sessions when sanitizing the selected scope", () => {
    const activeTask = buildTask("active canvas task", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const completedTask = {
      ...buildTask("completed canvas task", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z")),
      status: "completed",
      completedAt: "2026-05-20T08:00:00.000Z",
    };
    const board = normalizeBoard({ tasks: [activeTask, completedTask], stickers: [] });
    const memory = buildAgentMemory(board);

    expect(sanitizeAgentScopeId(board, `task:${activeTask.id}`, memory)).toBe(`task:${activeTask.id}`);
    expect(sanitizeAgentScopeId(board, `task:${completedTask.id}`, memory)).toBe(`task:${activeTask.id}`);
    expect(sanitizeAgentScopeId(board, "task:missing", memory)).toBe(`task:${activeTask.id}`);
  });

  it("returns only turns for the current task session", () => {
    const boardTask = buildTask("session task", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const journal = {
      rawTurns: [
        {
          id: "turn-1",
          userText: "第一问",
          assistantText: "第一答",
          scopeId: `task:${boardTask.id}`,
          route: { type: "task_line", taskLineId: boardTask.id },
          source: "local",
          createdAt: "2026-05-20T08:00:00.000Z",
        },
        {
          id: "turn-2",
          userText: "全局问",
          assistantText: "全局答",
          scopeId: "global",
          route: { type: "global" },
          source: "local",
          createdAt: "2026-05-20T09:00:00.000Z",
        },
      ],
      rollingSummary: { text: "", coveredTurnIds: [], updatedAt: null },
      sessionState: { recentTurnIds: [], latestSummaryText: "", activeTaskLineIds: [], currentFocusTaskLineId: null, emotionalTone: "中性记录", updatedAt: null },
      updatedAt: null,
    };

    expect(getAgentSessionTurns(journal, `task:${boardTask.id}`).map((turn) => turn.id)).toEqual(["turn-1"]);
    expect(getAgentSessionTurns(journal, "global").map((turn) => turn.id)).toEqual(["turn-1", "turn-2"]);
  });
});
