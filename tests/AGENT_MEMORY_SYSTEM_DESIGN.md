# StepView 智能任务线 Agent 与记忆系统设计

## 产品定位

StepView 的智能 Agent 不是泛用聊天助手，而是围绕用户任务线、节点、分支、成就和日记运行的认知型陪伴系统。它的核心能力是理解用户正在推进什么、卡在哪个节点、面对哪些分支选择，以及这些长期行为背后形成了怎样的偏好、动机和压力模式。

系统目标：

- 让用户可以按全局、任务线、分支、节点等范围向 Agent 提问。
- 让 Agent 基于真实任务结构回答，而不是脱离上下文泛泛建议。
- 将节点日记转化为低消耗、可追溯、可增量更新的用户认知。
- 在 CPU 环境下保持轻量运行，默认只读取最小必要上下文。
- 将深度心理需求分析、行业调研作为按需增强能力，而不是默认链路。

## 核心体验

用户可以这样提问：

- "看看我副业这条线现在应该怎么推进。"
- "内容号这个分支还值得继续吗？"
- "我最近是不是一直卡在同一个问题上？"
- "结合最近几篇节点日记，帮我总结一下我真实的顾虑。"
- "帮我做一次深度分析，但只看职业发展这条线。"

Agent 回答时必须明确使用的上下文范围，例如：

- 当前任务线
- 当前节点
- 当前分支
- 最近日记摘要
- 相关成就
- 用户长期认知事实

这样用户会感到系统是在陪他走自己的任务结构，而不是临时给一段通用建议。

## 数据分层

### 1. 原始事件层

原始层保存事实，不直接做判断。

```ts
type UserEvent = {
  id: string
  userId: string
  taskLineId?: string
  nodeId?: string
  branchId?: string
  type: "message" | "task_update" | "diary" | "achievement" | "decision" | "reflection"
  content: string
  createdAt: string
}
```

节点日记也应作为事件写入，避免只存在于节点正文中而无法被检索、摘要和追溯。

```ts
type DiaryEntry = {
  id: string
  userId: string
  taskLineId?: string
  nodeId?: string
  branchId?: string
  content: string
  createdAt: string
}
```

### 2. 结构层

任务线使用图结构表达，不建议只使用列表。

```ts
type TaskLine = {
  id: string
  userId: string
  title: string
  description?: string
  status: "active" | "paused" | "completed" | "archived"
  priority?: number
  currentNodeId?: string
  createdAt: string
  updatedAt: string
}

type TaskNode = {
  id: string
  taskLineId: string
  parentId?: string
  title: string
  type: "goal" | "step" | "decision" | "checkpoint" | "achievement"
  status: "todo" | "doing" | "done" | "blocked" | "skipped"
  summary?: string
  evidenceIds: string[]
  createdAt: string
  updatedAt: string
}

type TaskBranch = {
  id: string
  taskLineId: string
  fromNodeId: string
  title: string
  hypothesis?: string
  pros: string[]
  cons: string[]
  status: "open" | "selected" | "rejected" | "merged"
  confidence?: number
  createdAt: string
  updatedAt: string
}
```

分支必须是 Agent 可读的决策路径，而不是普通标签。用户问到分支时，Agent 要能说明它在任务线中的位置、前置条件、风险、收益和低成本验证方式。

### 3. 信号层

信号层负责从原始事件和日记中提取轻量结构化信息。

```ts
type DiarySignal = {
  id: string
  diaryEntryId: string
  emotion: "positive" | "neutral" | "negative" | "anxious" | "hesitant" | "energized"
  topics: string[]
  blockers: string[]
  decisions: string[]
  goals: string[]
  confidence: number
  createdAt: string
}
```

写入日记时，前台只做轻处理：

- 情绪粗分类
- 主题标签
- 卡点提取
- 决策变化
- 新目标提取
- 是否值得进入长期记忆的初步判断

不要在前台链路做长推理、全库扫描或长报告生成。

### 4. 摘要层

摘要层是 CPU 友好的核心。系统回答时优先读取摘要，而不是读取大量原文。

```ts
type NodeSummary = {
  nodeId: string
  summary: string
  keySignals: string[]
  latestDiaryEntryIds: string[]
  updatedAt: string
}

type TaskLineSummary = {
  taskLineId: string
  progressSummary: string
  currentFocus?: string
  currentBlocks: string[]
  recentDecisions: string[]
  recentAchievements: string[]
  updatedAt: string
}

type BranchMemory = {
  branchId: string
  summary: string
  userAttitude: "interested" | "hesitant" | "resistant" | "committed"
  requiredConditions: string[]
  risks: string[]
  nextActions: string[]
  evidenceIds: string[]
  updatedAt: string
}
```

摘要更新采用局部刷新：

- 日记变化只刷新对应节点摘要。
- 节点摘要变化再影响任务线摘要。
- 任务线摘要变化只有在满足条件时才影响用户画像。
- 分支相关日记只更新对应分支记忆和所属任务线摘要。

### 5. 认知层

认知层保存长期、稳定、可追溯的用户认识。

```ts
type UserMemoryFact = {
  id: string
  userId: string
  type: "motivation" | "preference" | "working_style" | "risk_pattern" | "emotion_pattern" | "pressure_source"
  statement: string
  confidence: number
  evidenceIds: string[]
  updatedAt: string
}
```

认知事实必须带证据和置信度。系统不应把单篇日记中的短期情绪直接升级为长期人格判断。

### 6. 全局快照层

快照层用于实时回答。

```ts
type UserStateSnapshot = {
  userId: string
  activeTaskLineIds: string[]
  currentFocusTaskLineId?: string
  recentAchievementIds: string[]
  recentBlockers: string[]
  emotionalTone?: string
  suggestedNextStep?: string
  updatedAt: string
}
```

绝大多数普通问题只需要读取快照、当前任务线摘要、当前节点摘要和少量证据。

## 查询路由

用户提问时先进入轻量路由器。

```text
用户问题
  -> 识别询问范围
  -> 解析任务线 / 分支 / 节点
  -> 读取最小上下文
  -> 必要时补充检索证据
  -> 生成回答
  -> 异步更新记忆
```

推荐的范围类型：

```ts
type QueryScope =
  | { type: "global" }
  | { type: "task_line"; taskLineId: string }
  | { type: "branch"; taskLineId: string; branchId: string }
  | { type: "node"; taskLineId: string; nodeId: string }
  | { type: "diary"; diaryEntryIds: string[] }
  | { type: "deep_analysis"; baseScope: Exclude<QueryScope, { type: "deep_analysis" }> }
```

匹配顺序：

1. 用户显式选择的任务线或分支。
2. 问题文本中的任务线名、分支名、节点名和别名。
3. 最近活跃任务线。
4. 当前焦点任务线。
5. 多候选时让用户选择。

当存在多个候选时，Agent 应该短问确认，例如：

"你是想看「副业 > 内容号」这个分支，还是「个人品牌 > 内容输出」这个分支？"

## 分支回答模型

当用户询问某个分支时，Agent 应按固定结构理解：

1. 这个分支属于哪条任务线。
2. 它从哪个节点分出。
3. 它解决什么问题。
4. 用户目前具备哪些条件。
5. 用户缺少哪些条件。
6. 继续推进的风险是什么。
7. 不推进的代价是什么。
8. 下一步是否可以做低成本验证。

回答应自然，但底层要有结构。

示例：

"如果你问的是副业线里的内容号分支，我会把它看成一个低成本验证分支，而不是现在就 All in 的主线。最近节点日记里反复出现的是持续输出压力，所以当前关键不是判断它是否值得，而是先验证你能否用 7 天完成一个最小输出循环。"

## 日记处理流水线

### 写入流程

```text
保存 DiaryEntry
  -> 写入 UserEvent
  -> 抽取 DiarySignal
  -> 更新 NodeSummary
  -> 触发 TaskLineSummary 异步刷新
  -> 必要时生成 UserMemoryFact 候选
```

### 进入长期认知的条件

日记信号不应每次都进入用户画像。建议满足以下条件之一：

- 同类信号在不同日期重复出现。
- 同类信号跨多个任务线出现。
- 信号与重大决策、放弃、恢复、成就直接相关。
- 用户明确确认某个判断准确。
- 系统置信度达到阈值，例如 0.75。

### 摘要压缩策略

节点级摘要保留 3 到 5 条：

- 这一步发生了什么。
- 用户真实感受是什么。
- 当前阻塞是什么。
- 是否出现新目标或新决策。
- 下一步最小动作是什么。

任务线级摘要关注：

- 当前进展。
- 最近卡点。
- 最近成就。
- 决策倾向。
- 情绪趋势。

全局认知只保留跨周期稳定模式。

## CPU 轻量化策略

### 前台链路

前台只做必要工作：

- 保存原文。
- 轻量信号提取。
- 读取快照。
- 读取当前范围摘要。
- 生成短回答。

### 后台链路

后台异步处理：

- 长摘要合并。
- 用户画像更新。
- 重复记忆去重。
- 过期摘要压缩。
- 深度分析报告。

### 热冷分层

热数据：

- 当前任务线。
- 当前节点。
- 当前分支。
- 最近日记摘要。
- 最近成就。
- 全局状态快照。

冷数据：

- 历史任务线。
- 旧日记原文。
- 已归档分支。
- 长周期报告。

回答默认只读热数据。只有用户明确要求回顾历史、深度分析或跨线比较时，才读取冷数据。

### 预算建议

- 普通陪伴回答：只读取 1 个快照、1 个任务线摘要、1 个节点摘要、最多 5 条信号。
- 分支分析：读取分支记忆、所属任务线摘要、最多 10 条相关证据。
- 全局总结：读取全局快照、活跃任务线摘要、少量用户认知事实。
- 深度分析：允许读取更多历史，但必须由用户主动触发。

## 产品交互建议

聊天输入框上方可以提供范围选择：

```text
询问范围: 全局 | 职业发展 | 副业 | 健康 | 学习
```

如果用户选中某条任务线，后续问题默认绑定该任务线。

任务线内可以提供分支切换：

```text
当前分支: 主线 | 内容号 | 产品化 | 转型
```

日记保存后给用户一个轻反馈：

```text
已保存。
我提炼了 1 条节点摘要，并更新了这条任务线的当前卡点。
这次暂时没有扩大到长期用户画像。
```

这种反馈能让用户明确知道系统正在理解，而不是只做存储。

## 深度分析与行业调研

深度心理需求分析和行业调研应作为增强模式。

默认模式：

- 陪伴式回答。
- 任务线推进建议。
- 节点和分支解释。
- 轻量记忆调用。

增强模式：

- 深度心理需求分析。
- 行业调研。
- 长周期成长报告。
- 跨任务线模式归纳。

心理需求分析只做动机、压力、行为模式和需求推测，不做医学诊断。行业调研如果需要外部信息，应独立标记来源，避免污染用户记忆库。

## 推荐落地顺序

### 第一阶段

- 建立 TaskLine、TaskNode、TaskBranch。
- 建立 DiaryEntry 和 UserEvent。
- 实现 NodeSummary、TaskLineSummary。
- 实现 QueryRouter。
- 支持用户按任务线提问。

### 第二阶段

- 实现 BranchMemory。
- 实现 UserStateSnapshot。
- 实现日记信号抽取。
- 实现局部摘要刷新。
- 支持按分支提问。

### 第三阶段

- 实现 UserMemoryFact。
- 实现长期认知更新策略。
- 实现热冷数据分层。
- 实现重复记忆合并和置信度更新。

### 第四阶段

- 实现深度心理需求分析。
- 实现行业调研模式。
- 实现长周期成长报告。
- 实现用户可查看、修正和删除的记忆管理界面。

## 关键边界

- 不使用 demo、sample 或 tutorial 逻辑覆盖用户真实任务数据。
- 所有导入、演示和测试数据必须非破坏性执行。
- 原始日记必须保留，摘要只作为派生数据。
- 用户认知必须可追溯、可撤销、可修改。
- 默认回答必须绑定任务结构，避免泛泛建议。
- 深度分析必须由用户主动触发或明确授权。
