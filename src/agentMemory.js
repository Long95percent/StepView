const AGENT_MEMORY_VERSION = 1;

const RECENT_LIMIT = 6;

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function compactText(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function isDone(task) {
  return task.status === "completed";
}

function getTaskBranches(board, task) {
  const activeBranches = (board.branches || []).filter((branch) => branch.taskId === task.id);
  const archivedBranches = Array.isArray(task.archivedBranches) ? task.archivedBranches : [];
  const byId = new Map();
  for (const branch of activeBranches) byId.set(branch.id, branch);
  for (const branch of archivedBranches) {
    if (!byId.has(branch.id)) byId.set(branch.id, branch);
  }
  return [...byId.values()];
}

function getBranchNodes(board, branchId) {
  return (board.tasks || [])
    .flatMap((task) => task.nodes || [])
    .filter((node) => node.branchId === branchId)
    .sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
}

function getMainNodes(task) {
  return (task.nodes || []).filter((node) => !node.branchId);
}

function getRecentNotes(nodes) {
  return nodes
    .filter((node) => compactText(node.detail).length > 0)
    .slice(-RECENT_LIMIT)
    .map((node) => ({
      id: node.id,
      title: node.title,
      note: compactText(node.detail, 180),
      timestamp: node.timestamp,
    }));
}

function getLatestNodeTimestamp(node) {
  return node.timestamp || node.updatedAt || node.createdAt || new Date().toISOString();
}

function detectEmotion(text) {
  const value = String(text || "");
  if (/焦虑|担心|害怕|压力|烦|崩|难受|卡住|不确定|犹豫|拖延/.test(value)) return "需要安抚";
  if (/开心|兴奋|顺利|完成|突破|喜欢|期待|满意/.test(value)) return "积极推进";
  if (/累|疲惫|没力气|休息|消耗/.test(value)) return "能量偏低";
  return "中性记录";
}

function extractBlockers(text) {
  const value = String(text || "");
  const blockers = [];
  if (/卡|卡住|阻塞|不会|没思路/.test(value)) blockers.push("推进卡点");
  if (/拖延|坚持|持续|断更/.test(value)) blockers.push("持续性压力");
  if (/时间|太忙|没空/.test(value)) blockers.push("时间不足");
  if (/不确定|犹豫|纠结|选择/.test(value)) blockers.push("决策不确定");
  if (/资源|钱|预算|人手/.test(value)) blockers.push("资源限制");
  return [...new Set(blockers)];
}

function summarizeNode(node) {
  const text = `${node.title} ${node.detail || ""}`;
  const blockers = extractBlockers(text);
  const keySignals = [
    detectEmotion(text),
    ...blockers,
    ...(node.isKeyNode ? ["关键节点"] : []),
    ...(node.kind === "plan-milestone" ? ["计划节点"] : []),
  ];
  return {
    nodeId: node.id,
    summary: compactText(node.detail || node.title, 180),
    keySignals: [...new Set(keySignals)].filter(Boolean),
    latestDiaryEntryIds: compactText(node.detail).length > 0 ? [node.id] : [],
    updatedAt: getLatestNodeTimestamp(node),
  };
}

function buildNodeSummaries(board) {
  return (board.tasks || [])
    .flatMap((task) => task.nodes || [])
    .filter((node) => compactText(node.detail).length > 0 || node.isKeyNode || node.kind === "plan-milestone")
    .map(summarizeNode);
}

function summarizeTask(task, board) {
  const nodes = task.nodes || [];
  const mainNodes = getMainNodes(task);
  const currentNode = mainNodes.at(-1) || nodes.at(-1) || null;
  const branchCount = getTaskBranches(board, task).length;
  const completedPlans = nodes.filter((node) => node.kind === "plan-milestone" && node.status === "completed").length;
  const planned = nodes.filter((node) => node.kind === "plan-milestone" && node.status !== "completed").length;
  const keyNodes = nodes.filter((node) => node.isKeyNode);
  const recentNotes = getRecentNotes(nodes);
  const currentFocus = isDone(task)
    ? "已完成，适合复盘和归档总结"
    : compactText(mainNodes.at(-2)?.title || mainNodes.at(-1)?.title || task.title, 80);
  const blockers = recentNotes.flatMap((note) => extractBlockers(`${note.title} ${note.note}`));

  return {
    taskLineId: task.id,
    title: task.title,
    status: task.status || "active",
    currentNodeId: currentNode?.id || null,
    progressSummary: `${task.title} 当前有 ${mainNodes.length} 个主线节点、${branchCount} 条支线、${planned} 个计划节点。${isDone(task) ? "这条任务线已经完成。" : "这条任务线仍在推进中。"}`,
    currentFocus,
    currentBlocks: [...new Set(blockers)].slice(0, 4),
    recentDecisions: keyNodes.slice(-3).map((node) => compactText(node.title, 80)),
    recentAchievements: isDone(task) ? [`完成于 ${task.completedAt || "未知时间"}`] : [],
    recentNotes,
    completedPlans,
    updatedAt: new Date().toISOString(),
  };
}

function summarizeBranch(board, task, branch) {
  const nodes = getBranchNodes(board, branch.id);
  const notes = getRecentNotes(nodes);
  const blockers = notes.flatMap((note) => extractBlockers(`${note.title} ${note.note}`));
  const latest = nodes.at(-1);
  return {
    branchId: branch.id,
    taskLineId: task.id,
    taskTitle: task.title,
    type: branch.type || "self",
    label: branch.label || "支线",
    partnerName: branch.partnerName || "",
    status: task.status === "completed" ? "archived" : branch.mergeToNodeId ? "merged" : "open",
    summary: nodes.length > 0
      ? `${branch.label || "支线"} 已记录 ${nodes.length} 个支线节点，最近停在「${compactText(latest?.title, 60)}」。`
      : `${branch.label || "支线"} 已创建，但还没有更多支线节点。`,
    userAttitude: blockers.includes("决策不确定") ? "hesitant" : "interested",
    requiredConditions: blockers.length > 0 ? blockers : ["继续补充支线节点或接回主线"],
    risks: blockers.includes("持续性压力") ? ["需要控制验证成本，避免支线拖成新主线"] : [],
    nextActions: branch.mergeToNodeId ? ["复盘支线对主线的影响"] : ["选择继续延展、接回主线或保持开放"],
    evidenceIds: nodes.map((node) => node.id),
    notes,
    updatedAt: new Date().toISOString(),
  };
}

function buildDiarySignals(board) {
  return (board.tasks || [])
    .flatMap((task) => (task.nodes || []).map((node) => ({ task, node })))
    .filter(({ node }) => compactText(node.detail).length > 0)
    .map(({ task, node }) => {
      const text = `${node.title} ${node.detail}`;
      return {
        id: `signal-${node.id}`,
        diaryEntryId: node.id,
        taskLineId: task.id,
        nodeId: node.id,
        branchId: node.branchId || null,
        emotion: detectEmotion(text),
        topics: [task.title, node.branchId ? "支线记录" : "主线记录"],
        blockers: extractBlockers(text),
        decisions: node.isKeyNode ? [compactText(node.title, 80)] : [],
        goals: node.kind === "plan-milestone" ? [compactText(node.title, 80)] : [],
        confidence: 0.68,
        createdAt: node.timestamp || task.createdAt,
      };
    });
}

function buildProfileFacts(taskSummaries, diarySignals) {
  const blockers = diarySignals.flatMap((signal) => signal.blockers);
  const facts = [];
  const blockerCounts = blockers.reduce((counts, blocker) => {
    counts[blocker] = (counts[blocker] || 0) + 1;
    return counts;
  }, {});

  for (const [blocker, count] of Object.entries(blockerCounts)) {
    if (count >= 2) {
      facts.push({
        id: `fact-${blocker}`,
        type: "working_style",
        statement: `用户在多个记录中反复出现「${blocker}」，回答时应优先给低成本、可验证的下一步。`,
        confidence: Math.min(0.9, 0.55 + count * 0.1),
        evidenceIds: diarySignals.filter((signal) => signal.blockers.includes(blocker)).map((signal) => signal.nodeId),
        updatedAt: new Date().toISOString(),
      });
    }
  }

  const activeCount = taskSummaries.filter((summary) => summary.status === "active").length;
  if (activeCount >= 3) {
    facts.push({
      id: "fact-many-active-lines",
      type: "preference",
      statement: "用户同时推进多条任务线，回答时需要帮助其选择焦点，避免所有线一起加压。",
      confidence: 0.72,
      evidenceIds: taskSummaries.filter((summary) => summary.status === "active").map((summary) => summary.taskLineId),
      updatedAt: new Date().toISOString(),
    });
  }

  return facts;
}

export function buildAgentMemory(board) {
  const safeBoard = {
    tasks: Array.isArray(board?.tasks) ? board.tasks : [],
    branches: Array.isArray(board?.branches) ? board.branches : [],
    stickers: Array.isArray(board?.stickers) ? board.stickers : [],
    links: Array.isArray(board?.links) ? board.links : [],
  };
  const taskLineSummaries = safeBoard.tasks.map((task) => summarizeTask(task, safeBoard));
  const nodeSummaries = buildNodeSummaries(safeBoard);
  const branchMemories = safeBoard.tasks.flatMap((task) =>
    getTaskBranches(safeBoard, task).map((branch) => summarizeBranch(safeBoard, task, branch)),
  );
  const diarySignals = buildDiarySignals(safeBoard);
  const userMemoryFacts = buildProfileFacts(taskLineSummaries, diarySignals);
  const activeTaskLineIds = taskLineSummaries.filter((summary) => summary.status === "active").map((summary) => summary.taskLineId);
  const recentBlockers = [...new Set(taskLineSummaries.flatMap((summary) => summary.currentBlocks))].slice(0, 5);

  return {
    version: AGENT_MEMORY_VERSION,
    updatedAt: new Date().toISOString(),
    userEvents: [],
    diarySignals,
    nodeSummaries,
    taskLineSummaries,
    branchMemories,
    userMemoryFacts,
    userStateSnapshot: {
      activeTaskLineIds,
      currentFocusTaskLineId: activeTaskLineIds[0] || taskLineSummaries[0]?.taskLineId || null,
      recentAchievementIds: taskLineSummaries.filter((summary) => summary.status === "completed").slice(-RECENT_LIMIT).map((summary) => summary.taskLineId),
      recentBlockers,
      emotionalTone: diarySignals.at(-1)?.emotion || "暂无日记信号",
      suggestedNextStep: recentBlockers.length > 0 ? "先选择一条任务线做低成本推进" : "选择当前最重要的任务线继续推进",
    },
  };
}

export function getAgentScopeOptions(board, memory = buildAgentMemory(board)) {
  const currentTasks = Array.isArray(board?.tasks) ? board.tasks : [];
  const visibleTaskIds = new Set(
    currentTasks
      .filter((task) => task.status === "active" || task.status === "completed")
      .map((task) => task.id),
  );
  const activeBranchIds = (Array.isArray(board?.branches) ? board.branches : [])
    .filter((branch) => visibleTaskIds.has(branch.taskId))
    .map((branch) => branch.id);
  const archivedBranchIds = currentTasks
    .filter((task) => task.status === "completed")
    .flatMap((task) => Array.isArray(task.archivedBranches) ? task.archivedBranches : [])
    .map((branch) => branch.id);
  const visibleBranchIds = new Set([...activeBranchIds, ...archivedBranchIds]);

  const taskOptions = memory.taskLineSummaries
    .filter((summary) => visibleTaskIds.has(summary.taskLineId))
    .map((summary) => ({
    id: `task:${summary.taskLineId}`,
    label: summary.title,
    detail: summary.status === "completed" ? "已完成" : "任务线",
  }));
  const branchOptions = memory.branchMemories
    .filter((branch) => visibleBranchIds.has(branch.branchId) && visibleTaskIds.has(branch.taskLineId))
    .map((branch) => ({
    id: `branch:${branch.branchId}`,
    label: branch.partnerName || branch.label,
    detail: `${branch.taskTitle} / ${branch.status}`,
  }));
  return [
    { id: "global", label: "全局", detail: "所有任务线" },
    ...taskOptions,
    ...branchOptions,
  ];
}

function routeScope(memory, scopeId, question) {
  if (scopeId && scopeId !== "auto") {
    if (scopeId === "global") return { type: "global" };
    const [type, id] = scopeId.split(":");
    if (type === "task") return { type: "task_line", taskLineId: id };
    if (type === "branch") {
      const branch = memory.branchMemories.find((candidate) => candidate.branchId === id);
      return { type: "branch", branchId: id, taskLineId: branch?.taskLineId || null };
    }
    if (type === "node") return { type: "node", nodeId: id };
    if (type === "diary") return { type: "diary", diaryEntryIds: [id] };
    if (type === "deep") return { type: "deep_analysis", baseScope: { type: "global" } };
  }

  const text = String(question || "");
  const branch = memory.branchMemories.find((candidate) => text.includes(candidate.label) || (candidate.partnerName && text.includes(candidate.partnerName)));
  if (branch) return { type: "branch", branchId: branch.branchId, taskLineId: branch.taskLineId };
  const node = memory.nodeSummaries.find((candidate) => text.includes(candidate.summary));
  if (node) return { type: "node", nodeId: node.nodeId };
  const task = memory.taskLineSummaries.find((candidate) => text.includes(candidate.title));
  if (task) return { type: "task_line", taskLineId: task.taskLineId };
  return { type: "global" };
}

function answerGlobal(memory) {
  const active = memory.taskLineSummaries.filter((summary) => summary.status === "active");
  const completed = memory.taskLineSummaries.filter((summary) => summary.status === "completed");
  const blockers = memory.userStateSnapshot.recentBlockers;
  return [
    `我看了你的全局任务结构：当前有 ${active.length} 条活跃任务线，${completed.length} 条已完成任务线。`,
    blockers.length > 0
      ? `最近反复出现的卡点是：${blockers.join("、")}。`
      : "最近没有明显重复卡点，比较适合继续推进当前焦点线。",
    memory.userMemoryFacts[0]?.statement || "现在更适合先选一条线做一个小推进，而不是同时拉开太多新分支。",
  ].join("\n");
}

function answerTask(memory, taskLineId) {
  const summary = memory.taskLineSummaries.find((candidate) => candidate.taskLineId === taskLineId);
  if (!summary) return "我没有找到这条任务线，可能它已经被删除或当前范围不匹配。";
  const branches = memory.branchMemories.filter((branch) => branch.taskLineId === taskLineId);
  const notes = summary.recentNotes.slice(-3).map((note) => `- ${note.title}: ${note.note}`).join("\n");
  return [
    `你问的是「${summary.title}」这条任务线。`,
    summary.progressSummary,
    `当前焦点：${summary.currentFocus}。`,
    summary.currentBlocks.length > 0 ? `主要卡点：${summary.currentBlocks.join("、")}。` : "暂时没有明显卡点。",
    branches.length > 0 ? `这条线下有 ${branches.length} 条支线：${branches.map((branch) => branch.partnerName || branch.label).join("、")}。` : "这条线目前没有支线。",
    notes ? `最近节点记录：\n${notes}` : "还没有足够的节点日记可供提炼。",
    "建议下一步：先做一个不会改变整条路线的小动作，再根据反馈决定是否延展分支。",
  ].join("\n");
}

function answerBranch(memory, branchId) {
  const branch = memory.branchMemories.find((candidate) => candidate.branchId === branchId);
  if (!branch) return "我没有找到这条支线，可能它已经被删除或当前范围不匹配。";
  const notes = branch.notes.slice(-3).map((note) => `- ${note.title}: ${note.note}`).join("\n");
  return [
    `你问的是「${branch.taskTitle}」里的「${branch.partnerName || branch.label}」支线。`,
    branch.summary,
    `状态判断：${branch.status === "archived" ? "这条支线已经随任务归档，适合复盘它对主线的影响。" : branch.status === "merged" ? "这条支线已经接回主线。" : "这条支线仍然开放，可以继续验证或接回主线。"}`,
    `需要注意：${branch.requiredConditions.join("、")}。`,
    branch.risks.length > 0 ? `风险：${branch.risks.join("、")}。` : "当前没有明显高风险，但不要让支线无限扩张。",
    notes ? `支线记录：\n${notes}` : "支线还没有足够日记内容。",
    `建议下一步：${branch.nextActions[0]}。`,
  ].join("\n");
}

function answerNode(memory, nodeId) {
  const node = memory.nodeSummaries.find((candidate) => candidate.nodeId === nodeId);
  if (!node) return "我没有找到这个节点，可能它已经被删除或当前范围不匹配。";
  const task = memory.taskLineSummaries.find((candidate) => candidate.currentNodeId === nodeId)
    || memory.taskLineSummaries.find((candidate) => (candidate.recentNotes || []).some((note) => note.id === nodeId));
  return [
    `你问的是「${node.summary}」这个节点。`,
    `节点信号：${node.keySignals.join("、") || "中性记录"}。`,
    task ? `它属于「${task.title}」这条任务线。` : "我能找到节点摘要，但暂时没法稳定匹配所属任务线。",
    node.latestDiaryEntryIds.length > 0 ? `最近日记证据：${node.latestDiaryEntryIds.join("、")}。` : "这个节点暂时没有日记证据。",
    "建议下一步：先围绕这个节点做一个最小动作，再决定要不要扩展成分支。",
  ].join("\n");
}

function answerDiary(memory, diaryEntryIds) {
  const signals = memory.diarySignals.filter((signal) => diaryEntryIds.includes(signal.diaryEntryId));
  if (signals.length === 0) return "我没有找到这组日记证据，可能它们已经不在当前可见范围内。";
  const blockers = [...new Set(signals.flatMap((signal) => signal.blockers))];
  return [
    `我看到了 ${signals.length} 条日记信号。`,
    `情绪倾向：${signals.map((signal) => signal.emotion).join("、")}。`,
    blockers.length > 0 ? `卡点：${blockers.join("、")}。` : "暂时没有抽到明显卡点。",
    "这些信号更适合用来更新当前任务线摘要，而不是直接升级成长期画像。",
  ].join("\n");
}

function answerDeepAnalysis(memory, baseScope) {
  const baseAnswer = baseScope.type === "branch"
    ? answerBranch(memory, baseScope.branchId)
    : baseScope.type === "node"
      ? answerNode(memory, baseScope.nodeId)
      : baseScope.type === "diary"
        ? answerDiary(memory, baseScope.diaryEntryIds)
        : baseScope.type === "task_line"
          ? answerTask(memory, baseScope.taskLineId)
          : answerGlobal(memory);
  return `${baseAnswer}\n\n深度分析模式：我会基于这个范围继续做更长周期的归纳，但当前实现仍默认保持轻量。`;
}

export function answerAgentQuestion(board, question, scopeId = "global") {
  const memory = buildAgentMemory(board);
  const route = routeScope(memory, scopeId, question);
  const answer = route.type === "deep_analysis"
    ? answerDeepAnalysis(memory, route.baseScope)
    : route.type === "branch"
      ? answerBranch(memory, route.branchId)
      : route.type === "node"
        ? answerNode(memory, route.nodeId)
        : route.type === "diary"
          ? answerDiary(memory, route.diaryEntryIds)
          : route.type === "task_line"
            ? answerTask(memory, route.taskLineId)
            : answerGlobal(memory);

  return {
    id: makeId("agent-message"),
    role: "assistant",
    answer,
    route,
    memory,
    createdAt: new Date().toISOString(),
  };
}
