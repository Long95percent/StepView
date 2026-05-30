# Agent Journal 与滚动摘要设计

## 背景

`docs/README/README.txt` 明确要求 StepView 的 Agent 数据流遵循：

```text
用户输入
  -> 原文优先落库
  -> 后台摘要、信号、用户偏好提取
  -> 派生结果再落库
  -> 读取进内存 prompt
  -> 前端展示
```

当前实现已经有 `src/agentMemory.js`，可以从当前 board 派生任务线摘要、支线记忆、日记信号和状态快照。但它更接近“从画布现场即时构建派生记忆”，还没有独立保存原始对话轮次，也没有 README 要求的最近 20 轮滑窗和被挤出 5 轮的滚动摘要。

本设计补齐第一阶段地基：独立 Agent Journal、会话滑窗、滚动摘要快照，以及与现有 `agentMemory` 的衔接。

## 目标

- 原始对话轮次必须先落库，不能只存在 React state 或临时回答里。
- board 文件继续只保存画布事实，避免对话历史污染任务线、节点、支线和成就数据。
- prompt 构建所需上下文由“最近 20 轮原文 + 最新滚动摘要 + 当前任务信号 + 用户状态快照”组成。
- 超过窗口的旧对话不从数据库删除，只从 prompt 窗口移出，并合并进滚动摘要。
- 本阶段使用本地轻量规则实现摘要占位，保留未来接入小模型、SQLite、Redis、Mem0 的接口边界。
- 不引入任何 demo/sample/tutorial 数据，不覆盖或替换用户 board。

## 非目标

- 本阶段不实现 Action Mode 的画布增删改查工具调用。
- 本阶段不实现 Mem0、Redis 或 SQLite 真实依赖。
- 本阶段不做深度心理分析、行业调研或长期报告。
- 本阶段不迁移已有 board 数据格式中的任务线、节点、支线字段。

## 推荐架构

新增独立的 Agent Journal 存储层，优先放在 Electron 主进程：

- `electron/agentJournalStorage.js`
- 数据文件：`stepview-agent-journal.json`
- 备份文件：`stepview-agent-journal.backup.json`
- 临时文件：`stepview-agent-journal.json.tmp`

它复用 `boardStorage` 的安全写入思想：UTF-8、临时文件、rename、可恢复 backup、写队列串行化。

### Journal 数据形状

```ts
type AgentJournal = {
  version: 1
  rawTurns: AgentTurn[]
  rollingSummary: RollingSummary
  sessionState: AgentSessionState
  updatedAt: string | null
}

type AgentTurn = {
  id: string
  userText: string
  assistantText: string
  scopeId: string
  route: QueryScope
  source: "local" | "openai" | "local-fallback"
  model?: string
  createdAt: string
}

type RollingSummary = {
  text: string
  coveredTurnIds: string[]
  updatedAt: string | null
}

type AgentSessionState = {
  recentTurnIds: string[]
  latestSummaryText: string
  activeTaskLineIds: string[]
  currentFocusTaskLineId: string | null
  emotionalTone: string
  updatedAt: string | null
}
```

### 滑窗规则

- prompt 窗口最多保留最近 20 轮 `rawTurns`。
- 每次追加新 turn 后，如果窗口候选超过 20 轮，就取最旧的 5 轮移出窗口。
- 被移出的 5 轮不删除，只把它们的核心进展合并进 `rollingSummary`。
- `sessionState.recentTurnIds` 始终只记录当前窗口内的 turn id。

初始摘要模板可先本地实现为确定性压缩：

```text
请结合现有的摘要，把这 5 条新对话中的核心进展、未完成的上下文、或者突发的新事件，合并更新进摘要中。请保持字数在 200 字以内。
```

未来接入小模型时，替换摘要生成函数即可，存储结构不变。

## 数据流

### 本地回答

```text
用户提交问题
  -> answerAgentQuestion(board, question, scopeId) 生成本地回答和 route
  -> appendAgentTurn(journal, turn) 先写入 rawTurns
  -> applySlidingWindow(journal) 更新 rollingSummary/sessionState
  -> buildAgentMemory(board) 派生任务信号和快照
  -> 前端展示回答
```

### OpenAI 增强回答

OpenAI 模式存在两个阶段：

1. 先生成本地回答，作为失败兜底。
2. OpenAI 成功后，以最终展示文本更新同一个 turn。

为避免“先展示但没落库”，提交问题时可以先创建 pending turn：

```text
用户提交问题
  -> 本地回答生成
  -> append pending/local turn
  -> 前端可显示本地回答
  -> OpenAI 成功
  -> update turn assistantText/source/model
  -> 重新应用 sessionState
  -> 前端替换为增强回答
```

如果 OpenAI 失败，已经落库的本地回答保留，并把 source 标为 `local-fallback`。

## 与现有代码的关系

### `src/agentMemory.js`

继续负责从 board 派生：

- `taskLineSummaries`
- `branchMemories`
- `diarySignals`
- `nodeSummaries`
- `userMemoryFacts`
- `userStateSnapshot`

本阶段不把 `agentMemory` 变成原始事实库。它仍是派生快照。

### `src/main.jsx`

Agent 提问流程需要从“只 setAgentAnswer + updateBoard(agentMemory)”升级为：

- 调 Electron IPC 追加 journal turn。
- 保存后再更新 `agentAnswer`。
- `agentMemory` 可以继续随 board 派生，但不再承担保存对话历史的职责。

### `electron/main.js` 与 `electron/preload.js`

新增 IPC：

- `agent:load-journal`
- `agent:append-turn`
- `agent:update-turn`

这些 IPC 只处理 Agent Journal，不修改 board。

## 错误处理

- Journal 读取失败时，尝试读取 backup。
- primary 和 backup 都失败时，返回空 journal，但不能清空 board。
- 写入失败时，前端提示“Agent 记录保存失败”，并保留当前回答。
- 如果摘要生成失败，保留 raw turn，跳过摘要更新，下一次追加时可重试。
- 如果 turn 结构异常，拒绝写入并返回错误，不做宽松吞错。

## 测试计划

### 存储测试

新增 `tests/agentJournalStorage.test.js`：

- 空文件时返回空 journal。
- primary 损坏时读取 backup。
- 写入使用 temp + backup，并保持 UTF-8。
- queued write 失败后后续写入仍可恢复。

### 滑窗测试

新增 `tests/agentJournal.test.js` 或放入 storage 测试：

- 追加 20 轮以内时，`recentTurnIds` 包含全部 turn。
- 追加第 21 轮时，最旧 5 轮移出 recent，但仍保留在 `rawTurns`。
- 被移出的 5 轮 id 进入 `rollingSummary.coveredTurnIds`。
- `rollingSummary.text` 长度限制在 200 字以内。

### 前端流程测试

现阶段可以先以纯函数覆盖：

- 本地回答 turn 必须包含 question、answer、scopeId、route、source。
- OpenAI 成功时更新同一 turn，而不是追加重复 turn。
- OpenAI 失败时保留本地 turn，source 为 `local-fallback`。

## 迁移策略

首次启动如果没有 `stepview-agent-journal.json`：

- 创建空 journal。
- 不从 board 反推历史对话。
- 不生成任何 demo/sample turn。

已有 `board.agentMemory` 暂时保留兼容。后续可在独立阶段决定是否只在运行态使用，不再写回 board。

## 验收标准

- 用户提问后，原始对话轮次能在 Agent Journal 中持久化。
- 最近窗口始终最多 20 轮。
- 超窗旧 turn 不删除，只进入滚动摘要。
- board 存储文件没有新增对话历史数组。
- 现有 board、任务线、支线、成就测试继续通过。
- 所有新增存储和摘要逻辑都有测试覆盖。

## 设计自检

- 没有引入 demo/sample/tutorial 覆盖逻辑。
- 原始数据和派生摘要分离。
- board 仍是画布事实源，Agent Journal 是对话事实源。
- 摘要失败不会导致原文丢失。
- 后续接入 SQLite、Redis、Mem0 时，可以替换存储实现而不改变前端语义。
