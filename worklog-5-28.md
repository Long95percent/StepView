# 2026-05-28 工作日志

## 本次目标

按照 `tests/AGENT_MEMORY_SYSTEM_DESIGN.md` 的方向，开始接入 StepView 的 AI Agent 能力。当前实现选择先落地 CPU 友好的本地智能 Agent 内核，不直接接入重型在线模型，先保证任务线、支线、节点日记和归档信息可以被结构化理解、轻量摘要和按范围问答。

## 新增文件

- `src/agentMemory.js`
  - 新增 Agent 记忆内核。
  - 实现任务线摘要、支线记忆、节点日记信号、用户认知事实、全局状态快照。
  - 实现询问范围选项生成。
  - 实现轻量查询路由：全局、任务线、支线。
  - 实现本地问答生成：不依赖网络、不调用外部模型，优先服务 CPU 环境下的低消耗体验。

- `tests/agentMemory.test.js`
  - 新增 Agent 记忆单元测试。
  - 覆盖任务线摘要、支线记忆、节点日记信号和范围选项。
  - 覆盖任务完成后支线进入归档快照，Agent 仍能从归档支线里回答问题。

- `worklog-5-28.md`
  - 新增本工作日志文件。

- `docs/StepView智能Agent产品设计文档.md`
  - 新增完整产品文档。
  - 覆盖需求分析、面向人群、人文关怀、关键亮点、Agent 记忆工程、OpenAI 接入、STAR 法则和后续路线。

## 修改文件

- `src/main.jsx`
  - 新增 `agentMemory` 模块导入。
  - 新增左侧栏 Agent 面板。
  - 支持选择询问范围：
    - 全局
    - 指定任务线
    - 指定支线
  - 支持输入问题并生成本地 Agent 回答。
  - 在 `updateBoard` 统一数据更新链路中自动重建 `agentMemory`，避免只有部分操作触发记忆刷新。
  - 保存 board 时同步保存最新 Agent 记忆结果。

- `src/progressCore.js`
  - `normalizeBoard` 新增 `agentMemory` 字段。
  - 保持旧数据兼容：没有 `agentMemory` 时默认 `null`。
  - 继续保留之前完成任务时归档支线的修复逻辑。

- `src/styles.css`
  - 新增 Agent 面板样式。
  - 新增问题输入、范围选择、回答展示的样式。
  - 控制面板尺寸，避免影响现有侧边栏和画布工作流。

- `electron/boardStorage.js`
  - 存储层 `EMPTY_BOARD` 新增 `branches` 和 `agentMemory`。
  - `normalizeBoard` 新增 `branches` 和 `agentMemory` 字段保存。
  - 修复桌面端存储以前可能丢失 `branches` 的风险。

## 删除内容

- 本次没有删除任何源码文件。
- 没有删除现有功能。
- 没有加入会覆盖用户真实画布数据的 demo、sample、tutorial 逻辑。

## 已实现功能

### 1. Agent 记忆库第一版

当前记忆库包含：

- `taskLineSummaries`
  - 每条任务线的状态、主线节点数量、支线数量、计划节点数量、当前焦点、近期卡点、最近节点记录。

- `branchMemories`
  - 每条支线所属任务线、类型、名称、伙伴名、状态、摘要、下一步建议、风险提示和证据节点。

- `diarySignals`
  - 从节点详情中提取轻量日记信号。
  - 包含情绪粗分类、主题、卡点、决策和目标。

- `userMemoryFacts`
  - 从重复信号中生成轻量用户认知事实。
  - 目前是规则型，不做深度心理判断。

- `userStateSnapshot`
  - 当前活跃任务线、最近完成任务线、最近卡点、情绪倾向和建议下一步。

### 2. 查询范围选择

左侧 Agent 面板支持选择：

- 全局
- 某条任务线
- 某条支线

如果用户在问题里直接提到任务线或支线名称，底层路由也会尝试自动匹配。

### 3. 支线归档可读

结合前一个 bug 修复，完成任务后：

- 活跃画布上支线会消失。
- 支线被放入任务自己的 `archivedBranches`。
- Agent 仍可以从归档支线中读取支线节点和记录。
- 归档后的任务旅程页也可以展示支线内容。

### 4. CPU 轻量化

当前没有接入在线大模型，也没有做全量长文本推理。

本地链路只做：

- 结构化遍历 board。
- 轻量规则提取。
- 小摘要拼接。
- 范围路由。
- 模板化回答。

这符合第一阶段目标：先把产品结构和记忆链路跑通，再考虑深度模型能力。

## 当前进度

整体 AI Agent 接入进度：约 50%。

已完成：

- 本地记忆库结构：60%
- 任务线摘要：50%
- 支线记忆：55%
- 节点日记信号：40%
- 查询路由：35%
- 前端 Agent 面板：35%
- 持久化接入：45%
- 深度心理需求分析：0%
- 行业调研：0%
- 真实 LLM/API 接入：35%

## 继续推进记录

### OpenAI 增强模式

新增了 OpenAI API 接入骨架：

- `electron/main.js`
  - 新增 `ai:ask-openai` IPC handler。
  - 使用 OpenAI Responses API 发起请求。
  - 默认模型为 `gpt-5.1`，前端可修改。
  - 请求内容只发送压缩后的 Agent 记忆、用户问题、本地回答草稿和路由结果，不发送完整画布原始数据。
  - API Key 由前端当前会话传入，不写入 board 文件。
  - OpenAI 请求失败时返回错误，由前端回退到本地回答。

- `electron/preload.js`
  - 新增 `askOpenAI(request)` 桥接方法。

- `src/main.jsx`
  - Agent 面板新增“本地 / OpenAI”模式切换。
  - OpenAI 模式下可输入 API Key 和模型名。
  - 提问时先生成本地回答和本地记忆，再按需请求 OpenAI 增强回答。
  - 如果没有 API Key、没有桌面桥接或 OpenAI 请求失败，会保留本地回答并显示失败原因。

- `src/styles.css`
  - 新增 Agent 模式切换、Provider 配置区域和 API Key 输入样式。

### 设置页面

新增 Settings 页面：

- `src/main.jsx`
  - 左侧快速创建区域新增 `Settings` 按钮。
  - 新增设置弹窗，支持用户自己填写 OpenAI API Key。
  - 支持设置默认 Agent 模式：本地 / OpenAI。
  - 支持设置默认 OpenAI 模型名。
  - 支持设置 OpenAI-compatible Base URL，方便接第三方平台。
  - 设置保存在 `localStorage` 的 `stepview-settings-v1`，不写入 board 数据。
  - Agent 面板不再直接暴露 API Key 输入框，只显示是否已配置，并提供打开设置入口。

- `src/styles.css`
  - 为设置弹窗补充 `select` 和 `settingsModal` 样式。
  - 为右侧 Agent 抽屉补充展开、收起和把手样式。

安全说明：

- API Key 不保存到 `stepview-board.json`。
- API Key 当前保存在本机浏览器/Electron 渲染环境的 localStorage，属于本机设置，不随 board 结构同步。
- 后续如果要更安全，可以改为 Electron 主进程加密存储或系统凭据管理。

### 右侧 Agent 抽屉

- Agent 从左侧栏迁移到右侧抽屉。
- 默认只露出一个可点击把手，不遮挡画布。
- 点击图标后平滑展开完整 Agent 面板。
- 询问范围选择和回答展示都保留，但从主布局中解耦。

### Base URL 支持

- `electron/main.js`
  - OpenAI 请求现在支持自定义 `baseUrl`。
  - 默认值为 `https://api.openai.com/v1`。
  - 使用 `/chat/completions` 兼容接口，方便接入第三方 OpenAI-compatible 平台。
- `src/main.jsx`
  - 设置页新增 Base URL 输入框。
  - OpenAI 模式请求时会把 Base URL 一并传给主进程。

### 数据安全和轻量化约束

- API Key 不保存到 `stepview-board.json`。
- 不把完整 board 直接发给 OpenAI。
- 发送给 OpenAI 的数据来自 `agentMemory`：
  - `userStateSnapshot`
  - `taskLineSummaries`
  - `branchMemories`
  - 最近 12 条 `diarySignals`
  - `userMemoryFacts`
- 默认仍然是本地模式，OpenAI 只作为用户主动选择的增强模式。

## 尚未完成

- 已接入 OpenAI Responses API 的桌面端调用骨架，但还没有做流式回答。
- 没有做用户可编辑的记忆管理界面。
- 没有做深度心理需求分析模式。
- 没有做行业调研模式。
- 没有做日记的异步后台压缩任务。
- 没有做复杂向量检索或语义检索。

## 风险与注意事项

- 当前 Agent 默认回答是规则型本地回答，优点是轻、快、离线可用；缺点是表达和推理深度有限。
- OpenAI 增强模式依赖用户提供 API Key 和网络环境。
- OpenAI 模型名目前允许手动输入，后续应增加模型配置校验和更友好的设置入口。
- 节点日记目前复用节点 `detail` 字段，没有单独拆出 `DiaryEntry` 表。
- `agentMemory` 当前随 board 一起保存，后续如果记忆量变大，需要考虑冷热分层和压缩。
- 后续接入真实 AI API 时，必须继续保持默认轻量，本地摘要优先，深度分析按需触发。

## 下一步建议

1. 将节点详情正式拆成“节点说明”和“节点日记”两类输入。
2. 给 Agent 面板增加“全局 / 任务线 / 支线 / 深度分析”模式切换。
3. 增加用户可查看、修正、删除的记忆面板。
4. 接入可配置 AI Provider，但默认仍用本地轻量 Agent。
5. 为深度分析和行业调研设计明确触发按钮，避免日常陪伴链路变重。
