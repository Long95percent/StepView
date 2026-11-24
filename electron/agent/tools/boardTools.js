import { randomUUID } from "node:crypto";
import { defineTool } from "./defineTool.js";
import { requireToolContext } from "./context.js";
import { BOARD_CHANGE_OPERATIONS, planBoardChange, BoardChangeError } from "../boardChangePlanner.js";
import { diffBoards } from "../boardDiff.js";
import { boardHash } from "../boardChangeStore.js";

const CHANGE_FIELDS = {
  operation: { type: "string", enum: [...BOARD_CHANGE_OPERATIONS], description: "Which board operation to propose." },
  reason: { type: "string", minLength: 1, maxLength: 500, description: "Why this change helps the user. Shown in the review dialog." },
  taskId: { type: "string", maxLength: 120 },
  nodeId: { type: "string", maxLength: 120 },
  sourceNodeId: { type: "string", maxLength: 120 },
  stickerId: { type: "string", maxLength: 120 },
  title: { type: "string", maxLength: 200 },
  detail: { type: "string", maxLength: 1000 },
  timestamp: { type: "string", maxLength: 40 },
  emoji: { type: "string", maxLength: 16 },
  x: { type: "number" },
  y: { type: "number" },
};

const NODE_DETAIL_LIMIT = 300;

function compactText(value, maxLength = NODE_DETAIL_LIMIT) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function compactNode(node, taskId) {
  return {
    id: node.id,
    taskId,
    branchId: node.branchId || null,
    kind: node.kind,
    title: node.title,
    detail: compactText(node.detail),
    status: node.status || null,
    plannedFor: node.plannedFor || null,
    timestamp: node.timestamp || null,
    isKeyNode: Boolean(node.isKeyNode),
  };
}

function compactTaskOverview(board, task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status || "active",
    nodeCount: Array.isArray(task.nodes) ? task.nodes.length : 0,
    planCount: Array.isArray(task.nodes) ? task.nodes.filter((node) => node.kind === "plan-milestone").length : 0,
    branchCount: (board.branches || []).filter((branch) => branch.taskId === task.id).length,
  };
}

function readBoardFrom(context, toolId) {
  requireToolContext(context, ["boardStorage"], toolId);
  return context.boardStorage.readBoard();
}

export const boardTools = [
  defineTool({
    id: "board.get_current_state",
    title: "Get current board",
    description:
      "Read a compact overview of the whole board, plus full node IDs and key fields for one task line. "
      + "The current session's task line is selected by default; pass taskId to inspect another task line. "
      + "Use board.search when you need to match details across task lines.",
    category: "board",
    risk: "read",
    scopes: ["board:read"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: { type: "string", maxLength: 120, description: "Optional task line to inspect. Defaults to the current session's task line." },
      },
    },
    execute: async (input = {}, context) => {
      const board = await readBoardFrom(context, "board.get_current_state");
      const tasks = Array.isArray(board.tasks) ? board.tasks : [];
      const requestedTaskId = String(input.taskId || context.taskLineId || "").trim();
      const selectedTask = tasks.find((task) => task.id === requestedTaskId) || null;
      const branches = (board.branches || []).filter((branch) => branch.taskId === selectedTask?.id);

      return {
        summary: {
          taskCount: tasks.length,
          nodeCount: tasks.reduce((sum, task) => sum + (Array.isArray(task.nodes) ? task.nodes.length : 0), 0),
          stickerCount: (board.stickers || []).length,
          branchCount: (board.branches || []).length,
          linkCount: (board.links || []).length,
        },
        tasks: tasks.map((task) => compactTaskOverview(board, task)),
        selectedTaskId: selectedTask?.id || null,
        selectedTask: selectedTask ? {
          id: selectedTask.id,
          title: selectedTask.title,
          status: selectedTask.status || "active",
          nodes: (selectedTask.nodes || []).map((node) => compactNode(node, selectedTask.id)),
        } : null,
        stickers: (board.stickers || []).map(({ id, emoji, x, y }) => ({ id, emoji, x, y })),
        branches: branches.map((branch) => ({
          id: branch.id,
          taskId: branch.taskId,
          type: branch.type || null,
          label: branch.label || null,
          partnerName: branch.partnerName || null,
          mergeToNodeId: branch.mergeToNodeId || null,
        })),
      };
    },
  }),

  defineTool({
    id: "board.search",
    title: "Search board",
    description: "Search the user's board for task lines and nodes matching a keyword.",
    category: "board",
    risk: "read",
    scopes: ["board:read"],
    inputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 200 } } },
    execute: async ({ query }, context) => {
      const board = await readBoardFrom(context, "board.search");
      const needle = String(query).toLowerCase();
      return (board.tasks || [])
        .map((task) => {
          const haystack = `${task.title} ${(task.nodes || []).map((node) => `${node.title} ${node.detail || ""}`).join(" ")}`.toLowerCase();
          return haystack.includes(needle) ? task : null;
        })
        .filter(Boolean);
    },
  }),

  defineTool({
    id: "board.propose_change",
    title: "Propose a board change",
    description: "Propose one change to the user's board. This does NOT modify the board: it stages a reviewable change with a backup and a diff, and the user decides whether to keep it.",
    category: "board",
    risk: "propose",
    mutatesBoard: false,
    scopes: ["board:propose"],
    inputSchema: { type: "object", additionalProperties: false, required: ["operation", "reason"], properties: CHANGE_FIELDS },
    execute: async (input, context) => {
      requireToolContext(context, ["boardStorage", "boardChangeStore", "accountId"], "board.propose_change");
      const currentBoard = await context.boardStorage.readBoard();
      const plan = planBoardChange(currentBoard, input);
      const diff = diffBoards(currentBoard, plan.board);
      if (diff.isEmpty) throw new BoardChangeError("The proposed change would not modify the board.", { code: "BOARD_CHANGE_EMPTY", operation: plan.operation });

      const proposalId = `proposal-${randomUUID()}`;
      await context.boardChangeStore.stage({
        proposalId,
        accountId: context.accountId,
        sessionId: context.sessionId || null,
        operation: plan.operation,
        reason: input.reason,
        summary: plan.summary,
        diff,
        before: currentBoard,
        after: plan.board,
      });

      return {
        type: "board_change",
        proposalId,
        accountId: context.accountId,
        operation: plan.operation,
        summary: plan.summary,
        reason: input.reason,
        affected: plan.affected,
        baseHash: boardHash(currentBoard),
        diff: { lines: diff.lines, counts: diff.counts },
        requiresApproval: true,
      };
    },
  }),
];
