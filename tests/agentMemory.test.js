import { describe, expect, it } from "vitest";
import { addBranch, addBranchMilestoneAfter, buildTask, completeTask, normalizeBoard } from "../src/progressCore";
import { answerAgentQuestion, buildAgentMemory, getAgentScopeOptions } from "../src/agentMemory";

describe("agent memory", () => {
  it("builds task line summaries, branch memories, diary signals, and scope options", () => {
    const task = buildTask("AI knowledge base", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const withBranch = addBranch(normalizeBoard({ tasks: [task], stickers: [] }), task.nodes[0].id, {
      type: "self",
      label: "content branch",
    });
    const extended = addBranchMilestoneAfter(withBranch, withBranch.branches[0].id, withBranch.branches[0].toNodeId, {
      title: "write daily note",
      detail: "I am worried that I cannot keep doing this every day.",
      timestamp: "2026-05-19T12:00:00.000Z",
    });

    const memory = buildAgentMemory(extended);
    const options = getAgentScopeOptions(extended, memory);

    expect(memory.taskLineSummaries).toHaveLength(1);
    expect(memory.branchMemories).toHaveLength(1);
    expect(memory.diarySignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ branchId: extended.branches[0].id }),
    ]));
    expect(options.map((option) => option.id)).toEqual(expect.arrayContaining(["global", `task:${task.id}`, `branch:${extended.branches[0].id}`]));
  });

  it("answers branch questions from archived branch snapshots after task completion", () => {
    const task = buildTask("launch project", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const withBranch = addBranch(normalizeBoard({ tasks: [task], stickers: [] }), task.nodes[0].id, {
      type: "partner",
      label: "research branch",
      partnerName: "Ming",
    });
    const extended = addBranchMilestoneAfter(withBranch, withBranch.branches[0].id, withBranch.branches[0].toNodeId, {
      title: "compare direction",
      detail: "This branch helped us choose a lower cost validation path.",
      timestamp: "2026-05-19T12:00:00.000Z",
    });
    const completed = completeTask(extended, task.id, new Date("2026-05-20T08:00:00Z"));
    const branchId = completed.tasks[0].archivedBranches[0].id;

    const response = answerAgentQuestion(completed, "怎么看这个支线", `branch:${branchId}`);

    expect(response.route).toMatchObject({ type: "branch", branchId });
    expect(response.answer).toContain("launch project");
    expect(response.answer).toContain("Ming");
  });

  it("keeps stale agent memory entries out of scope options", () => {
    const activeTask = buildTask("current canvas task", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const completedTask = {
      ...buildTask("completed win", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z")),
      status: "completed",
      completedAt: "2026-05-20T08:00:00.000Z",
    };
    const board = normalizeBoard({ tasks: [
      activeTask,
      completedTask,
    ], stickers: [] });
    const staleMemory = {
      taskLineSummaries: [
        { taskLineId: activeTask.id, title: activeTask.title, status: "active" },
        { taskLineId: completedTask.id, title: completedTask.title, status: "completed" },
        { taskLineId: "deleted-task", title: "deleted old task", status: "active" },
      ],
      branchMemories: [
        { branchId: "deleted-branch", taskLineId: "deleted-task", taskTitle: "deleted old task", label: "old branch", status: "open" },
      ],
    };

    const options = getAgentScopeOptions(board, staleMemory);

    expect(options.map((option) => option.id)).toEqual(["global", `task:${activeTask.id}`, `task:${completedTask.id}`]);
  });

  it("builds node summaries and links them into task summaries", () => {
    const task = buildTask("design memory", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const updated = normalizeBoard({
      tasks: [{
        ...task,
        nodes: task.nodes.map((node) => (
          node.kind === "finish"
            ? { ...node, detail: "We felt anxious about scope creep but chose the smallest next step.", timestamp: "2026-05-19T12:00:00.000Z" }
            : node
        )),
      }],
      stickers: [],
    });

    const memory = buildAgentMemory(updated);

    expect(memory.nodeSummaries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nodeId: task.nodes[task.nodes.length - 1].id,
        latestDiaryEntryIds: [task.nodes[task.nodes.length - 1].id],
      }),
    ]));
    expect(memory.taskLineSummaries[0]).toEqual(expect.objectContaining({
      currentNodeId: task.nodes[task.nodes.length - 1].id,
    }));
  });

  it("answers node, diary, and deep analysis scopes through the query router", () => {
    const task = buildTask("query memory", { x: 700, y: 300 }, new Date("2026-05-18T09:30:00Z"));
    const diaryNode = task.nodes[task.nodes.length - 1];
    const board = normalizeBoard({
      tasks: [{
        ...task,
        nodes: task.nodes.map((node) => (
          node.id === diaryNode.id
            ? { ...node, detail: "I am anxious about choosing the wrong direction.", timestamp: "2026-05-19T12:00:00.000Z" }
            : node
        )),
      }],
      stickers: [],
    });

    const nodeResponse = answerAgentQuestion(board, "这个节点怎么看", `node:${diaryNode.id}`);
    const diaryResponse = answerAgentQuestion(board, "看这篇日记", `diary:${diaryNode.id}`);
    const deepResponse = answerAgentQuestion(board, "做一次深度分析", "deep:global");

    expect(nodeResponse.route).toEqual({ type: "node", nodeId: diaryNode.id });
    expect(diaryResponse.route).toEqual({ type: "diary", diaryEntryIds: [diaryNode.id] });
    expect(deepResponse.route).toEqual({ type: "deep_analysis", baseScope: { type: "global" } });
    expect(deepResponse.answer).toContain("深度分析模式");
  });
});
