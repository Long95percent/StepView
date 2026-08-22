# StepView 用户级 Agent、专业记忆仓库与可插拔工具层架构计划

> 状态：架构与实施计划，仅描述方案，不直接实现功能。

## 目标

在现有 Gateway 和 Agent 基础上，建立三条长期稳定的能力边界：

1. **用户级 Agent 隔离**：每个用户拥有独立的 Agent 身份、会话、行为状态、提示词配置和 Agent 工作空间。
2. **专业记忆仓库**：记忆可以被抽取、分类、验证、合并、衰减、召回、审计和用户管理，并支持结构化检索、全文检索、向量检索和 RAG 重排。
3. **可插拔 Agent 工具层**：Agent 只能通过受权限控制的工具接口访问 Board、记忆、文件和未来外部服务，工具可以独立注册、替换、禁用和扩展。

整体原则是：先保证数据主权和可解释性，再逐步增加自动学习和自主能力。模型的输出永远不是最终事实，写入用户记忆或修改用户 Board 都必须经过明确的策略和权限控制。

## 网络暴露与 Gateway 安全边界

Gateway 的网络策略必须由主进程强制执行，不能只依赖前端配置。应用区分“无网络服务的个人桌面模式”和“仅局域网服务的家庭模式”：

### Personal 模式

- 默认不启动家庭共享 HTTP 服务。
- 开发服务器和本地 Gateway 只绑定 `127.0.0.1` 或 `::1`，禁止默认使用 `0.0.0.0`。
- 个人模式的端口只允许本机访问，不加入局域网发现，不启用 UPnP/端口映射。
- Electron IPC 继续作为桌面应用的主要通信通道；Vite 的 `--host 0.0.0.0` 只能保留给明确的开发调试配置，不能成为默认启动路径。
- 启动时检查实际监听地址；如果个人模式发现绑定到非回环地址，应拒绝启动并给出错误。

### Family 模式

- 只有明确配置并完成账号初始化后才启动局域网 Gateway。
- 监听地址优先选择当前局域网网卡的具体 IP，不直接绑定所有网卡；不监听公网/蜂窝网络接口。
- 只接受当前局域网子网的连接，并在应用层继续要求账号认证和有效会话；“同一路由器”不能仅靠来源 IP 视为可信。
- 关闭 UPnP、自动端口映射和公网中继；不提供外网穿透。
- 家庭模式的每个请求必须经过 TLS/会话策略、账号作用域、速率限制和审计；局域网访问也不能绕过认证。
- 配置变化、网卡变化或网络范围不明确时，默认停止共享服务，而不是扩大到 `0.0.0.0`。

建议配置：

```env
# personal: loopback only; family: approved LAN interface only
STEPVIEW_BIND_MODE=loopback
STEPVIEW_BIND_HOST=127.0.0.1
STEPVIEW_GATEWAY_PORT=5174
STEPVIEW_ALLOW_LAN=false
STEPVIEW_ENABLE_UPNP=false
```

家庭模式启动时由主进程计算允许的局域网 CIDR，并把绑定地址、允许网段和端口显示给用户。Gateway 需要同时执行网络层 allowlist、账号认证、CSRF/origin 校验、请求体限制、速率限制和敏感操作二次确认；任何一层失败都拒绝请求。

安全底线：个人模式不对外暴露；家庭模式只提供同一局域网内的最小服务面，且“同一路由器”只代表网络范围，不代表用户可信。

## 现有基础与主要缺口

现有实现可以复用：

- [src/agentMemory.js](../../../src/agentMemory.js)：从当前 Board 派生任务线、支线、日记信号和用户状态。
- [electron/agentSqliteStore.js](../../../electron/agentSqliteStore.js)：保存 Agent session、turn、窗口、signal、prompt snapshot 和 Mem0 同步日志。
- [electron/agentService.js](../../../electron/agentService.js)：负责任务线 Agent 的上下文窗口和模型提示构建。
- [electron/agentMem0Client.js](../../../electron/agentMem0Client.js)：已有外部记忆服务适配器。
- Gateway 计划：负责模式、账号和账号级 `dataDir` 隔离。

当前缺口：

- Agent 数据按任务线组织，还没有明确的用户级根域。
- `agentMemory` 主要是 Board 派生快照，不是可治理的长期记忆仓库。
- Mem0 是单一外部召回入口，缺少本地结构化事实、证据链、版本和删除语义。
- Prompt builder 直接消费召回结果，没有独立的检索编排和质量控制层。
- Agent 没有统一工具协议、权限、审批、超时、审计和结果验证机制。
- 用户偏好、事实、事件、推断、项目知识和敏感信息没有明确的分类边界。

## 总体架构

```text
Renderer
  -> preload IPC
    -> Gateway / Account Context
       -> User Agent Runtime
          -> Context Orchestrator
             -> Memory Retrieval
                -> Local Memory Store
                -> Full-text Index
                -> Vector Index
                -> Optional Mem0 Adapter
                -> Reranker / Diversity Filter
             -> Tool Runtime
                -> Tool Registry
                -> Policy / Permission
                -> Approval Gate
                -> Tool Executor
             -> Model Provider
          -> Memory Write Pipeline
          -> Agent Audit / Evaluation
       -> Board Storage
       -> User Agent Storage
       -> Shared Gateway Account Store
```

关键边界：

- **Gateway** 决定当前用户和可访问的数据域。
- **User Agent Runtime** 只服务当前用户，不能跨账号读取记忆或工具数据。
- **Memory Repository** 负责记忆生命周期，不把记忆逻辑塞进 `agentService`。
- **Context Orchestrator** 负责“这次回答召回什么、为什么召回、如何压缩”。
- **Tool Runtime** 负责工具发现、权限、执行和审计，不由模型直接执行任意函数。
- **Board** 仍然是用户画布的事实来源；Agent 只能通过提案和确认修改 Board。

## 数据隔离模型

### 用户级数据域

每个账号拥有独立的用户域：

```text
userData/
  gateway.sqlite
  accounts/<account-id>/
    stepview-board.json
    stepview-board.backup.json
    stepview-agent.sqlite
    agent-memory.sqlite
    user-profile.sqlite
    knowledge-bases/
      astrology/
        knowledge.sqlite
        index/
        manifest.json
      career-planning/
        knowledge.sqlite
        index/
        manifest.json
    agent-memory-index/
    agent-files/
```

建议将 `agent-memory.sqlite` 与 `stepview-agent.sqlite` 分开：

- `stepview-agent.sqlite`：会话、turn、窗口、prompt snapshot、运行日志。
- `agent-memory.sqlite`：长期记忆、分类、证据、版本、状态、反馈、索引元数据。
- `user-profile.sqlite`：用户画像、职业经历、偏好演化和用户授权，不保存领域知识正文。
- `knowledge-bases/<id>/knowledge.sqlite`：可插拔的领域知识库，和用户个人记忆分离。

这样会话日志可以高频写入，记忆仓库可以单独迁移、重建索引和备份。

### 命名空间

所有本地和外部资源都必须显式带作用域：

```text
accountId
  -> agentId
    -> workspaceId
      -> sessionId / memoryId / toolRunId
```

最小作用域规则：

- 用户级记忆：`accountId + agentId`。
- 任务线记忆：`accountId + agentId + taskLineId`。
- 会话记忆：`accountId + agentId + sessionId`。
- Agent 自己的工作记忆：单独 `agentWorkspaceId`，不能自动写入用户长期记忆。

Redis、Mem0、向量库、工具审计日志都必须保留 `accountId`，并由主进程注入，不能信任模型或 Renderer 传入的值。

## 用户积累与知识积累分离

采用两套独立体系：

```text
User Profile Store
  - 用户偏好、经历、能力、目标、约束
  - 用户明确授权和敏感信息策略
  - 用户反馈、确认、修改和删除

Knowledge Base Store
  - 领域概念、规则、方法、案例和来源
  - 文档版本、引用、抓取时间和可信度
  - 分块、关键词索引、向量索引和知识关系
```

Agent 回答时通过 `Context Orchestrator` 组合两者，但写入、导出、删除和权限独立处理。知识库内容不能反向变成用户事实；用户资料也不能污染公共领域知识库。

建议新增：

```text
user-profile.sqlite
knowledge-bases/<knowledge-base-id>/knowledge.sqlite
```

`user-profile.sqlite` 负责用户积累；`agent-memory.sqlite` 负责可追溯的对话记忆；领域库负责专业知识。三者都按 `accountId` 隔离。

## 领域知识库与专业工作区

星盘/出生信息、职业规划等内容以独立领域工作区实现，而不是混入通用偏好表：

```text
domain workspace
  -> domain schema
  -> domain knowledge base
  -> domain tools
  -> domain prompts
  -> domain retrieval policy
  -> user data consent policy
```

### Astrology 工作区

- 用户出生时间、地点、时区等作为敏感用户资料保存，默认不进入通用记忆召回。
- 星盘计算使用确定性结构化算法和明确的历法/天文数据源；LLM 只负责解释和对话表达。
- 计算结果保存算法版本、输入参数版本和生成时间，保证可复现。
- 解释必须标注为娱乐性、文化性或自我反思内容，不作为医学、法律、财务或人生确定性结论。
- Web Search 获取的占星知识必须保存来源、作者、URL、发布时间、抓取时间和引用片段。

### Career Planning 工作区

- 用户经历、技能、兴趣、约束和目标进入用户画像域。
- 行业知识、岗位能力模型、学习路径和市场资料进入职业知识库。
- 规划结论必须区分用户事实、外部知识和 Agent 推断，并保留证据。
- 外部岗位或行业信息需要时间有效期，过期后降低召回权重或重新搜索。
- 任何职业建议都应作为候选方案，不自动修改用户目标或 Board。

## 可拔插知识库架构

知识库通过统一接口接入，支持从模板复制创建：

```js
const knowledgeBase = createKnowledgeBase({
  templateId: "astrology",
  accountId,
  baseDir,
});

await knowledgeBase.initialize();
await knowledgeBase.ingest(document);
await knowledgeBase.search(query, options);
await knowledgeBase.getDocument(documentId);
await knowledgeBase.rebuildIndex();
await knowledgeBase.export();
await knowledgeBase.close();
```

模板 manifest 至少定义：

```json
{
  "id": "astrology",
  "version": "1.0.0",
  "categories": ["concept", "method", "interpretation", "source"],
  "schemaVersion": 1,
  "retrievalPolicy": "hybrid",
  "sensitiveFields": ["birthTime", "birthPlace"],
  "tools": ["astrology.calculate_chart"]
}
```

复制模板时创建新的 `knowledgeBaseId` 和独立目录，不复制其他账号数据，也不默认共享用户记忆。模板升级必须通过迁移版本处理，不能覆盖用户已经积累的知识。

建议内置模板：

- `general-knowledge`：通用知识和资料。
- `astrology`：星盘、历法、占星术语和解释体系。
- `career-planning`：职业能力、行业、岗位和规划方法。

后续可以由用户复制模板创建个人知识库，例如：

```text
knowledge-bases/my-product-management/
knowledge-bases/my-astrology-notes/
```

## Web Search 到知识库的管线

Web Search 不是直接写库，而是进入可审计的知识摄取流程：

```text
Web Search
  -> source capture
  -> content extraction
  -> deduplication
  -> source / freshness / quality checks
  -> chunking and metadata
  -> optional LLM classification and summary
  -> user or policy approval
  -> knowledge document
  -> keyword / vector index
```

必须保存：

- 原始 URL、标题、作者、发布时间和抓取时间。
- 内容摘要、引用片段和 hash。
- 来源可信度、时效性、版权/使用限制标记。
- 抽取模型、提示词版本和知识库 schema 版本。
- 文档之间的引用、修订、冲突和替代关系。

LLM 可以辅助分类、分块和摘要，但不能伪造来源；没有可验证来源的内容只能标记为推测，不能进入高可信专业知识层。

## Agent 身份模型

### User Agent 与 Task Agent

建议区分两类 Agent：

```text
User Agent
  - 用户级长期身份
  - 用户偏好和跨任务记忆
  - 全局对话入口
  - 可访问范围由账号权限决定

Task Agent
  - 用户 Agent 的任务线工作实例
  - 任务线角色、目标和局部上下文
  - 默认只能读取相关任务线记忆和被授权的用户偏好
  - 不拥有独立的用户身份
```

第一版可以继续沿用 `task:<taskLineId>` session ID，但在数据模型中增加 `accountId`、`agentId`、`workspaceId`，避免以后将 session ID 误当成用户身份。

Agent profile 建议包含：

```text
agent_profiles
  agent_id
  account_id
  name
  persona_config_json
  model_policy_json
  memory_policy_json
  tool_policy_json
  status
  created_at
  updated_at
```

## 记忆仓库设计

### 记忆不是一张向量表

专业记忆系统至少需要同时保存：

- 原始证据：用户原话、Board 节点、对话 turn、工具结果。
- 记忆主张：系统认为“用户偏好短回答”。
- 记忆类型和作用域。
- 置信度、稳定性、重要性、敏感等级。
- 创建、更新时间、最后召回时间、过期时间。
- 支持和反驳证据。
- 来源 Agent、来源模型和抽取版本。
- 用户确认、修改、删除和反馈历史。
- embedding 和索引状态。

### 核心表

在 `agent-memory.sqlite` 中建议设计：

```text
memory_items
  id
  account_id
  agent_id
  workspace_id
  scope_type              -- user | task | branch | session | agent
  scope_id
  category                -- preference | profile | semantic | episodic | procedural | relationship | goal | constraint | reflection
  subcategory
  subject_key
  statement
  normalized_value_json
  source_type              -- explicit | conversation | board | tool | model_inference | import
  source_ref
  evidence_summary
  confidence
  importance
  stability
  sensitivity
  status                   -- candidate | active | disputed | superseded | expired | deleted
  valid_from
  valid_until
  last_confirmed_at
  last_recalled_at
  created_at
  updated_at
  extraction_version

memory_evidence
  id
  memory_id
  account_id
  source_type
  source_ref
  quote_or_payload
  polarity                -- support | contradict | context
  confidence
  created_at

memory_relations
  id
  account_id
  from_memory_id
  to_memory_id
  relation_type           -- supports | contradicts | refines | supersedes | derived_from
  confidence
  created_at

memory_feedback
  id
  account_id
  memory_id
  action                  -- confirm | edit | reject | delete | snooze | useful | not_useful
  previous_value_json
  next_value_json
  reason
  created_at

memory_embeddings
  memory_id
  account_id
  embedding_provider
  embedding_model
  vector_ref
  content_hash
  index_version
  status
  created_at
```

### 记忆分类

分类不是只给 UI 展示，而是要影响写入策略、召回范围和过期策略：

| 分类 | 示例 | 默认写入策略 | 默认召回策略 |
|---|---|---|---|
| `preference` | 喜欢短回答、偏好晚上处理复杂任务 | 高门槛，重复证据或用户明确表达 | 全局高优先级 |
| `profile` | 正在学习某技术、所在时区 | 需要稳定证据 | 相关任务和全局 |
| `semantic` | 用户掌握某概念、项目知识 | 证据驱动 | 语义相关 |
| `episodic` | 某天完成了一个节点 | 保留原始事件和时间 | 时间/任务相关 |
| `procedural` | 用户习惯如何规划任务 | 多次行为归纳 | 规划类请求 |
| `relationship` | 某条关系支线的上下文 | 默认局部作用域 | 对应人物或支线 |
| `goal` | 当前阶段想达成的目标 | 用户确认或 Board 来源 | 当前目标相关 |
| `constraint` | 时间、资源、健康边界 | 高优先级且需谨慎 | 相关行动前 |
| `reflection` | Agent 对模式的推测 | 默认 candidate，不直接当事实 | 低权重，需标注推断 |

敏感信息应有单独 `sensitivity` 等级和更严格的默认策略。未经用户确认，不应把心理推断、健康推断或关系推断写成稳定用户事实。

## 记忆生命周期

```text
Evidence
  -> Candidate Extraction
    -> Normalize / Deduplicate
      -> Conflict Check
        -> Candidate Memory
          -> User Confirmed or Repeated Evidence
            -> Active Memory
              -> Recall / Feedback
                -> Refresh, Supersede, Expire, Delete
```

### 写入规则

1. 从用户明确表达中提取的偏好可以进入 `candidate`，但高影响偏好最好要求用户确认。
2. 从一次对话推断出的偏好、人格和心理结论不能直接成为 `active`。
3. 多次独立证据支持同一主张时，可以提升置信度，但必须保留证据链。
4. 新证据冲突时创建新版本或 `disputed` 状态，不静默覆盖旧记忆。
5. 用户删除记忆是硬删除语义还是 tombstone 语义，需要保留审计记录并阻止自动重新生成同一记忆。
6. 记忆被召回后记录使用情况，但“被召回”不能自动等价于“被确认”。
7. 记忆更新必须幂等，使用 `subject_key + scope + normalized value` 做候选去重。

### 偏好提取策略：结构化优先，LLM 补充

不采用“所有对话都交给 LLM 并直接写入”的方式，而采用两阶段管线：

```text
用户消息 / 行为事件
  -> 规则与结构化信号筛选
  -> 按需调用 LLM 做语义抽取
  -> Schema、Policy、去重和冲突校验
  -> candidate memory
```

- 规则层负责明确表达、否定、时间、重复行为、Board 状态和敏感信号。
- LLM 负责同义表达、隐含偏好、跨轮归纳和分类补全，但必须返回版本化 JSON。
- LLM 输出只能生成 `candidate`，不能直接成为 `active`，也不能直接修改 Board。
- 没有候选信号时不调用 LLM，降低成本、延迟和误记忆概率。
- 健康、心理、关系和身份信息提高门槛，必要时必须用户确认。
- 用户明确否定、删除或禁止记录时，规则层优先阻止同一记忆重新生成。

LLM 抽取结果至少包含：

```json
{
  "candidates": [
    {
      "category": "preference",
      "scope": { "type": "user" },
      "subjectKey": "response_style",
      "statement": "用户偏好简短直接的回复",
      "value": { "style": "concise" },
      "evidence": [{ "sourceRef": "turn-123", "quote": "短一点就好" }],
      "confidence": 0.86,
      "requiresConfirmation": false
    }
  ]
}
```

JSON 校验失败、证据缺失或分类越界时，整批候选不得写入；抽取协议需要版本化、可重放和可评测。

### 记忆管理 UI

后续需要提供可检查的记忆管理页：

- 按分类、作用域、敏感等级和状态筛选。
- 查看记忆 statement、证据和来源。
- 确认、编辑、删除、暂时不使用。
- 查看冲突记忆和被替代版本。
- 一键导出/删除当前用户记忆仓库。
- 显示“为什么这次回答使用了这条记忆”。

## RAG 与检索架构

### 混合检索，不依赖单一向量库

检索流程建议：

```text
User Query
  -> Query Understanding
     - intent
     - entities
     - time range
     - task / branch scope
     - required memory categories
  -> Candidate Retrieval
     - exact / subject lookup
     - SQLite FTS5 keyword search
     - vector similarity search
     - temporal retrieval
     - graph relation expansion
     - optional Mem0 search
  -> Security / Scope Filter
  -> Deduplication and Conflict Grouping
  -> Reranking
  -> Diversity and Token Budget Selection
  -> Evidence-Aware Context Pack
  -> Prompt Builder
```

### 检索策略

至少实现以下策略接口：

```js
retrieveByKeyword(query, scope)
retrieveByVector(query, scope)
retrieveByTimeRange(range, scope)
retrieveBySubject(subjectKey, scope)
retrieveRelated(memoryId, scope)
retrieveFromExternalProvider(query, scope)
```

第一版本地实现可以使用：

- SQLite FTS5：关键词、短语、中文分词适配策略。
- 本地 embedding provider：通过可插拔接口接入模型。
- 向量索引：初期可采用 SQLite 扩展或应用层 top-k；数据量增长后再替换专用向量库。
- Mem0：作为外部候选来源，不作为唯一事实源。

### Rerank 与上下文包

候选记忆评分应综合：

```text
score = semantic_similarity
      + lexical_match
      + scope_match
      + recency
      + importance
      + confidence
      + explicit_confirmation
      - contradiction_penalty
      - sensitivity_penalty
      - redundancy_penalty
```

给模型的不是裸记忆数组，而是带来源的 Context Pack：

```json
{
  "memoryId": "memory-123",
  "category": "preference",
  "statement": "用户偏好简短、直接的回复",
  "confidence": 0.91,
  "status": "active",
  "scope": "user",
  "evidence": ["turn-8", "turn-22"],
  "whyRetrieved": "与当前请求的回答风格有关"
}
```

Context Orchestrator 需要设置 token budget、分类配额、去重和冲突处理，防止 RAG 把过多旧信息塞进 prompt。

### RAG 质量指标

后续建立离线评估集和运行指标：

- Recall@K：相关记忆是否召回。
- Precision@K：召回内容是否真正相关。
- Citation/evidence coverage：回答使用的记忆是否有证据。
- Contradiction rate：冲突记忆导致的错误比例。
- Stale recall rate：过期记忆被使用的比例。
- User correction rate：用户纠正记忆的比例。
- Tool success rate：工具调用后是否得到有效结果。
- Context cost：单次请求的 token 和延迟。

## 可插拔 Agent 工具层

### 工具分层

```text
Tool Registry
  -> Tool Manifest
  -> Capability Policy
  -> Approval Policy
  -> Schema Validation
  -> Executor
  -> Result Sanitizer
  -> Audit Log
```

工具按风险分级：

- `read`：只读 Board、记忆、当前状态。
- `propose`：生成 Board 或记忆提案，不直接写入。
- `write`：写入非破坏性 Agent 数据，需要策略允许。
- `destructive`：删除、覆盖、批量修改，默认禁止或必须二次确认。
- `external`：网络、第三方服务、消息发送，默认关闭并单独授权。

### 工具接口

```js
const tool = {
  id: "board.search",
  version: "1.0.0",
  title: "搜索用户画布",
  risk: "read",
  scopes: ["board:read"],
  inputSchema: {},
  outputSchema: {},
  availability: ({ mode, account, agent }) => true,
  execute: async (input, context) => {},
};
```

工具执行上下文只能由 Runtime 注入：

```js
{
  accountId,
  agentId,
  workspaceId,
  sessionId,
  abortSignal,
  logger,
  memoryRepository,
  boardGateway,
  approvalGateway,
}
```

工具不得自行读取环境变量、任意文件路径或其他账号目录。

### 第一批内置工具

建议从窄能力开始：

```text
board.get_current_state       read
board.search                  read
board.get_task                read
memory.search                 read
memory.get                    read
memory.propose_upsert         propose
board.propose_change          propose
agent.get_current_context     read
agent.create_follow_up        write（仅 Agent workspace）
```

第一版明确不提供：

- 任意 shell 执行。
- 任意文件系统读写。
- 无确认的 Board 删除或覆盖。
- 无权限的网络请求。
- 代表用户发送外部消息。

### 工具调用流程

```text
Model requests tool
  -> Validate tool id and input schema
  -> Check account / agent / workspace scope
  -> Check capability and risk policy
  -> Ask approval when required
  -> Execute with timeout and cancellation
  -> Sanitize output
  -> Record audit event
  -> Return structured result to model
```

所有工具结果都要限制大小、清理敏感字段，并带 `toolRunId`、耗时、状态和错误类型。模型不能通过工具参数绕过权限。

## Agent Runtime 与记忆写入编排

建议将现有 `agentService` 拆成以下协作模块：

```text
electron/agent/
  agentRuntime.js
  contextOrchestrator.js
  memoryRepository.js
  memoryWriter.js
  memoryExtractor.js
  memoryPolicy.js
  memoryReranker.js
  toolRegistry.js
  toolRuntime.js
  toolPolicy.js
  approvalManager.js
  agentAuditStore.js
```

职责：

- `agentRuntime`：一轮 Agent 请求的状态机。
- `contextOrchestrator`：组织会话、Board、记忆、工具结果和 token budget。
- `memoryExtractor`：从用户 turn、Board 事件和工具结果提取候选记忆。
- `memoryPolicy`：决定什么能写入、作用域、敏感等级和确认要求。
- `memoryWriter`：去重、冲突处理、版本和证据写入。
- `memoryRepository`：查询、写入、反馈、导出和删除。
- `toolRegistry`：注册工具和版本。
- `toolRuntime`：校验、授权、执行、超时、结果清理和审计。
- `approvalManager`：处理 Board 变更和高风险记忆写入的用户确认。
- `agentAuditStore`：记录模型、检索、工具、记忆写入和用户反馈。

## 分阶段实施计划

### Phase 0：冻结契约和威胁模型

文件：

- 本计划文档
- `docs/superpowers/specs/` 下新增 Agent memory/tool contract 文档
- 相关架构测试草案

工作项：

- 确定 `accountId`、`agentId`、`workspaceId`、`sessionId` 的边界。
- 确定个人模式和家庭模式的账号上下文来源。
- 明确记忆分类、状态、敏感等级和删除语义。
- 明确工具风险等级、权限和审批规则。
- 明确个人模式回环绑定、家庭模式局域网绑定和禁止公网暴露的网络契约。
- 画出跨账号访问、异步请求串账号、Prompt 注入和工具越权的威胁模型。

验收：

- 所有后续模块都能引用同一组作用域和状态定义。
- 个人模式不需要伪造家庭账号才能使用用户级 Agent。
- 个人模式的监听地址只能是回环地址；家庭模式的允许网段、认证和端口策略有明确测试契约。

### Phase 0.5：Gateway 网络安全实现

文件：

- `electron/gateway/networkPolicy.js`
- `electron/gateway/localGateway.js`
- `electron/main.js`
- `.env.local.example`
- `tests/networkPolicy.test.js`

工作项：

- 默认只启动个人模式本地 IPC/回环服务。
- 个人模式拒绝 `0.0.0.0`、公网 IP 和非回环绑定。
- 家庭模式只允许用户明确开启的局域网网卡和当前 CIDR。
- 禁止 UPnP、端口映射和公网中继。
- 对家庭请求执行来源网段、账号会话、Origin/CSRF、速率和请求体大小校验。
- 网卡或网络范围变化后重新校验；无法确认安全范围时停止监听。
- 启动日志显示实际绑定地址和允许网段，不显示敏感信息。

验收：

- 个人模式从局域网其他设备无法连接。
- 家庭模式从非允许网段无法连接，且局域网请求仍需账号认证。
- 配置为全网卡或公网地址时，个人模式启动失败，家庭模式需要明确拒绝或安全降级。
- 不存在自动端口映射和外网穿透路径。

### Phase 1：用户级 Agent 上下文隔离

文件：

- `electron/gateway/accountContext.js`
- `electron/gateway/localGateway.js`
- `electron/agentService.js`
- `electron/agentSqliteStore.js`
- `tests/accountContext.test.js`
- `tests/agentService.test.js`

工作项：

- 给 Agent session、turn、window、signal、prompt snapshot 增加用户级作用域。
- 建立 `User Agent` 与 `Task Agent` 的关系。
- Gateway 为每个账号创建独立 Agent runtime 和依赖。
- 账号切换时 flush、取消旧请求、关闭旧 store，再创建新上下文。
- 所有 Agent API 从当前账号上下文读取身份，不接受 Renderer 自带的账号选择。

验收：

- 同一个 task/session ID 在两个账号下也完全隔离。
- 账号切换后旧 Agent 请求不能写入新账号。
- 个人模式旧 Agent SQLite 数据可兼容读取。

### Phase 2：本地专业记忆仓库

文件：

- `electron/agent/memoryRepository.js`
- `electron/agent/memoryWriter.js`
- `electron/agent/memoryPolicy.js`
- `electron/agentMemorySqliteStore.js`
- `tests/memoryRepository.test.js`
- `tests/memoryWriter.test.js`
- `tests/memoryPolicy.test.js`

工作项：

- 新建独立 `agent-memory.sqlite` schema。
- 实现 memory item、evidence、relation、feedback、embedding metadata。
- 支持分类、作用域、置信度、重要性、稳定性、敏感等级和状态。
- 支持候选记忆、确认、编辑、拒绝、删除、过期和 supersede。
- 对 Board 派生记忆和对话抽取记忆建立不同 source type。
- 现有 `src/agentMemory.js` 继续作为 Board 派生信号来源，不直接承担长期记忆 CRUD。
- 建立用户级记忆仓库与任务线局部记忆的读取规则。

验收：

- 记忆可以追溯到原始 turn、Board 节点或工具结果。
- 用户删除的记忆不会被普通自动抽取流程静默恢复。
- 冲突记忆不会互相覆盖，而是保留版本和关系。
- 账号 A 的记忆仓库无法被账号 B 查询。

### Phase 3：记忆抽取和学习用户偏好

文件：

- `electron/agent/memoryExtractor.js`
- `electron/agent/memoryWriter.js`
- `electron/agent/agentRuntime.js`
- `tests/memoryExtractor.test.js`

工作项：

- 从显式用户陈述中识别偏好、约束、目标和个人资料候选。
- 从重复行为和多次对话中生成 procedure/preference 候选。
- 给每个候选记忆生成证据、置信度、分类和作用域。
- 对心理、健康、关系和敏感信息启用更高门槛。
- 支持用户对“以后这样记”或“不要这样记”的反馈。
- 将记忆写入从主聊天请求中解耦为可恢复的异步 pipeline，不能阻塞主回复或破坏 Board 保存。

验收：

- 用户明确偏好可以被提取并在后续请求中使用。
- 单次模糊表达不会直接变成稳定事实。
- 记忆抽取失败不会影响对话和 Board 数据。
- 用户反馈可以降低、修改或禁止某条记忆。

### Phase 4：混合检索与 RAG 编排

文件：

- `electron/agent/contextOrchestrator.js`
- `electron/agent/memoryReranker.js`
- `electron/agent/memoryRepository.js`
- `electron/agent/embeddingProvider.js`
- `electron/agentMem0Client.js`
- `tests/contextOrchestrator.test.js`
- `tests/memoryRetrieval.test.js`

工作项：

- 增加 SQLite FTS5 或等价本地关键词索引。
- 定义 embedding provider 和 vector index 接口。
- 将 Mem0 改为可选外部候选源，加入账号和 Agent 命名空间。
- 实现关键词、向量、时间、主题、关系扩展等候选召回。
- 实现作用域过滤、去重、冲突分组、重排、分类配额和 token budget。
- 输出带证据和 `whyRetrieved` 的 Context Pack。
- 记录检索候选、最终选中项、延迟和 token 成本。

验收：

- 对偏好、近期事件、任务知识和关系支线使用不同检索策略。
- 过期、删除、越权和低置信度记忆不会直接进入 prompt。
- 召回结果可解释，能显示来源和召回理由。
- 外部 Mem0 不可用时，本地仓库仍能完成基本检索。

### Phase 4.5：用户画像库与可复制领域知识库

文件：

- `electron/agent/userProfileStore.js`
- `electron/agent/knowledgeBaseRegistry.js`
- `electron/agent/knowledgeBaseStore.js`
- `electron/agent/knowledgeIngestor.js`
- `electron/agent/domainTemplates/`
- `tests/userProfileStore.test.js`
- `tests/knowledgeBase.test.js`
- `tests/knowledgeIngestor.test.js`

工作项：

- 将用户偏好、经历、能力、目标和授权管理迁移到独立的 `user-profile.sqlite`。
- 将星盘和职业规划作为独立领域工作区，不与通用用户记忆混库。
- 增加 `general-knowledge`、`astrology`、`career-planning` 知识库模板。
- 支持复制模板创建新的 `knowledgeBaseId`、schema、索引和 manifest。
- Web Search 结果必须经过来源保存、去重、质量/时效检查、分块和审核后入库。
- LLM 只辅助分类、摘要和关系抽取，不能伪造来源或绕过入库策略。
- 星盘计算使用可复现的结构化算法；出生信息按敏感资料单独授权。
- 职业规划区分用户事实、外部知识和 Agent 推断，并为岗位/行业知识设置时效策略。

验收：

- 用户画像和领域知识可以分别导出、删除和备份。
- 复制知识库模板不会复制其他账号数据，也不会覆盖现有知识。
- Web Search 的每条知识都能追溯来源和版本。
- 星盘出生信息不会被普通用户偏好检索无条件召回。
- 职业规划回答能区分用户资料、知识库证据和 Agent 建议。

### Phase 5：可插拔工具 Registry 和 Runtime

文件：

- `electron/agent/toolRegistry.js`
- `electron/agent/toolRuntime.js`
- `electron/agent/toolPolicy.js`
- `electron/agent/approvalManager.js`
- `electron/agent/agentAuditStore.js`
- `tests/toolRegistry.test.js`
- `tests/toolRuntime.test.js`

工作项：

- 定义工具 manifest、版本、输入输出 schema、风险等级和 capability。
- 实现工具注册、发现、启用、禁用和版本兼容。
- 实现账号、Agent、workspace、session 作用域校验。
- 实现超时、取消、重试上限、结果大小限制和错误归一化。
- 实现 Board read、memory search、memory propose、board propose 等首批工具。
- 所有写入类工具只产生 proposal 或写入 Agent workspace。
- 高风险工具必须经过 approval manager。
- 所有调用写入 audit store。

验收：

- Agent 只能调用策略允许的工具。
- 无法通过输入参数访问其他账号或任意文件。
- 工具超时或失败不会破坏当前 Agent turn。
- Board 修改仍然经过用户确认，不存在无确认覆盖。

### Phase 6：用户可见的记忆和工具管理

文件：

- `electron/preload.js`
- `electron/main.js`
- `src/main.jsx`
- `src/styles.css`
- 相关 UI 测试

工作项：

- 增加记忆列表、分类筛选、证据查看和编辑/删除入口。
- 增加“本次回答使用了哪些记忆”的可解释面板。
- 增加工具列表、风险级别、启用状态和权限设置。
- 增加高风险操作确认卡。
- 增加导出和删除当前账号 Agent 记忆仓库的入口。
- 家庭模式下只显示当前账号的数据。

验收：

- 用户可以发现并修正错误记忆。
- 用户可以关闭某类自动学习或某个工具。
- 用户可以理解 Agent 为什么使用某条记忆。
- 删除操作不触碰其他账号和用户 Board。

### Phase 7：评测、性能和可替换后端

文件：

- `electron/agent/evaluation/`
- `electron/agent/embeddingProvider.js`
- `electron/agent/modelProvider.js`
- `electron/agent/toolRegistry.js`
- 评测数据和测试

工作项：

- 建立脱敏的检索评测集、记忆抽取评测集和工具调用评测集。
- 记录 Recall@K、Precision@K、冲突率、过期召回率、用户纠正率、延迟和 token 成本。
- 增加 embedding、reranker、LLM、Mem0 和向量库 provider 接口。
- 支持本地模式、外部服务模式和服务不可用降级。
- 对 prompt injection、数据外泄、工具越权和敏感记忆泄露做安全测试。

## API 契约草案

### Memory Repository

```js
await memoryRepository.addCandidate({
  accountId,
  agentId,
  scope: { type: "user", id: accountId },
  category: "preference",
  statement: "用户偏好简短直接的回复",
  evidence: [{ sourceType: "turn", sourceRef: "turn-123" }],
  confidence: 0.78,
});

await memoryRepository.search({
  accountId,
  agentId,
  query,
  scope,
  categories: ["preference", "constraint"],
  limit: 12,
});

await memoryRepository.feedback({
  accountId,
  memoryId,
  action: "confirm",
});
```

### Tool Runtime

```js
await toolRuntime.run({
  toolId: "board.search",
  input: { query: "当前任务线" },
  context: {
    accountId,
    agentId,
    workspaceId,
    sessionId,
  },
});
```

### Context Pack

```js
{
  queryId,
  scope,
  memories: [],
  boardContext: [],
  recentTurns: [],
  toolResults: [],
  retrievalTrace: {
    strategies: [],
    candidates: 0,
    selected: 0,
    latencyMs: 0,
  },
  tokenBudget: {
    requested: 0,
    used: 0,
  },
}
```

## 关键风险与约束

### 记忆幻觉

模型推断必须标记为 `model_inference` 和 `candidate`，带证据和置信度，不能直接进入稳定用户画像。

### 记忆污染

外部文本、工具结果和恶意提示可能诱导写入错误记忆。所有记忆写入都要经过来源标记、策略检查和必要的用户确认。

### 跨账号泄露

账号作用域由 Gateway 注入；Repository、Tool Runtime、Redis/Mem0 adapter 都需要强制校验，而不是仅靠调用者自觉传参。

### 记忆过度积累

必须设置分类配额、TTL、合并和过期策略。高质量记忆优先于记忆数量。

### RAG 上下文膨胀

每次请求设置 token budget、分类配额和去重规则；完整证据留在仓库，Prompt 只放必要摘要和来源 ID。

### 工具越权

模型输出只能请求工具 ID 和结构化参数，不能执行代码。工具必须经过白名单、schema、权限和风险策略。

### 用户 Board 被破坏

Board 写入工具只生成可审核 proposal；删除、覆盖、批量修改默认关闭，必须显式确认并保留操作记录。

### 外部服务不可用

本地 Board、会话和基础记忆检索不能依赖 Mem0、Redis 或远程 embedding 服务。所有外部适配器都必须可选并可降级。

## 测试矩阵

### 网络安全

- Personal 模式只监听 `127.0.0.1`/`::1`，不会对局域网暴露。
- Personal 模式拒绝 `0.0.0.0`、公网 IP 和非回环地址。
- Family 模式只监听明确选择的局域网网卡，不监听公网或蜂窝接口。
- 非允许网段请求被拒绝；允许网段请求仍必须通过账号认证。
- 缺少明确网段、网卡变化或配置异常时，Gateway 安全停止共享服务。
- UPnP、端口映射、公网中继默认关闭且无隐式启用路径。
- Origin/CSRF、速率限制、请求体上限和敏感操作审批生效。

### 隔离

- 两个账号拥有完全独立的 Agent session 和 memory repository。
- 相同 task/session/memory ID 在不同账号下不会冲突。
- Redis、Mem0、向量索引和工具审计均带账号作用域。
- 账号切换会取消旧请求并关闭旧上下文。

### 记忆

- 记忆分类和作用域正确。
- 记忆有证据链。
- 重复记忆会去重或合并。
- 冲突记忆保留版本，不静默覆盖。
- 删除、拒绝和禁止重新生成语义正确。
- 过期记忆不会进入默认 Context Pack。
- 用户确认的偏好可以稳定召回。

### 用户画像与领域知识

- 用户画像和领域知识存储在不同数据库。
- 星盘出生信息按敏感资料和授权策略处理。
- 星盘计算结果可以依据算法版本复现。
- Web Search 知识保存来源、版本、抓取时间和引用证据。
- 复制知识库模板会创建独立库，不覆盖已有数据。
- 职业规划召回能区分用户事实、外部知识和 Agent 推断。

### RAG

- 关键词、语义、时间和关系召回可以合并。
- 召回结果经过权限、状态和敏感等级过滤。
- Context Pack 有召回轨迹、证据和 token budget。
- Mem0 不可用时本地检索仍可工作。

### 工具

- 未注册工具不能调用。
- schema 错误在执行前被拒绝。
- 越权账号、路径和 workspace 请求被拒绝。
- 高风险工具触发审批。
- 工具超时、取消、重试和失败状态可审计。
- Board 修改不会绕过确认。

### 回归

- 现有 `tests/agentMemory.test.js`、`tests/agentService.test.js`、`tests/agentSqliteStore.test.js` 继续通过。
- `npm test` 通过。
- `npm run build` 通过。
- 个人模式旧数据可读。
- 家庭模式未登录时不加载任何 Agent 或 Board 业务数据。

## 推荐落地顺序

先实现 Phase 0、Phase 1 和 Phase 2，再做 Phase 3。原因是“用户级隔离”和“记忆仓库数据模型”是后续学习、RAG、工具权限的共同底座。Phase 4 和 Phase 5 可以并行设计，但建议先完成本地记忆关键词检索和只读工具，再接向量、Mem0 和写入工具。

第一批可交付的最小闭环是：

```text
账号登录
  -> 用户级 Agent 上下文
    -> 对话产生候选偏好
      -> 记忆仓库存证据
        -> 下一次请求混合召回
          -> Context Pack 注入 Agent
            -> 只读工具查询 Board
```

确认这个闭环稳定后，再加入自动合并、向量 RAG、外部记忆服务、Board 提案工具和记忆管理 UI。这样每一步都能独立验证，也不会把专业能力的核心责任交给某一个模型或外部服务。

## 完成标准

- Agent、记忆和工具均按用户账号隔离，且隔离由主进程和存储层强制执行。
- 用户偏好可以从明确表达和重复证据中学习，并可查看、修改、删除和禁止使用。
- 记忆具备分类、作用域、证据、版本、冲突、置信度、敏感等级和生命周期。
- RAG 使用混合检索、重排、去重、冲突处理和 token budget，而不是简单拼接向量结果。
- 工具层支持注册、权限、审批、取消、超时、结果清洗、审计和版本化。
- Board 仍然是用户数据的事实来源，Agent 不得无确认覆盖或删除。
- Mem0、Redis、embedding 和远程模型都可以拔插和降级。
- 具备离线评测指标和跨账号、记忆安全、工具越权测试。
