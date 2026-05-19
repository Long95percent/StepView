const HORIZONTAL_GAP = 280;

const icon = (codePoint) => String.fromCodePoint(codePoint);
const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export const ICONS = {
  start: icon(0x1f680),
  finish: icon(0x1f3c1),
  milestone: icon(0x1f4cd),
  planMilestone: icon(0x1f4dd),
};

export function normalizeBoard(value) {
  return {
    tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    stickers: Array.isArray(value?.stickers) ? value.stickers : [],
  };
}

export function hasBoardContent(board) {
  return board.tasks.length > 0 || board.stickers.length > 0;
}

export function buildTask(title, finishPosition, now = new Date()) {
  const taskId = makeId("task");
  const startId = makeId("node");
  const finishId = makeId("node");
  const timestamp = now.toISOString();

  return {
    id: taskId,
    title: title.trim(),
    status: "active",
    createdAt: timestamp,
    nodes: [
      {
        id: startId,
        taskId,
        kind: "start",
        emoji: ICONS.start,
        title: "Start",
        detail: "Start pushing this goal from here.",
        timestamp,
        x: finishPosition.x - HORIZONTAL_GAP,
        y: finishPosition.y,
      },
      {
        id: finishId,
        taskId,
        kind: "finish",
        emoji: ICONS.finish,
        title: title.trim(),
        detail: "Final goal",
        timestamp,
        x: finishPosition.x,
        y: finishPosition.y,
      },
    ],
    edges: [{ id: makeId("edge"), from: startId, to: finishId }],
  };
}

function addNodeAfter(task, sourceNodeId, node) {
  const sourceIndex = task.nodes.findIndex((node) => node.id === sourceNodeId);
  if (sourceIndex === -1) return task;

  const sourceNode = task.nodes[sourceIndex];
  const nextNode = task.nodes[sourceIndex + 1];
  const insertedNode = {
    ...node,
    id: makeId("node"),
    taskId: task.id,
    x: sourceNode.x + HORIZONTAL_GAP,
    y: sourceNode.y + 20,
  };

  const nodes = [...task.nodes];
  nodes.splice(sourceIndex + 1, 0, insertedNode);

  const edges = task.edges.filter((edge) => !(edge.from === sourceNode.id && edge.to === nextNode?.id));
  edges.push({ id: makeId("edge"), from: sourceNode.id, to: insertedNode.id });
  if (nextNode) edges.push({ id: makeId("edge"), from: insertedNode.id, to: nextNode.id });

  return { ...task, nodes, edges };
}

export function addMilestoneAfter(task, sourceNodeId, note) {
  const milestone = {
    kind: "milestone",
    emoji: ICONS.milestone,
    title: note.title.trim() || "New milestone",
    detail: note.detail.trim(),
    timestamp: note.timestamp,
  };

  return addNodeAfter(task, sourceNodeId, milestone);
}

export function addPlanMilestoneAfter(task, sourceNodeId, note) {
  const planMilestone = {
    kind: "plan-milestone",
    status: "planned",
    emoji: ICONS.planMilestone,
    title: note.title.trim() || "New plan",
    detail: note.detail.trim(),
    timestamp: note.timestamp,
  };

  return addNodeAfter(task, sourceNodeId, planMilestone);
}

export function togglePlanMilestoneComplete(task, nodeId, now = new Date()) {
  return {
    ...task,
    nodes: task.nodes.map((node) => {
      if (node.id !== nodeId || node.kind !== "plan-milestone") return node;
      if (node.status === "completed") {
        const { completedAt, ...plannedNode } = node;
        return { ...plannedNode, status: "planned" };
      }
      return { ...node, status: "completed", completedAt: now.toISOString() };
    }),
  };
}

export function createEmojiSticker(emoji, position) {
  return { id: makeId("emoji"), emoji, x: position.x, y: position.y };
}

export function createConfettiBurst(position, count = 18) {
  const colors = ["#80f7ff", "#c48eff", "#ffdb5c", "#ff5474", "#4cffc7", "#ffffff"];
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count;
    const distance = 80 + (index % 4) * 18;
    return {
      id: makeId("confetti"),
      x: position.x,
      y: position.y,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance - 32,
      color: colors[index % colors.length],
      rotation: index * 37,
      delay: (index % 5) * 18,
    };
  });
}

export function moveCanvasItem(board, itemId, position) {
  return {
    ...board,
    tasks: board.tasks.map((task) => ({
      ...task,
      nodes: task.nodes.map((node) => (node.id === itemId ? { ...node, ...position } : node)),
    })),
    stickers: board.stickers.map((sticker) => (sticker.id === itemId ? { ...sticker, ...position } : sticker)),
  };
}

export function deleteNode(task, nodeId) {
  const node = task.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || node.kind === "start" || node.kind === "finish") return task;

  const incoming = task.edges.find((edge) => edge.to === nodeId);
  const outgoing = task.edges.find((edge) => edge.from === nodeId);
  const edges = task.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  if (incoming && outgoing) edges.push({ id: makeId("edge"), from: incoming.from, to: outgoing.to });

  return { ...task, nodes: task.nodes.filter((candidate) => candidate.id !== nodeId), edges };
}

export function completeTask(board, taskId, now = new Date()) {
  return {
    ...board,
    tasks: board.tasks.map((task) =>
      task.id === taskId ? { ...task, status: "completed", completedAt: now.toISOString() } : task,
    ),
  };
}

export function getTaskProcessEntries(task) {
  const nodesById = new Map(task.nodes.map((node) => [node.id, node]));
  const nextById = new Map(task.edges.map((edge) => [edge.from, edge.to]));
  const start = task.nodes.find((node) => node.kind === "start") || task.nodes[0];
  const entries = [];
  const visited = new Set();
  let current = start;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    entries.push({
      id: current.id,
      kind: current.kind,
      label: current.kind === "start" ? "Start" : current.kind === "finish" ? "Finish" : current.kind === "plan-milestone" ? "Plan" : "Milestone",
      emoji: current.emoji,
      title: current.title,
      detail: current.detail,
      timestamp: current.timestamp,
      status: current.status,
    });
    current = nodesById.get(nextById.get(current.id));
  }

  return entries;
}

export function getCompletedTaskSummary(task) {
  const processEntries = getTaskProcessEntries(task);
  return {
    totalSteps: processEntries.length,
    milestoneCount: processEntries.filter((entry) => entry.kind === "milestone" || entry.kind === "plan-milestone").length,
    startedAt: processEntries[0]?.timestamp || task.createdAt,
    completedAt: task.completedAt,
  };
}

export function restoreTask(board, taskId) {
  return {
    ...board,
    tasks: board.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const { completedAt, ...restored } = task;
      return { ...restored, status: "active" };
    }),
  };
}

export function deleteTask(board, taskId) {
  return { ...board, tasks: board.tasks.filter((task) => task.id !== taskId) };
}

export function formatCompactDate(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}
