const HORIZONTAL_GAP = 280;
const BRANCH_GAP_X = 220;
const BRANCH_GAP_Y = 150;
const MIN_VIEWPORT_SCALE = 0.08;
const MAX_VIEWPORT_SCALE = 2.6;

const icon = (codePoint) => String.fromCodePoint(codePoint);
const makeId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export const ICONS = {
  start: icon(0x1f680),
  finish: icon(0x1f3c1),
  milestone: icon(0x1f4cd),
  planMilestone: icon(0x1f4dd),
};

export const ACHIEVEMENTS = {
  firstGoal: {
    id: "first-goal",
    emoji: "✨",
    title: "First Spark",
    detail: "Created your first goal on the canvas.",
  },
  firstMilestone: {
    id: "first-milestone",
    emoji: "🛤️",
    title: "Trail Builder",
    detail: "Added the first milestone to a journey.",
  },
  firstPlanMilestone: {
    id: "first-plan-milestone",
    emoji: "📝",
    title: "Future Me",
    detail: "Planned a future milestone before it happened.",
  },
  firstPlanComplete: {
    id: "first-plan-complete",
    emoji: "✅",
    title: "Promise Keeper",
    detail: "Completed a planned milestone.",
  },
  firstKeyNode: {
    id: "first-key-node",
    emoji: "🌟",
    title: "Key Moment",
    detail: "Marked a node as a glowing key moment.",
  },
  firstCrossTaskLink: {
    id: "first-cross-task-link",
    emoji: "🕸️",
    title: "Web Weaver",
    detail: "Connected two goals with a purple thread.",
  },
  firstBranch: {
    id: "first-branch",
    emoji: "🧭",
    title: "Branch Explorer",
    detail: "Opened your first side branch.",
  },
  firstBranchExtension: {
    id: "first-branch-extension",
    emoji: "🎒",
    title: "Side Quest Hero",
    detail: "Extended a branch with another step.",
  },
  firstBranchMerge: {
    id: "first-branch-merge",
    emoji: "🔁",
    title: "Full Circle",
    detail: "Merged a branch back into the main journey.",
  },
  firstCompletion: {
    id: "first-completion",
    emoji: "🏁",
    title: "Victory Lap",
    detail: "Completed your first goal.",
  },
  constellationMaker: {
    id: "constellation-maker",
    emoji: "🌌",
    title: "Constellation Maker",
    detail: "Marked five key moments until the canvas looked like a star map.",
  },
  purpleRain: {
    id: "purple-rain",
    emoji: "☔",
    title: "Purple Rain",
    detail: "Created three cross-goal purple links.",
  },
  gardenPath: {
    id: "garden-path",
    emoji: "🌼",
    title: "Garden Path",
    detail: "Decorated the board with ten stickers.",
  },
  tinyUniverse: {
    id: "tiny-universe",
    emoji: "🪐",
    title: "Tiny Universe",
    detail: "Built a board with goals, stickers, branches, and cross-goal links.",
  },
  memoryKeeper: {
    id: "memory-keeper",
    emoji: "📚",
    title: "Memory Keeper",
    detail: "Completed a journey with at least five nodes.",
  },
  noLooseEnds: {
    id: "no-loose-ends",
    emoji: "🪢",
    title: "No Loose Ends",
    detail: "Completed a goal that had both a branch merge and a cross-goal link.",
  },
  signal520: {
    id: "520-signal",
    emoji: "💗",
    title: "520 Signal",
    detail: "Opened a lover branch on May 20.",
  },
  midnightBuilder: {
    id: "midnight-builder",
    emoji: "🌙",
    title: "Midnight Builder",
    detail: "Created a node after midnight.",
  },
  luckySeven: {
    id: "lucky-seven",
    emoji: "🍀",
    title: "Lucky Seven",
    detail: "Completed a goal with exactly seven nodes.",
  },
};

export const BRANCH_TYPES = {
  self: { emoji: "🧭", label: "我的分支" },
  partner: { emoji: "🤝", label: "伙伴支线" },
  lover: { emoji: "💗", label: "心动支线" },
};

const BRANCH_ANCHOR_OFFSETS = {
  "right-top": { x: BRANCH_GAP_X, y: -BRANCH_GAP_Y },
  "right-bottom": { x: BRANCH_GAP_X, y: BRANCH_GAP_Y },
  bottom: { x: 0, y: BRANCH_GAP_Y },
  "left-bottom": { x: -BRANCH_GAP_X, y: BRANCH_GAP_Y },
};

export function normalizeBoard(value) {
  return {
    tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    stickers: Array.isArray(value?.stickers) ? value.stickers : [],
    links: Array.isArray(value?.links) ? value.links : [],
    branches: Array.isArray(value?.branches) ? value.branches : [],
    achievements: Array.isArray(value?.achievements) ? value.achievements : [],
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function getNextViewportScale(currentScale, deltaY) {
  return Math.min(MAX_VIEWPORT_SCALE, Math.max(MIN_VIEWPORT_SCALE, currentScale - deltaY * 0.001));
}

export function getNewlyUnlockedAchievements(previousBoard, nextBoard) {
  const previous = new Set(previousBoard.achievements || []);
  const next = new Set(nextBoard.achievements || []);
  return Object.values(ACHIEVEMENTS).filter((achievement) => !previous.has(achievement.id) && next.has(achievement.id));
}

export function getAchievementCollection(board) {
  const unlocked = new Set(board.achievements || []);
  return Object.values(ACHIEVEMENTS).map((achievement) => ({
    ...achievement,
    unlocked: unlocked.has(achievement.id),
  }));
}

function appendAchievement(achievementIds, achievement, condition) {
  if (!condition || achievementIds.includes(achievement.id)) return achievementIds;
  return [...achievementIds, achievement.id];
}

function getAllBranches(board) {
  const normalized = normalizeBoard(board);
  const archivedBranches = normalized.tasks.flatMap((task) => Array.isArray(task.archivedBranches) ? task.archivedBranches : []);
  const branchesById = new Map();

  for (const branch of normalized.branches) branchesById.set(branch.id, branch);
  for (const branch of archivedBranches) {
    if (!branchesById.has(branch.id)) branchesById.set(branch.id, branch);
  }

  return [...branchesById.values()];
}

function isMay20(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getMonth() === 4 && date.getDate() === 20;
}

function isMidnightHour(value) {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getHours() === 0;
}

export function unlockBoardAchievements(board) {
  const normalized = normalizeBoard(board);
  const nodes = normalized.tasks.flatMap((task) => task.nodes || []);
  const branches = getAllBranches(normalized);
  const crossTaskLinks = (normalized.links || []).filter((link) => link.kind === "cross-task");
  const branchTaskIds = new Set(branches.map((branch) => branch.taskId));
  const mergedBranchTaskIds = new Set(branches.filter((branch) => branch.mergeToNodeId).map((branch) => branch.taskId));
  const linkedTaskIds = new Set(crossTaskLinks.flatMap((link) => [link.fromTaskId, link.toTaskId]));
  let achievements = normalized.achievements || [];

  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstGoal, normalized.tasks.length > 0);
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstMilestone, nodes.some((node) => node.kind === "milestone"));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstPlanMilestone, nodes.some((node) => node.kind === "plan-milestone"));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstPlanComplete, nodes.some((node) => node.kind === "plan-milestone" && node.status === "completed"));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstKeyNode, nodes.some((node) => node.isKeyNode));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstCrossTaskLink, crossTaskLinks.length > 0);
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstBranch, branches.length > 0);
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstBranchExtension, nodes.some((node) => node.branchId && node.previousBranchNodeId));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstBranchMerge, branches.some((branch) => branch.mergeToNodeId));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.firstCompletion, normalized.tasks.some((task) => task.status === "completed"));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.constellationMaker, nodes.filter((node) => node.isKeyNode).length >= 5);
  achievements = appendAchievement(achievements, ACHIEVEMENTS.purpleRain, crossTaskLinks.length >= 3);
  achievements = appendAchievement(achievements, ACHIEVEMENTS.gardenPath, normalized.stickers.length >= 10);
  achievements = appendAchievement(achievements, ACHIEVEMENTS.tinyUniverse, normalized.tasks.length > 0 && normalized.stickers.length > 0 && branches.length > 0 && crossTaskLinks.length > 0);
  achievements = appendAchievement(achievements, ACHIEVEMENTS.memoryKeeper, normalized.tasks.some((task) => task.status === "completed" && task.nodes.length >= 5));
  achievements = appendAchievement(
    achievements,
    ACHIEVEMENTS.noLooseEnds,
    normalized.tasks.some((task) => task.status === "completed" && mergedBranchTaskIds.has(task.id) && (linkedTaskIds.has(task.id) || branchTaskIds.has(task.id) && crossTaskLinks.length > 0)),
  );
  achievements = appendAchievement(achievements, ACHIEVEMENTS.signal520, branches.some((branch) => branch.type === "lover" && isMay20(branch.createdAt)));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.midnightBuilder, nodes.some((node) => isMidnightHour(node.timestamp)));
  achievements = appendAchievement(achievements, ACHIEVEMENTS.luckySeven, normalized.tasks.some((task) => task.status === "completed" && task.nodes.length === 7));

  return { ...normalized, achievements };
}

export function hasBoardContent(board) {
  return board.tasks.length > 0 || board.stickers.length > 0 || (board.branches || []).length > 0;
}

export function chooseStoredBoard(primaryBoard, backupBoard) {
  const primary = normalizeBoard(primaryBoard);
  const backup = normalizeBoard(backupBoard);
  if (!hasBoardContent(primary) && hasBoardContent(backup)) return backup;
  if (hasBoardContent(primary) && hasBoardContent(backup) && backup.updatedAt && primary.updatedAt && backup.updatedAt > primary.updatedAt) return backup;
  return primary;
}

export function findNodeInBoard(board, nodeId) {
  for (const task of board.tasks) {
    const node = task.nodes.find((candidate) => candidate.id === nodeId);
    if (node) return { ...node, taskTitle: task.title };
  }
  return null;
}

export function getUnifiedEdges(board) {
  const internalEdges = board.tasks.flatMap((task) =>
    task.edges.map((edge) => ({
      id: edge.id,
      fromTaskId: task.id,
      fromNodeId: edge.from,
      toTaskId: task.id,
      toNodeId: edge.to,
      kind: "internal",
    })),
  );
  const crossTaskEdges = (board.links || []).map((link) => ({
    id: link.id,
    fromTaskId: link.fromTaskId,
    fromNodeId: link.fromNodeId,
    toTaskId: link.toTaskId,
    toNodeId: link.toNodeId,
    kind: link.kind,
  }));
  return [...internalEdges, ...crossTaskEdges];
}

export function nodeHasOutgoingNext(board, nodeId) {
  return getUnifiedEdges(board).some((edge) => edge.fromNodeId === nodeId);
}

export function wouldCreateCycle(board, fromNodeId, toNodeId) {
  if (fromNodeId === toNodeId) return true;
  const nextById = new Map();
  for (const edge of [...getUnifiedEdges(board), { fromNodeId, toNodeId }]) {
    if (!nextById.has(edge.fromNodeId)) nextById.set(edge.fromNodeId, []);
    nextById.get(edge.fromNodeId).push(edge.toNodeId);
  }
  const visited = new Set();
  const stack = [toNodeId];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === fromNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(nextById.get(current) || []));
  }

  return false;
}

export function addCrossTaskLink(board, fromNodeId, toNodeId, now = new Date()) {
  const fromNode = findNodeInBoard(board, fromNodeId);
  const toNode = findNodeInBoard(board, toNodeId);
  if (!fromNode || !toNode) throw new Error("Node not found.");
  if (fromNode.taskId === toNode.taskId) throw new Error("Cross-task links only for now.");
  if (wouldCreateCycle(board, fromNodeId, toNodeId)) throw new Error("This link would create a loop.");

  return {
    ...board,
    links: [
      ...(board.links || []),
      {
        id: makeId("link"),
        fromTaskId: fromNode.taskId,
        fromNodeId,
        toTaskId: toNode.taskId,
        toNodeId,
        kind: "cross-task",
        createdAt: now.toISOString(),
      },
    ],
    achievements: board.achievements?.includes(ACHIEVEMENTS.firstCrossTaskLink.id)
      ? board.achievements
      : [...(board.achievements || []), ACHIEVEMENTS.firstCrossTaskLink.id],
  };
}

export function deleteCrossTaskLink(board, linkId) {
  return { ...board, links: (board.links || []).filter((link) => link.id !== linkId) };
}

function getBranchType(type) {
  return BRANCH_TYPES[type] ? type : "self";
}

function getBranchPosition(sourceNode, anchor) {
  const offset = BRANCH_ANCHOR_OFFSETS[anchor] || BRANCH_ANCHOR_OFFSETS["right-bottom"];
  return { x: sourceNode.x + offset.x, y: sourceNode.y + offset.y };
}

export function addBranch(board, fromNodeId, options = {}) {
  const normalized = normalizeBoard(board);
  const fromNode = findNodeInBoard(normalized, fromNodeId);
  if (!fromNode) throw new Error("Node not found.");

  const type = getBranchType(options.type);
  const typeConfig = BRANCH_TYPES[type];
  const branchId = makeId("branch");
  const branchNodeId = makeId("node");
  const anchor = options.anchor || "right-bottom";
  const position = getBranchPosition(fromNode, anchor);
  const timestamp = (options.now || new Date()).toISOString();
  const label = (options.label || typeConfig.label).trim();
  const branchNode = {
    id: branchNodeId,
    taskId: fromNode.taskId,
    branchId,
    kind: "milestone",
    emoji: typeConfig.emoji,
    title: label,
    detail: type === "lover" ? "心动支线已开启。" : "",
    timestamp,
    x: position.x,
    y: position.y,
  };

  return {
    ...normalized,
    tasks: normalized.tasks.map((task) =>
      task.id === fromNode.taskId ? { ...task, nodes: [...task.nodes, branchNode] } : task,
    ),
    branches: [
      ...normalized.branches,
      {
        id: branchId,
        taskId: fromNode.taskId,
        type,
        fromNodeId,
        toNodeId: branchNodeId,
        mergeToNodeId: null,
        anchor,
        label,
        partnerName: options.partnerName || "",
        createdAt: timestamp,
      },
    ],
  };
}

export function deleteBranch(board, branchId) {
  const normalized = normalizeBoard(board);
  const branchNodeIds = new Set(
    normalized.tasks.flatMap((task) => task.nodes.filter((node) => node.branchId === branchId).map((node) => node.id)),
  );
  return {
    ...normalized,
    branches: normalized.branches.filter((branch) => branch.id !== branchId),
    tasks: normalized.tasks.map((task) => ({
      ...task,
      nodes: task.nodes.filter((node) => !branchNodeIds.has(node.id)),
    })),
  };
}

export function deleteBranchNode(board, nodeId) {
  const normalized = normalizeBoard(board);
  const node = findNodeInBoard(normalized, nodeId);
  if (!node?.branchId) return normalized;
  const branch = normalized.branches.find((candidate) => candidate.id === node.branchId);
  if (!branch) return normalized;
  const previousNodeId = node.previousBranchNodeId || branch.fromNodeId;
  const children = normalized.tasks
    .flatMap((task) => task.nodes)
    .filter((candidate) => candidate.previousBranchNodeId === nodeId);
  const nextNodeId = children[0]?.id || null;

  return {
    ...normalized,
    tasks: normalized.tasks.map((task) => ({
      ...task,
      nodes: task.nodes
        .filter((candidate) => candidate.id !== nodeId)
        .map((candidate) => (candidate.previousBranchNodeId === nodeId ? { ...candidate, previousBranchNodeId: previousNodeId } : candidate)),
    })),
    branches: normalized.branches.map((candidate) => {
      if (candidate.id !== branch.id) return candidate;
      const toNodeId = candidate.toNodeId === nodeId ? (nextNodeId || previousNodeId) : candidate.toNodeId;
      const mergeToNodeId = candidate.toNodeId === nodeId && !nextNodeId ? null : candidate.mergeToNodeId;
      return { ...candidate, toNodeId, mergeToNodeId };
    }),
  };
}

export function connectBranchToNode(board, branchId, targetNodeId) {
  const normalized = normalizeBoard(board);
  const branch = normalized.branches.find((candidate) => candidate.id === branchId);
  const targetNode = findNodeInBoard(normalized, targetNodeId);
  if (!branch || !targetNode) throw new Error("Branch target not found.");
  return {
    ...normalized,
    branches: normalized.branches.map((candidate) =>
      candidate.id === branchId ? { ...candidate, mergeToNodeId: targetNodeId } : candidate,
    ),
  };
}

export function addBranchMilestoneAfter(board, branchId, sourceNodeId, note) {
  const normalized = normalizeBoard(board);
  const branch = normalized.branches.find((candidate) => candidate.id === branchId);
  const sourceNode = findNodeInBoard(normalized, sourceNodeId);
  if (!branch || !sourceNode) throw new Error("Branch node not found.");
  const typeConfig = BRANCH_TYPES[branch.type] || BRANCH_TYPES.self;
  const nodeId = makeId("node");
  const timestamp = note.timestamp ? new Date(note.timestamp).toISOString() : new Date().toISOString();
  const node = {
    id: nodeId,
    taskId: branch.taskId,
    branchId,
    previousBranchNodeId: sourceNodeId,
    kind: "milestone",
    emoji: typeConfig.emoji,
    title: note.title?.trim() || "Branch step",
    detail: note.detail || "",
    timestamp,
    x: sourceNode.x + BRANCH_GAP_X,
    y: sourceNode.y,
  };
  return {
    ...normalized,
    tasks: normalized.tasks.map((task) =>
      task.id === branch.taskId ? { ...task, nodes: [...task.nodes, node] } : task,
    ),
    branches: normalized.branches.map((candidate) =>
      candidate.id === branchId ? { ...candidate, toNodeId: nodeId, mergeToNodeId: null } : candidate,
    ),
  };
}

export function getCrossTaskLinkSegments(board) {
  return (board.links || []).flatMap((link) => {
    const fromNode = findNodeInBoard(board, link.fromNodeId);
    const toNode = findNodeInBoard(board, link.toNodeId);
    if (!fromNode || !toNode) return [];
    return [
      {
        id: link.id,
        fromTaskId: link.fromTaskId,
        toTaskId: link.toTaskId,
        x1: fromNode.x,
        y1: fromNode.y,
        x2: toNode.x,
        y2: toNode.y,
      },
    ];
  });
}

export function getBranchSegments(board) {
  const normalized = normalizeBoard(board);
  return normalized.branches.flatMap((branch) => {
    const fromNode = findNodeInBoard(normalized, branch.fromNodeId);
    const toNode = findNodeInBoard(normalized, branch.toNodeId);
    if (!fromNode || !toNode) return [];
    const branchNodes = normalized.tasks
      .flatMap((task) => task.nodes)
      .filter((node) => node.branchId === branch.id);
    const branchSegments = branchNodes.map((node) => {
      const sourceNode = node.previousBranchNodeId ? findNodeInBoard(normalized, node.previousBranchNodeId) : fromNode;
      if (!sourceNode) return null;
      return {
        id: node.previousBranchNodeId ? `${branch.id}-${node.id}` : branch.id,
        branchId: branch.id,
        type: branch.type,
        anchor: branch.anchor,
        label: branch.label,
        partnerName: branch.partnerName,
        x1: sourceNode.x,
        y1: sourceNode.y,
        x2: node.x,
        y2: node.y,
      };
    }).filter(Boolean);
    const mergeNode = branch.mergeToNodeId ? findNodeInBoard(normalized, branch.mergeToNodeId) : null;
    if (!mergeNode) return branchSegments;
    return [
      ...branchSegments,
      {
        ...branchSegments.at(-1),
        id: `${branch.id}-merge`,
        x1: toNode.x,
        y1: toNode.y,
        x2: mergeNode.x,
        y2: mergeNode.y,
        isMerge: true,
      },
    ];
  });
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

export function toggleKeyNode(board, nodeId) {
  return {
    ...board,
    tasks: board.tasks.map((task) => ({
      ...task,
      nodes: task.nodes.map((node) => (node.id === nodeId ? { ...node, isKeyNode: !node.isKeyNode } : node)),
    })),
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
  const normalized = normalizeBoard(board);
  const archivedBranches = normalized.branches.filter((branch) => branch.taskId === taskId);
  return {
    ...normalized,
    tasks: normalized.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status: "completed",
            completedAt: now.toISOString(),
            ...(archivedBranches.length > 0 ? { archivedBranches } : {}),
          }
        : task,
    ),
    branches: normalized.branches.filter((branch) => branch.taskId !== taskId),
  };
}

function toProcessEntry(node, taskTitle) {
  return {
    id: node.id,
    taskId: node.taskId,
    taskTitle,
    kind: node.kind,
    label: node.kind === "start" ? "Start" : node.kind === "finish" ? "Finish" : node.kind === "plan-milestone" ? "Plan" : "Milestone",
    emoji: node.emoji,
    title: node.title,
    detail: node.detail,
    timestamp: node.timestamp,
    status: node.status,
  };
}

export function getTaskProcessEntries(boardOrTask, maybeTask) {
  if (maybeTask) return getBoardTaskProcessEntries(boardOrTask, maybeTask);

  const task = boardOrTask;
  const nodesById = new Map(task.nodes.map((node) => [node.id, node]));
  const nextById = new Map(task.edges.map((edge) => [edge.from, edge.to]));
  const start = task.nodes.find((node) => node.kind === "start") || task.nodes[0];
  const entries = [];
  const visited = new Set();
  let current = start;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    entries.push(toProcessEntry(current, task.title));
    current = nodesById.get(nextById.get(current.id));
  }

  return entries;
}

export function getTaskBranchEntries(board, task) {
  const normalized = normalizeBoard(board);
  const branches = Array.isArray(task.archivedBranches) && task.archivedBranches.length > 0
    ? task.archivedBranches
    : normalized.branches.filter((branch) => branch.taskId === task.id);

  return branches
    .map((branch) => {
      const sourceNode = findNodeInBoard(normalized, branch.fromNodeId);
      const mergeNode = branch.mergeToNodeId ? findNodeInBoard(normalized, branch.mergeToNodeId) : null;
      const branchNodes = normalized.tasks
        .flatMap((candidate) => candidate.nodes)
        .filter((node) => node.branchId === branch.id);
      const remaining = new Map(branchNodes.map((node) => [node.id, node]));
      const entries = [];
      let current = branchNodes.find((node) => !node.previousBranchNodeId) || remaining.get(branch.toNodeId);

      while (current && remaining.has(current.id)) {
        remaining.delete(current.id);
        const nodeWithTask = findNodeInBoard(normalized, current.id) || current;
        entries.push(toProcessEntry(nodeWithTask, nodeWithTask.taskTitle || task.title));
        current = branchNodes.find((node) => node.previousBranchNodeId === current.id);
      }

      for (const node of remaining.values()) {
        const nodeWithTask = findNodeInBoard(normalized, node.id) || node;
        entries.push(toProcessEntry(nodeWithTask, nodeWithTask.taskTitle || task.title));
      }

      return {
        id: branch.id,
        type: getBranchType(branch.type),
        label: branch.label || BRANCH_TYPES[getBranchType(branch.type)].label,
        partnerName: branch.partnerName || "",
        sourceTitle: sourceNode?.title || null,
        mergeTitle: mergeNode?.title || null,
        nodes: entries,
      };
    })
    .filter((branch) => branch.nodes.length > 0);
}

function getBoardTaskProcessEntries(board, task) {
  const internalNextById = new Map(board.tasks.flatMap((candidate) => candidate.edges.map((edge) => [edge.from, edge.to])));
  const crossTaskNextById = new Map((board.links || []).map((link) => [link.fromNodeId, link.toNodeId]));
  const start = task.nodes.find((node) => node.kind === "start") || task.nodes[0];
  const entries = [];
  const visited = new Set();
  let current = start;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const nodeWithTask = findNodeInBoard(board, current.id);
    if (!nodeWithTask) break;
    entries.push(toProcessEntry(nodeWithTask, nodeWithTask.taskTitle));
    current = findNodeInBoard(board, internalNextById.get(current.id) || crossTaskNextById.get(current.id));
  }

  return entries;
}

export function getCompletedTaskSummary(boardOrTask, maybeTask) {
  const task = maybeTask || boardOrTask;
  const processEntries = maybeTask ? getTaskProcessEntries(boardOrTask, maybeTask) : getTaskProcessEntries(task);
  const branchEntries = maybeTask ? getTaskBranchEntries(boardOrTask, maybeTask) : (Array.isArray(task.archivedBranches) ? task.archivedBranches : []).length;
  return {
    totalSteps: processEntries.length,
    milestoneCount: processEntries.filter((entry) => entry.kind === "milestone" || entry.kind === "plan-milestone").length,
    branchCount: Array.isArray(branchEntries) ? branchEntries.length : branchEntries,
    branchStepCount: Array.isArray(branchEntries) ? branchEntries.reduce((sum, branch) => sum + branch.nodes.length, 0) : 0,
    startedAt: processEntries[0]?.timestamp || task.createdAt,
    completedAt: task.completedAt,
  };
}

export function restoreTask(board, taskId) {
  const normalized = normalizeBoard(board);
  const taskToRestore = normalized.tasks.find((task) => task.id === taskId);
  const restoredBranches = Array.isArray(taskToRestore?.archivedBranches) ? taskToRestore.archivedBranches : [];
  const activeBranchIds = new Set(normalized.branches.map((branch) => branch.id));
  return {
    ...normalized,
    tasks: normalized.tasks.map((task) => {
      if (task.id !== taskId) return task;
      const { archivedBranches, completedAt, ...restored } = task;
      return { ...restored, status: "active" };
    }),
    branches: [
      ...normalized.branches,
      ...restoredBranches.filter((branch) => !activeBranchIds.has(branch.id)),
    ],
  };
}

export function deleteTask(board, taskId) {
  const normalized = normalizeBoard(board);
  return {
    ...normalized,
    tasks: normalized.tasks.filter((task) => task.id !== taskId),
    branches: normalized.branches.filter((branch) => branch.taskId !== taskId),
    links: (normalized.links || []).filter((link) => link.fromTaskId !== taskId && link.toTaskId !== taskId),
  };
}

export function formatCompactDate(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}
