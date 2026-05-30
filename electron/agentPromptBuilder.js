const RECENT_MEMORY_LIMIT = 5;
const RECENT_SIGNAL_LIMIT = 3;

function compactText(value, maxLength = 900) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function formatTurn(turn) {
  const assistant = turn.assistantText ? `\n助手：${turn.assistantText}` : "";
  return `用户：${turn.userText}${assistant}`;
}

function normalizeMemoryText(memory) {
  return compactText(memory?.memory || memory?.text || memory?.content || memory?.statement || JSON.stringify(memory), 240);
}

function findTaskMemory(boardMemory, taskLineId) {
  const task = (boardMemory?.taskLineSummaries || []).find((summary) => summary.taskLineId === taskLineId) || null;
  const branches = (boardMemory?.branchMemories || []).filter((branch) => branch.taskLineId === taskLineId);
  const signals = (boardMemory?.diarySignals || [])
    .filter((signal) => signal.taskLineId === taskLineId)
    .slice(-RECENT_SIGNAL_LIMIT);
  return { task, branches, signals };
}

export function buildAgentPrompt({
  session,
  boardMemory,
  recentTurns = [],
  rollingSummary = { text: "" },
  mem0Memories = [],
  userText,
  model,
}) {
  const taskMemory = findTaskMemory(boardMemory, session.taskLineId);
  const recentDialog = recentTurns.map(formatTurn).join("\n\n") || "暂无历史对话。";
  const memoryFacts = mem0Memories.slice(0, RECENT_MEMORY_LIMIT).map(normalizeMemoryText).filter(Boolean);
  const branches = taskMemory.branches.map((branch) => `${branch.partnerName || branch.label}: ${branch.summary}`).join("\n") || "暂无支线。";
  const signals = taskMemory.signals.map((signal) => {
    const blockers = Array.isArray(signal.blockers) && signal.blockers.length ? `；卡点：${signal.blockers.join("、")}` : "";
    return `${signal.emotion || "中性记录"}；主题：${(signal.topics || []).join("、")}${blockers}`;
  }).join("\n") || "暂无近期日记信号。";

  const systemPrompt = [
    "你是 StepView 的任务线 Agent。",
    "你必须用中文回答。",
    "你只基于当前 session 的对话窗口、滚动摘要、任务线信号、Mem0 动态认知和用户输入作答。",
    "不要编造不存在的任务、支线、日记或心理结论。",
    "心理需求分析只能作为动机和行为模式推测，不能做医学诊断。",
    "默认给陪伴式、结构化、低压力的下一步建议。",
    "",
    "## Fixed Layer",
    `Session: ${session.sessionId}`,
    `TaskLineId: ${session.taskLineId}`,
    `任务线标题：${session.title || "未命名任务线"}`,
    session.personaText ? `任务线 Agent 设定：${session.personaText}` : "任务线 Agent 设定：使用 StepView 默认陪伴式任务线助手设定。",
    "",
    "## Context Window",
    compactText(recentDialog, 4000),
    "",
    "## Rolling Summary",
    compactText(rollingSummary?.text || "暂无滚动摘要。", 1200),
    "",
    "## Dynamic Cognition From Mem0",
    memoryFacts.length ? memoryFacts.map((item, index) => `${index + 1}. ${item}`).join("\n") : "暂无 Mem0 召回记忆。",
    "",
    "## Task Signals",
    taskMemory.task ? JSON.stringify(taskMemory.task, null, 2) : "当前任务线摘要暂不可用。",
    "",
    "## Branch Signals",
    compactText(branches, 1200),
    "",
    "## Recent Diary Signals",
    compactText(signals, 900),
    "",
    "## User State Snapshot",
    JSON.stringify(boardMemory?.userStateSnapshot || {}, null, 2),
  ].join("\n");

  const userPrompt = String(userText || "").trim();
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  const promptState = {
    sessionId: session.sessionId,
    taskLineId: session.taskLineId,
    model: model || null,
    contextTurnIds: recentTurns.map((turn) => turn.turnId),
    rollingSummaryTurnIds: rollingSummary?.coveredTurnIds || [],
    mem0Count: memoryFacts.length,
    updatedAt: new Date().toISOString(),
  };

  return {
    messages,
    systemPrompt,
    userPrompt,
    promptState,
  };
}

