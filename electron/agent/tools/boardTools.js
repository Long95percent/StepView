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

function readBoardFrom(context, toolId) {
  requireToolContext(context, ["boardStorage"], toolId);
  return context.boardStorage.readBoard();
}

export const boardTools = [
  defineTool({
    id: "board.get_current_state",
    title: "Get current board",
    description: "Read the user's whole board: task lines, nodes, stickers, branches and links.",
    category: "board",
    risk: "read",
    scopes: ["board:read"],
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    execute: async (_input, context) => readBoardFrom(context, "board.get_current_state"),
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
