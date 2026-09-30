import { normalizeBoard } from "../../src/progressCore.js";

const NODE_KIND_LABELS = {
  start: "起点",
  finish: "终点",
  milestone: "里程碑",
  "plan-milestone": "计划节点",
};

function nodeLabel(node) {
  if (!node) return "(unknown)";
  return `${NODE_KIND_LABELS[node.kind] || node.kind || "节点"}「${node.title || ""}」`;
}

function pushChange(changes, change) {
  changes.push(change);
}

function diffNodeList(changes, taskTitle, taskId, previousNodes, nextNodes, { renamedFrom = null } = {}) {
  const before = new Map(previousNodes.map((node) => [node.id, node]));
  const after = new Map(nextNodes.map((node) => [node.id, node]));

  for (const [id, node] of after) {
    if (!before.has(id)) {
      pushChange(changes, { kind: "node.added", taskId, taskTitle, nodeId: id, label: `在「${taskTitle}」新增${nodeLabel(node)}` });
      continue;
    }
    const prev = before.get(id);
    const fields = [];
    if (prev.title !== node.title) {
      const followsTaskRename = renamedFrom !== null && node.kind === "finish" && prev.title === renamedFrom && node.title === taskTitle;
      if (!followsTaskRename) fields.push(`标题「${prev.title}」→「${node.title}」`);
    }
    if (prev.detail !== node.detail) fields.push(`备注更新`);
    if (prev.timestamp !== node.timestamp) fields.push(`时间 ${prev.timestamp || "无"} → ${node.timestamp || "无"}`);
    if (prev.status !== node.status) fields.push(`状态 ${prev.status || "无"} → ${node.status || "无"}`);
    if (prev.isKeyNode !== node.isKeyNode) fields.push(node.isKeyNode ? "标记为关键时刻" : "取消关键时刻");
    if (fields.length) pushChange(changes, { kind: "node.updated", taskId, taskTitle, nodeId: id, label: `在「${taskTitle}」修改${nodeLabel(node)}：${fields.join("，")}` });
  }

  for (const [id, node] of before) {
    if (!after.has(id)) pushChange(changes, { kind: "node.removed", taskId, taskTitle, nodeId: id, label: `在「${taskTitle}」删除${nodeLabel(node)}` });
  }
}

function diffEdges(changes, taskTitle, taskId, previousTask, nextTask) {
  const before = new Set((previousTask.edges || []).map((edge) => `${edge.from}->${edge.to}`));
  const after = new Set((nextTask.edges || []).map((edge) => `${edge.from}->${edge.to}`));
  if (before.size !== after.size || [...after].some((edge) => !before.has(edge))) {
    pushChange(changes, { kind: "task.edges", taskId, taskTitle, label: `「${taskTitle}」的连接关系已调整` });
  }
}

export function diffBoards(beforeBoard, afterBoard) {
  const before = normalizeBoard(beforeBoard);
  const after = normalizeBoard(afterBoard);
  const changes = [];

  const beforeTasks = new Map(before.tasks.map((task) => [task.id, task]));
  const afterTasks = new Map(after.tasks.map((task) => [task.id, task]));

  for (const [id, task] of afterTasks) {
    if (!beforeTasks.has(id)) {
      pushChange(changes, { kind: "task.added", taskId: id, taskTitle: task.title, label: `新增任务线「${task.title}」` });
      continue;
    }
    const previous = beforeTasks.get(id);
    if (previous.title !== task.title) pushChange(changes, { kind: "task.renamed", taskId: id, taskTitle: task.title, label: `任务线重命名「${previous.title}」→「${task.title}」` });
    if (previous.status !== task.status) {
      pushChange(changes, {
        kind: "task.status",
        taskId: id,
        taskTitle: task.title,
        label: task.status === "completed" ? `完成任务线「${task.title}」` : `恢复任务线「${task.title}」为进行中`,
      });
    }
    diffNodeList(changes, task.title, id, previous.nodes || [], task.nodes || [], { renamedFrom: previous.title !== task.title ? previous.title : null });
    diffEdges(changes, task.title, id, previous, task);
  }

  for (const [id, task] of beforeTasks) {
    if (!afterTasks.has(id)) pushChange(changes, { kind: "task.removed", taskId: id, taskTitle: task.title, label: `删除任务线「${task.title}」` });
  }

  const beforeStickers = new Map(before.stickers.map((sticker) => [sticker.id, sticker]));
  const afterStickers = new Map(after.stickers.map((sticker) => [sticker.id, sticker]));
  for (const [id, sticker] of afterStickers) if (!beforeStickers.has(id)) pushChange(changes, { kind: "sticker.added", stickerId: id, label: `添加贴纸 ${sticker.emoji}` });
  for (const [id, sticker] of beforeStickers) if (!afterStickers.has(id)) pushChange(changes, { kind: "sticker.removed", stickerId: id, label: `移除贴纸 ${sticker.emoji}` });

  const beforeLinks = new Set((before.links || []).map((link) => link.id));
  const afterLinks = new Set((after.links || []).map((link) => link.id));
  const addedLinks = [...afterLinks].filter((id) => !beforeLinks.has(id)).length;
  const removedLinks = [...beforeLinks].filter((id) => !afterLinks.has(id)).length;
  if (addedLinks) pushChange(changes, { kind: "link.added", label: `新增 ${addedLinks} 条跨任务线连接` });
  if (removedLinks) pushChange(changes, { kind: "link.removed", label: `移除 ${removedLinks} 条跨任务线连接` });

  const beforeBranches = new Set((before.branches || []).map((branch) => branch.id));
  const afterBranches = new Set((after.branches || []).map((branch) => branch.id));
  const addedBranches = [...afterBranches].filter((id) => !beforeBranches.has(id)).length;
  const removedBranches = [...beforeBranches].filter((id) => !afterBranches.has(id)).length;
  if (addedBranches) pushChange(changes, { kind: "branch.added", label: `新增 ${addedBranches} 条支线` });
  if (removedBranches) pushChange(changes, { kind: "branch.removed", label: `移除 ${removedBranches} 条支线` });

  const beforeAchievements = new Set(before.achievements || []);
  for (const id of after.achievements || []) if (!beforeAchievements.has(id)) pushChange(changes, { kind: "achievement.unlocked", label: `解锁成就 ${id}` });

  const counts = {
    added: changes.filter((change) => change.kind.endsWith(".added")).length,
    removed: changes.filter((change) => change.kind.endsWith(".removed")).length,
    modified: changes.filter((change) => change.kind.endsWith(".updated") || change.kind.endsWith(".renamed") || change.kind.endsWith(".status") || change.kind.endsWith(".edges")).length,
  };

  return {
    changes,
    lines: changes.map((change) => change.label),
    counts,
    isEmpty: changes.length === 0,
  };
}
