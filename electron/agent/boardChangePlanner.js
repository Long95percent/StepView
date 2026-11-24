import {
  normalizeBoard,
  buildTask,
  addMilestoneAfter,
  addPlanMilestoneAfter,
  togglePlanMilestoneComplete,
  toggleKeyNode,
  deleteNode,
  completeTask,
  restoreTask,
  deleteTask,
  createEmojiSticker,
  findNodeInBoard,
} from "../../src/progressCore.js";

export class BoardChangeError extends Error {
  constructor(message, { code = "BOARD_CHANGE_INVALID", operation = null } = {}) {
    super(message);
    this.name = "BoardChangeError";
    this.code = code;
    this.operation = operation;
  }
}

const MAX_TEXT_LENGTH = 200;
const MAX_SEQUENCE_LENGTH = 24;

function requireText(value, field, { operation, maxLength = MAX_TEXT_LENGTH } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new BoardChangeError(`${field} must be a non-empty string.`, { code: "BOARD_CHANGE_MISSING_FIELD", operation });
  const text = value.trim();
  if (text.length > maxLength) throw new BoardChangeError(`${field} must be at most ${maxLength} characters.`, { code: "BOARD_CHANGE_FIELD_TOO_LONG", operation });
  return text;
}

function requireTimestamp(value, operation) {
  if (value === undefined || value === null || value === "") return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new BoardChangeError("timestamp must be a valid date.", { code: "BOARD_CHANGE_INVALID_FIELD", operation });
  return parsed.toISOString();
}

function requireTask(board, taskId, operation) {
  const task = board.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new BoardChangeError(`Unknown task: ${taskId}`, { code: "BOARD_CHANGE_UNKNOWN_TASK", operation });
  return task;
}

function requireNode(board, nodeId, operation) {
  const found = findNodeInBoard(board, nodeId);
  if (!found) throw new BoardChangeError(`Unknown node: ${nodeId}`, { code: "BOARD_CHANGE_UNKNOWN_NODE", operation });
  const task = board.tasks.find((candidate) => candidate.id === found.taskId);
  return { task, node: found };
}

function replaceTask(board, taskId, nextTask) {
  return { ...board, tasks: board.tasks.map((task) => (task.id === taskId ? nextTask : task)) };
}

function resolvePosition(board, input) {
  if (typeof input.x === "number" && typeof input.y === "number") return { x: input.x, y: input.y };
  const index = board.tasks.length;
  return { x: 760 + index * 80, y: 360 + index * 80 };
}

export const BOARD_CHANGE_OPERATIONS = Object.freeze([
  "task.create",
  "task.rename",
  "task.complete",
  "task.restore",
  "task.delete",
  "node.add_milestone",
  "node.add_plan",
  "node.add_sequence",
  "node.update",
  "node.delete",
  "node.toggle_plan_complete",
  "node.toggle_key",
  "sticker.add",
  "sticker.remove",
]);

const OPERATIONS = {
  "task.create": (board, input, now) => {
    const title = requireText(input.title, "title", { operation: "task.create" });
    const task = buildTask(title, resolvePosition(board, input), now);
    const next = { ...board, tasks: [...board.tasks, task] };
    return { board: next, taskId: task.id, summary: `新建任务线「${title}」` };
  },

  "task.rename": (board, input) => {
    const task = requireTask(board, input.taskId, "task.rename");
    const title = requireText(input.title, "title", { operation: "task.rename" });
    const nextTask = {
      ...task,
      title,
      nodes: task.nodes.map((node) => (node.kind === "finish" ? { ...node, title } : node)),
    };
    return { board: replaceTask(board, task.id, nextTask), taskId: task.id, summary: `重命名任务线「${task.title}」为「${title}」` };
  },

  "task.complete": (board, input, now) => {
    const task = requireTask(board, input.taskId, "task.complete");
    if (task.status === "completed") throw new BoardChangeError(`Task is already completed: ${task.id}`, { code: "BOARD_CHANGE_NOOP", operation: "task.complete" });
    return { board: completeTask(board, task.id, now), taskId: task.id, summary: `完成任务线「${task.title}」` };
  },

  "task.restore": (board, input) => {
    const task = requireTask(board, input.taskId, "task.restore");
    if (task.status !== "completed") throw new BoardChangeError(`Task is not completed: ${task.id}`, { code: "BOARD_CHANGE_NOOP", operation: "task.restore" });
    return { board: restoreTask(board, task.id), taskId: task.id, summary: `恢复任务线「${task.title}」为进行中` };
  },

  "task.delete": (board, input) => {
    const task = requireTask(board, input.taskId, "task.delete");
    return { board: deleteTask(board, task.id), taskId: task.id, summary: `删除任务线「${task.title}」` };
  },

  "node.add_milestone": (board, input, now) => {
    const task = requireTask(board, input.taskId, "node.add_milestone");
    const sourceNodeId = requireText(input.sourceNodeId, "sourceNodeId", { operation: "node.add_milestone" });
    if (!task.nodes.some((node) => node.id === sourceNodeId)) throw new BoardChangeError(`Unknown node: ${sourceNodeId}`, { code: "BOARD_CHANGE_UNKNOWN_NODE", operation: "node.add_milestone" });
    const title = requireText(input.title, "title", { operation: "node.add_milestone" });
    const detail = typeof input.detail === "string" ? input.detail.trim().slice(0, 1000) : "";
    const nextTask = addMilestoneAfter(task, sourceNodeId, { title, detail, timestamp: requireTimestamp(input.timestamp, "node.add_milestone") });
    const added = nextTask.nodes.find((node) => !task.nodes.some((existing) => existing.id === node.id));
    return { board: replaceTask(board, task.id, nextTask), taskId: task.id, nodeId: added?.id || null, summary: `在「${task.title}」新增里程碑「${title}」` };
  },

  "node.add_plan": (board, input, now) => {
    const task = requireTask(board, input.taskId, "node.add_plan");
    const sourceNodeId = requireText(input.sourceNodeId, "sourceNodeId", { operation: "node.add_plan" });
    if (!task.nodes.some((node) => node.id === sourceNodeId)) throw new BoardChangeError(`Unknown node: ${sourceNodeId}`, { code: "BOARD_CHANGE_UNKNOWN_NODE", operation: "node.add_plan" });
    const title = requireText(input.title, "title", { operation: "node.add_plan" });
    const detail = typeof input.detail === "string" ? input.detail.trim().slice(0, 1000) : "";
    const nextTask = addPlanMilestoneAfter(task, sourceNodeId, { title, detail, timestamp: requireTimestamp(input.timestamp, "node.add_plan") });
    const added = nextTask.nodes.find((node) => !task.nodes.some((existing) => existing.id === node.id));
    return { board: replaceTask(board, task.id, nextTask), taskId: task.id, nodeId: added?.id || null, summary: `在「${task.title}」新增计划节点「${title}」` };
  },

  "node.add_sequence": (board, input, now) => {
    const task = requireTask(board, input.taskId, "node.add_sequence");
    const sourceNodeId = requireText(input.sourceNodeId, "sourceNodeId", { operation: "node.add_sequence" });
    if (!task.nodes.some((node) => node.id === sourceNodeId)) throw new BoardChangeError(`Unknown node: ${sourceNodeId}`, { code: "BOARD_CHANGE_UNKNOWN_NODE", operation: "node.add_sequence" });
    if (!Array.isArray(input.nodes) || input.nodes.length < 2 || input.nodes.length > MAX_SEQUENCE_LENGTH) {
      throw new BoardChangeError(`nodes must contain 2-${MAX_SEQUENCE_LENGTH} items.`, { code: "BOARD_CHANGE_INVALID_FIELD", operation: "node.add_sequence" });
    }

    let nextTask = task;
    let previousNodeId = sourceNodeId;
    const nodeIds = [];

    for (let index = 0; index < input.nodes.length; index += 1) {
      const item = input.nodes[index];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new BoardChangeError("Each sequence node must be an object.", { code: "BOARD_CHANGE_INVALID_FIELD", operation: "node.add_sequence" });
      }
      const kind = item.kind || "plan-milestone";
      if (!["milestone", "plan-milestone"].includes(kind)) {
        throw new BoardChangeError("kind must be milestone or plan-milestone.", { code: "BOARD_CHANGE_INVALID_FIELD", operation: "node.add_sequence" });
      }
      const title = requireText(item.title, `nodes[${index}].title`, { operation: "node.add_sequence" });
      const note = {
        title,
        detail: typeof item.detail === "string" ? item.detail.trim().slice(0, 1000) : "",
        timestamp: requireTimestamp(item.timestamp || new Date(now.getTime() + index * 1000).toISOString(), "node.add_sequence"),
        plannedFor: item.plannedFor,
      };
      const previousNodeIds = new Set(nextTask.nodes.map((node) => node.id));
      nextTask = kind === "milestone"
        ? addMilestoneAfter(nextTask, previousNodeId, note)
        : addPlanMilestoneAfter(nextTask, previousNodeId, note);
      const added = nextTask.nodes.find((node) => !previousNodeIds.has(node.id));
      if (!added) throw new BoardChangeError("Failed to add a sequence node.", { code: "BOARD_CHANGE_INVALID_FIELD", operation: "node.add_sequence" });
      previousNodeId = added.id;
      nodeIds.push(added.id);
    }

    return {
      board: replaceTask(board, task.id, nextTask),
      taskId: task.id,
      nodeId: nodeIds.at(-1) || null,
      nodeIds,
      summary: `在「${task.title}」新增连续节点 ${nodeIds.length} 个`,
    };
  },

  "node.update": (board, input) => {
    const { task, node } = requireNode(board, input.nodeId, "node.update");
    const nextNode = { ...node };
    delete nextNode.taskTitle;
    if (input.title !== undefined) nextNode.title = requireText(input.title, "title", { operation: "node.update" });
    if (input.detail !== undefined) nextNode.detail = String(input.detail).trim().slice(0, 1000);
    if (input.timestamp !== undefined) nextNode.timestamp = requireTimestamp(input.timestamp, "node.update");
    const nextTask = { ...task, nodes: task.nodes.map((candidate) => (candidate.id === node.id ? nextNode : candidate)) };
    return { board: replaceTask(board, task.id, nextTask), taskId: task.id, nodeId: node.id, summary: `修改「${task.title}」的节点「${nextNode.title}」` };
  },

  "node.delete": (board, input) => {
    const { task, node } = requireNode(board, input.nodeId, "node.delete");
    if (node.kind === "start" || node.kind === "finish") throw new BoardChangeError(`Cannot delete ${node.kind} nodes.`, { code: "BOARD_CHANGE_PROTECTED_NODE", operation: "node.delete" });
    const nextTask = deleteNode(task, node.id);
    return { board: replaceTask(board, task.id, nextTask), taskId: task.id, nodeId: node.id, summary: `删除「${task.title}」的节点「${node.title}」` };
  },

  "node.toggle_plan_complete": (board, input) => {
    const { task, node } = requireNode(board, input.nodeId, "node.toggle_plan_complete");
    if (node.kind !== "plan-milestone") throw new BoardChangeError(`Node is not a plan milestone: ${node.id}`, { code: "BOARD_CHANGE_INVALID_TARGET", operation: "node.toggle_plan_complete" });
    const nextTask = togglePlanMilestoneComplete(task, node.id);
    return { board: replaceTask(board, task.id, nextTask), taskId: task.id, nodeId: node.id, summary: `切换计划节点「${node.title}」的完成状态` };
  },

  "node.toggle_key": (board, input) => {
    const { task, node } = requireNode(board, input.nodeId, "node.toggle_key");
    return { board: toggleKeyNode(board, node.id), taskId: task.id, nodeId: node.id, summary: `切换「${node.title}」的关键时刻标记` };
  },

  "sticker.add": (board, input) => {
    const emoji = requireText(input.emoji, "emoji", { operation: "sticker.add", maxLength: 16 });
    if (typeof input.x !== "number" || typeof input.y !== "number") throw new BoardChangeError("x and y must be numbers.", { code: "BOARD_CHANGE_MISSING_FIELD", operation: "sticker.add" });
    const sticker = createEmojiSticker(emoji, { x: input.x, y: input.y });
    return { board: { ...board, stickers: [...board.stickers, sticker] }, stickerId: sticker.id, summary: `添加贴纸 ${emoji}` };
  },

  "sticker.remove": (board, input) => {
    const sticker = board.stickers.find((candidate) => candidate.id === input.stickerId);
    if (!sticker) throw new BoardChangeError(`Unknown sticker: ${input.stickerId}`, { code: "BOARD_CHANGE_UNKNOWN_STICKER", operation: "sticker.remove" });
    return { board: { ...board, stickers: board.stickers.filter((candidate) => candidate.id !== sticker.id) }, stickerId: sticker.id, summary: `移除贴纸 ${sticker.emoji}` };
  },
};

export function listBoardChangeOperations() {
  return [...BOARD_CHANGE_OPERATIONS];
}

export function planBoardChange(board, input = {}, { now = new Date() } = {}) {
  const operation = String(input.operation || "").trim();
  const plan = OPERATIONS[operation];
  if (!plan) throw new BoardChangeError(`Unsupported board operation: ${operation || "(empty)"}`, { code: "BOARD_CHANGE_UNSUPPORTED_OPERATION", operation });
  const normalized = normalizeBoard(board);
  const outcome = plan(normalized, input, now);
  return {
    operation,
    board: outcome.board,
    summary: outcome.summary,
    affected: {
      taskId: outcome.taskId || null,
      nodeId: outcome.nodeId || null,
      nodeIds: Array.isArray(outcome.nodeIds) ? outcome.nodeIds : (outcome.nodeId ? [outcome.nodeId] : []),
      stickerId: outcome.stickerId || null,
    },
  };
}
