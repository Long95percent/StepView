# StepView 数据库层重构实施计划

> 状态：仅实施计划，当前不直接实现功能。
> 前置阅读：`docs/ARCHITECTURE_AND_EXTENSION_GUIDE.md`

## 目标

把 StepView 所有"需要保存的数据"和"会随时间过期删减的数据"收进一个边界清晰的数据库层，让上层业务只通过仓储（repository）读写数据，不再直接碰文件、Redis 或内存容器。

重构之后要达到三件事：

1. **只有一个数据入口。** 业务代码不关心数据存在哪、怎么存，只调用仓储方法。
2. **边界可以被机器检查。** 不是靠约定，而是靠测试扫描源码强制执行。
3. **过期和清理只有一个地方定义。** 不再散落在各个模块里各写一套 TTL。

## 背景：现在到底有多少东西在存数据

重构前先盘清家底。当前每个账号的数据分散在 **14 处**：

| # | 数据 | 存放位置 | 形态 | 过期策略 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 账号、登录会话、全局设置 | `gateway.sqlite`（全局库） | SQLite | 会话 168 小时 | 表只写不清理 |
| 2 | 画布（任务、节点、支线、贴纸） | `stepview-board.json` + 备份 + 临时文件 | 整文件 JSON | 无 | 活跃 |
| 3 | Agent 会话、轮次、窗口、信号、提示词快照、Mem0 同步日志 | `stepview-agent.sqlite` | SQLite | 窗口 20 轮（读时算） | 活跃 |
| 4 | 长期记忆、证据、反馈、关系、向量索引 | `agent-memory.sqlite` | SQLite | 只做软删标记 | 活跃 |
| 5 | 用户画像 | `user-profile.sqlite` | SQLite | 无 | 活跃 |
| 6 | 记忆类审批队列 | **内存 Map** | 内存 | 无 | **重启即丢** |
| 7 | 画布变更提案 | `proposals/*.json`（一个提案一个文件） | 文件目录 | 7 天 / 上限 20 | 列表要全扫目录 |
| 8 | 画布变更快照 | `history/*.json` | 文件目录 | 上限 20 | 列表要全扫目录 |
| 9 | 知识库 | `knowledge-bases/<id>/manifest.json` | 目录 + JSON | 无 | 活跃 |
| 10 | 账号运行时上下文 | `contexts = new Map()`（网关里两处） | 内存 | 无 | **永不释放** |
| 11 | Agent 提示词与窗口状态 | Redis `stepview:<account>:agent` | Redis | 依赖 Redis 自身 | 活跃 |
| 12 | 前端画布副本与设置 | localStorage | JSON | 无 | 浏览器降级模式 |
| 13 | 浏览器模式账号，含**明文密码** | localStorage | JSON | 无 | **安全问题** |
| 14 | Agent Journal | `stepview-agent-journal.json` | 整文件 JSON | 20 轮滑窗 | **死代码**，仅测试引用 |

## 现状问题

按严重程度排序。前四条是这次重构必须解决的。

### 1. 审批队列只在内存里，重启就丢（数据丢失）

`electron/agent/approvalManager.js` 用一个内存 `Map` 存待确认提案。用户看到"有一条记忆变更待确认"，关掉应用再打开就没了，永远确认不了。

同时画布变更提案是落盘的（`proposals/*.json`），所以出现了两种审批行为不一致：画布的能活过重启，记忆的不能。这本身就是设计缺陷。

### 2. 账号上下文缓存永不释放（内存泄漏）

`electron/gateway/familyHttpServer.js` 和 `localGateway.js` 各有一个 `contexts = new Map()`，给每个访问过的账号建一个上下文并永久保留。家庭模式下，每个账号都拖着一个 SQLite 连接和各种缓存，人越多内存越高，永远不降。

### 3. 会话表有过期时间，但从来没有清理任务（无限增长）

`gateway.sqlite` 的 `sessions` 表写了 `expires_at`，但只在查询时用 `expires_at <= now` 过滤掉。过期的行永远留在表里，越积越多。

### 4. 提案和快照是"一个文件一条记录"，列表要全扫目录（性能）

`boardChangeStore.list()` 每次调用都要 `readdir` 整个目录，再逐个读盘解析。上线后提案一多，这个接口会拖慢整个审批面板。

### 5. 知道会被删的数据没有清理，不知道会不会删的数据反而有 TTL

第 3 条和第 4 条说过度保留，但反过来，真正该有 TTL 的（Agent 信号、审计事件、已删除的记忆）反而没有任何清理。保留策略是拍脑袋定的，不集中、不可调。

### 6. 四套持久化机制并存，没有统一备份

JSON 文件、文件目录、三个 SQLite、Redis、localStorage，各自管各自的。用户想备份数据，没有任何一个入口能拿到完整快照；`VACUUM INTO` 能保证单个 SQLite 的一致性，但现在连这个都没用。

### 7. 浏览器模式把明文密码存进 localStorage（安全问题）

`src/main.jsx` 注册浏览器模式账号时，把整个含 `password` 字段的对象序列化进了 localStorage。任何能在该浏览器上执行脚本的人都能直接读到密码原文，而且用户改密码也清不掉旧记录。

### 8. 死代码留下的数据文件

`electron/agentJournalStorage.js` 已经没有任何生产代码引用，只有它自己的测试还在用。运行时的会话数据早就搬到 `stepview-agent.sqlite` 了，但 `stepview-agent-journal.json` 这套逻辑和文件还在，容易让人以为数据存在那里。

## 产品原则

- **不破坏现有用户数据。** 迁移只做"复制到新库"，旧文件一律原样保留，不删不改。新库已有数据时以新库为准。
- **升级后使用体验不变。** 个人模式和家庭模式的目录结构、接口行为保持一致。
- **迁移必须幂等。** 中途断电、重复启动都不能产生重复数据或损坏数据。
- **不引入新的样例/演示逻辑覆盖用户画布。** 迁移不是演示，且迁移写入必须经过与正常写入相同的校验路径。
- **删数据只能是显式命令。** 任何自动清理都只针对明确列在保留策略表里的数据，且默认保守。

## 目标架构

### 目录结构

```
electron/db/
  index.js                   createDatabase() / openAccountDatabase()
  connection.js              DatabaseSync 封装：PRAGMA、事务助手、语句缓存
  migrations/
    index.js                 迁移注册表与执行器
    0001-base.sql
    0002-approvals.sql
    ...
  repositories/
    accountRepository.js     账号、会话、全局设置
    boardRepository.js       画布文档
    diaryRepository.js       日记条目、关联、标签、全文索引、变更日志
    agentSessionRepository.js Agent 会话、轮次、窗口、信号、提示词快照
    agentMemoryRepository.js 长期记忆与证据链
    userProfileRepository.js 用户画像
    approvalRepository.js    统一审批队列与快照
    knowledgeBaseRepository.js 知识库元数据
    auditRepository.js       审计事件
    kvRepository.js          通用键值（提示词状态、窗口状态的本地落地）
  retention.js               全局保留策略：声明式规则 + 统一执行
  backup.js                  VACUUM INTO 一致性备份与轮转
  blobs.js                   附件内容寻址存储（库里存元数据，磁盘存文件）
```

### 数据库拓扑

- **全局库**：`<dataDir>/gateway.sqlite`，存账号、登录会话、全局设置。保持现有文件名不变，避免破坏已部署环境。
- **账号库**：`<accountsDir>/<accountId>/stepview.sqlite`，一个账号一个库。
  - 并入现在的 `stepview-agent.sqlite`、`agent-memory.sqlite`、`user-profile.sqlite`、`stepview-board.json`、`proposals/`、`history/`、`knowledge-bases/`。
- **不合并**全局库和账号库。账号数据必须物理隔离，一个账号的库损坏不能牵连其他账号。

### 边界规则（可强制）

这是"边界清晰"的具体含义。规则要能被测试检查，否则只是口头约定。

1. `node:sqlite` 只允许出现在 `electron/db/` 目录内。
2. `node:fs` 的写操作只允许出现在 `electron/db/`（`blobs.js`、`backup.js`）和 `electron/preflight.js`。
3. 业务模块（`gateway/`、`agent/`、`agent/tools/`、`src/`）只能通过仓储接口访问数据，不得自己拼 SQL 或读写文件。
4. 迁移文件只能新增，不能修改已发布的历史迁移。
5. 删除语句只允许出现在 `electron/db/` 内；批量清理（TTL 与限额）只能由 `retention.js` 执行。
6. 以上五条由 `tests/dbBoundary.test.js` 扫描源码强制。

边界测试带一份**历史遗留豁免名单**（`DEBT`）。规则是只减不增：

- 没有登记在豁免名单里的违规会让测试失败。
- 登记过的文件如果已经不再违规，同样会让测试失败，提醒你把它从名单里删掉。
- 每个临时豁免项必须标注计划里移除它的阶段，永久豁免项必须写明理由。

这样边界不会随着时间被悄悄放宽。

### 保留策略集中化

新建 `electron/db/retention.js`，用一张声明式规则表描述所有会过期或需要限量的数据：

```js
export const RETENTION_RULES = [
  // 登录会话：直接按过期时间删
  { table: "gateway_sessions", where: "expires_at < :now" },
  // 审批记录：已决策的保留 7 天，待确认的最多 20 条
  { table: "approvals", where: "status != 'pending' AND created_at < :ttl", keep: { limit: 20, orderBy: "created_at DESC", filter: "status = 'pending'" }, ttlDays: 7 },
  // 画布快照：只留最近 20 个
  { table: "snapshots", keep: { limit: 20, orderBy: "created_at DESC" } },
  // Agent 轮次：每个会话留最近 200 轮
  { table: "agent_turns", keep: { limit: 200, partitionBy: "session_id", orderBy: "created_at DESC" } },
  // Agent 信号与审计：保留 90 天
  { table: "agent_signals", ttlDays: 90 },
  // 日记变更日志：保留 180 天，最多 500 条
  { table: "diary_revisions", ttlDays: 180, keep: { limit: 500, orderBy: "created_at DESC" } },
  // 回收站里的日记：30 天后物理删除
  { table: "diary_entries", where: "status = 'trashed' AND deleted_at < :ttl", ttlDays: 30 },
];
```

统一由一个 `runRetention(db, { now })` 执行，触发时机：应用启动后一次、之后每 24 小时一次、以及写操作后的节流触发（最多 5 分钟一次）。每次执行结果写进 `retention_runs` 表，方便排查"我的数据为什么不见了"。

调整保留期只改这张表，不碰任何业务代码。

### 内存态处理原则

把内存里的状态分三类，各自有明确归属：

| 类别 | 判断标准 | 处理方式 |
| --- | --- | --- |
| 必须持久化 | 重启后丢了会让用户困惑或丢数据 | 进数据库。审批队列属于这类。 |
| 纯派生缓存 | 丢了能立刻从数据库重建 | 可以留内存，但必须有容量上限和淘汰策略。账号上下文属于这类，改成 LRU 并加空闲淘汰，同时保证冷启动能从库重建。 |
| 配置与注册表 | 进程生命周期内不变，且不是用户数据 | 留在内存，集中在 `createAccountContext` 里构造。工具注册表、记忆插件管理器属于这类。 |

Redis 保留，但降级为"可选加速层"：家庭模式下多进程共享提示词状态时用它，连不上时自动落到本地的 `kv` 表，功能不受影响。

## 数据模型

### 基础表（Phase 0）

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE retention_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  removed_json TEXT
);
```

### 审批与快照（Phase 1）

```sql
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- memory_upsert | board_change | diary_change
  status TEXT NOT NULL,          -- pending | approved | rejected | expired
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  operation TEXT,
  session_id TEXT,
  payload_json TEXT NOT NULL,
  diff_json TEXT,
  base_hash TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_approvals_pending ON approvals(account_id, status, created_at DESC);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,            -- board | diary
  label TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_snapshots_recent ON snapshots(account_id, kind, created_at DESC);
```

### 画布文档（Phase 3）

画布保持"一整块文档"的存法，不拆表。原因是审批流程依赖整块内容的指纹（`boardHash`）来判断"提案生成后画布有没有被别人改过"。一旦拆成任务表、节点表、连线表，这套指纹逻辑和 diff 逻辑全部要推倒重来，风险远大于收益。

```sql
CREATE TABLE board_documents (
  doc_key TEXT PRIMARY KEY,      -- 目前只有 'board'
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 日记（Phase 6）

日记是行式数据，无界增长，要按天、按标签、按节点查询，必须建表。详见后续日记模块设计。

```sql
CREATE TABLE diary_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL,
  occurred_day TEXT NOT NULL,
  timezone TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',   -- active | archived | trashed
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_diary_day ON diary_entries(account_id, occurred_day DESC);

CREATE TABLE diary_links (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  diary_id TEXT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,     -- node | branch | task
  target_id TEXT NOT NULL,
  task_id TEXT,
  role TEXT NOT NULL DEFAULT 'context',    -- primary | context | evidence
  created_by TEXT NOT NULL DEFAULT 'user',
  orphaned_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (diary_id, target_type, target_id)
);
CREATE INDEX idx_diary_links_target ON diary_links(account_id, target_type, target_id);
```

## 实施阶段

每个阶段都是可独立提交、可独立验证、可随时停下来的一次改动。前一个阶段不完成就不要开下一个。

### Phase 0：数据库地基（不迁移任何数据）✅ 已完成

- [x] 新建 `electron/db/connection.js`：封装 `DatabaseSync` 打开流程，统一设置 `journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout`，提供 `withTransaction(fn)` 事务助手。嵌套调用复用外层事务，传入异步函数会直接报错而不是静默提前提交。
- [x] 新建 `electron/db/migrations/index.js` 与 `0001-base.sql`：顺序迁移执行器，每步在事务内完成、失败回滚；`schema_migrations` 记录每步的 SQL 校验和，已应用的迁移被改动会直接拒绝；数据库版本高于代码支持版本时拒绝打开。
- [x] 新建 `electron/db/index.js`：`openAccountDatabase({ dataDir })` 与 `openGlobalDatabase({ dataDir })`。
- [x] 新建 `electron/db/retention.js`：声明式规则表 + `runRetention()`，本阶段只落地 `retention_runs` 表，规则表为空，不接任何业务数据。
- [x] 新建 `electron/db/backup.js`：用 `VACUUM INTO` 做一致性备份，按数量轮转，替换现在的 `copyFile` 备份方式；在事务内调用会直接拒绝。
- [x] 新建 `tests/dbBoundary.test.js`：扫描 `electron/` 与 `src/` 源码，断言上述五条边界规则，并带只减不增的豁免名单。
- [x] 新建 `tests/dbConnection.test.js`、`tests/dbMigrations.test.js`、`tests/retention.test.js`、`tests/dbBackup.test.js`。
- [x] 验证：`npm test` 通过，43 个文件 218 个用例全绿（原 177 + 新增 41）。
- [x] 提交：`feat: add database layer foundation`

本阶段零行为变化，纯新增，风险最低。

### Phase 1：把内存态和文件目录搬进数据库

这一阶段专门修前面第 1、2、4 条问题。

- [ ] 新建 `electron/db/repositories/approvalRepository.js`，迁移 `0002-approvals.sql` 建 `approvals` 与 `snapshots` 表。
- [ ] 改写 `electron/agent/approvalManager.js`：内存 `Map` 换成仓储调用，接口签名保持不变（`submit` / `list` / `find` / `decide`），上层不需要改动。
- [ ] 改写 `electron/agent/boardChangeStore.js`：`proposals/*.json` 和 `history/*.json` 的读写换成仓储调用，对外导出的 `boardHash`、`isProposalId`、`stage` / `get` / `list` / `decide` / `remove` / `prune` / `snapshotBoard` 签名全部保持不变。
- [ ] 改写 `electron/agent/approvalService.js` 的 `list`，改为一次 SQL 查询取回全部待确认项，去掉"读目录 + 逐个解析"。
- [ ] 改写网关的 `contexts = new Map()` 为带容量上限和空闲淘汰的 LRU 缓存，并在淘汰时调用 `context.close()` 释放 SQLite 连接。
- [ ] 迁移脚本 `0002` 增加一次性导入：启动时若 `approvals` 表为空且 `proposals/` 目录存在，则导入历史提案，**旧文件原样保留不删**。
- [ ] 测试：审批重启后仍在（新增用例：重建仓储后 `list` 仍能读到）；LRU 淘汰会调用 `close`；历史提案导入幂等（跑两次不产生重复）。
- [ ] 验证：`npm test`，重点看 `tests/boardChangeStore.test.js`、`tests/approvalService.test.js`、`tests/familyHttpServer.test.js`。
- [ ] 提交：`refactor: persist approvals in the database layer`

### Phase 2：合并三个 SQLite

- [ ] 迁移 `0003-agent.sql`：把 `agent_sessions`、`agent_turns`、`agent_session_windows`、`agent_signals`、`agent_prompt_snapshots`、`agent_mem0_sync_log` 建到账号库。
- [ ] 迁移 `0004-memory.sql`：把 `memory_items`、`memory_evidence`、`memory_feedback`、`memory_relations`、`memory_embeddings` 建到账号库。
- [ ] 迁移 `0005-profile.sql`：把 `profile_items` 建到账号库。
- [ ] 新建 `agentSessionRepository.js`、`agentMemoryRepository.js`、`userProfileRepository.js`，方法签名对齐现有模块（`agentSqliteStore` / `agentMemorySqliteStore` / `userProfileStore` 的对外接口）。
- [ ] 一次性数据导入：从 `stepview-agent.sqlite`、`agent-memory.sqlite`、`user-profile.sqlite` 复制进账号库，用 `INSERT OR IGNORE` 保证幂等，旧库文件重命名为 `*.migrated` 保留。
- [ ] 删除三个旧 store 模块及其独立连接，`createAccountContext` 只保留一个数据库句柄。
- [ ] 测试：迁移后行数一致；重复迁移不产生重复行；账号库与旧库数据可比对。
- [ ] 验证：`npm test`。
- [ ] 提交：`refactor: merge account sqlite stores into one database`

这是重构里风险最高的一步，务必确认数据比对通过再删旧文件。

### Phase 3：画布落库

- [ ] 迁移 `0006-board.sql` 建 `board_documents` 表。
- [ ] 新建 `boardRepository.js`，读写画布文档 + 维护 `revision` 与 `hash`。
- [ ] 改写 `electron/boardStorage.js` 为仓储的薄适配器，**对外接口完全不变**（`readBoard` / `writeBoard` / `flushWrites` / `setFsApi` / `boardPath` / `backupPath`），保证 `boardHash`、提案、审批、Agent 工具、22 个相关测试全部零改动。
- [ ] 首次导入：账号库无画布记录时读取 `stepview-board.json` 并导入，**原文件保留不删**；此后以库为准。
- [ ] 处理 `setFsApi`：现有测试靠它注入假文件系统。改为在仓储层保留一个可注入的驱动点，保持测试可用。
- [ ] 处理外部依赖：`board:reveal` 与 `account:import-personal-data` 现在依赖用户可见的 JSON 文件，改为显式导出/导入命令，同时更新界面文案。
- [ ] 测试：`tests/boardStorage.test.js` 全部通过且无需改断言；旧 JSON 导入幂等。
- [ ] 验证：`npm test` + `npm run build`。
- [ ] 提交：`refactor: store the board document in the database`

### Phase 4：清理历史包袱

- [ ] 删除 `electron/agentJournalStorage.js` 及其测试（已被 `agentSqliteStore` 取代的死代码）。
- [ ] 清理 `knowledge-bases/` 的手写 JSON 目录，迁入 `knowledge_base` 表 + `blobs` 存储。
- [ ] 接入保留策略：启动时与每日各执行一次 `runRetention()`，覆盖会话表、Agent 信号与审计事件、Agent 轮次。
- [ ] 为所有被清理的表补上执行前统计，写入 `retention_runs`。
- [ ] 测试：`retention.test.js` 覆盖每条规则，以及"重跑不误删"。
- [ ] 验证：`npm test`。
- [ ] 提交：`refactor: centralize data retention and remove legacy stores`

### Phase 5：前端存储收口与安全修复

- [ ] 移除浏览器模式在 localStorage 中保存明文密码的行为。改为只保存会话令牌，或明确降级为"每次输入密码"。
- [ ] 已存在的明文密码记录在首次加载时主动清除，并提示用户重新登录。
- [ ] 前端画布缓存改为带 revision 校验：只有服务端 revision 更高才覆盖，避免多标签页互相覆盖。
- [ ] 测试：`tests/browserGatewayApi.test.js` 覆盖登录流程不再写入密码字段。
- [ ] 提交：`fix: stop persisting plaintext passwords in browser mode`

### Phase 6：日记板块

地基完成后才开始这一阶段，届时按独立设计文档实施。

- [ ] 迁移建日记表、关联表、标签表、全文索引、变更日志。
- [ ] 新建 `src/diaryCore.js` 共用纯函数、`diaryRepository.js`、`electron/diaryService.js`。
- [ ] 打通 Electron IPC 与家庭 HTTP 双通道，保证两边接口与鉴权行为一致。
- [ ] 接入审批：新增 `diary_change` 审批类型，复用 Phase 1 的统一审批队列。
- [ ] 显式迁移现有节点备注为日记条目，**保留节点原文不清空**，且需用户确认后执行。
- [ ] 提交：`feat: add the diary module`

### Phase 7：备份与文档

- [ ] 暴露统一的导出与备份接口：`VACUUM INTO` 出单个完整快照，附带版本号和表清单。
- [ ] 提供恢复流程：校验快照完整性与 schema 版本兼容性后再导入。
- [ ] 更新 `docs/ARCHITECTURE_AND_EXTENSION_GUIDE.md`：补上数据库层的边界规则、目录结构、保留策略表和内存态三分类。
- [ ] 更新 `README.md` 的数据文件说明（数据目录从多个文件变为两个库）。
- [ ] 提交：`docs: document the database layer`

## 迁移规则

所有一次性数据迁移必须满足：

1. **只读旧、只写新。** 旧文件不删除、不修改、不被截断。
2. **幂等。** 用唯一键或 `INSERT OR IGNORE` 保证重复执行不产生重复数据。
3. **可判定完成。** 用 `schema_migrations` 表记录已完成的迁移版本，不靠"文件是否存在"猜测。
4. **失败可重试。** 整体放在一个事务里，中途失败回滚，下次启动重试。
5. **旧文件改名而不删除。** 合并完成后旧库改名为 `*.migrated`，保留至少一个大版本周期。

## 测试清单

### 数据库层

- 迁移按序执行，重复执行不报错。
- 事务失败后完整回滚，不留半截数据。
- 迁移中途进程被杀，下次启动能继续。
- 边界测试：`node:sqlite` 和文件写入不出现在 `electron/db/` 之外。

### 保留策略

- 每条规则单独用例，验证只删该删的。
- 边界值：刚好在 TTL 上的记录不被删。
- 重跑不误删。
- 执行记录写入 `retention_runs`。

### 迁移

- 旧数据行数与新库一致。
- 重复迁移不产生重复。
- 旧文件在迁移后仍可读。
- 迁移后原有业务测试全部通过，不需要修改断言。

### 隔离

- 账号 A 的库损坏不影响账号 B。
- LRU 淘汰后账号上下文能重新构建。
- 家庭模式下两个账号并发写各自库不互相阻塞。

## 风险与处理

### 风险：Phase 2 合库丢失记忆数据

合并三个 SQLite 是最高风险动作。处理方式：先复制不删旧库，比对行数与抽样内容通过后才删除旧模块，旧库改名保留。

### 风险：Phase 3 改动画布存储破坏审批流

处理方式：`boardStorage` 的对外接口一行不改，只换内部实现，用现有 22 个相关测试做回归。任何需要改测试断言的改动都视为设计错误，停下来重新评估。

### 风险：同步 API 阻塞事件循环

`node:sqlite` 的 `DatabaseSync` 是同步 API，会阻塞 Electron 主进程和 HTTP 服务。处理方式：强制分页、禁止无索引的全表扫描、单次查询结果设上限，并把这三条写进编码规范由评审把关。

### 风险：中文全文检索不准

实测结论：FTS5 默认 `unicode61` 分词器会把整段中文当成一个词，两字查询完全搜不到；改用 `trigram` 分词器后，三字及以上查询正常，但两字查询仍然返回空。

处理方式：检索采用混合策略——三字及以上走全文索引，少于三字回退到 `LIKE` 模糊匹配。日记正文长度和查询频率上去之后，再考虑加一张按字切分的辅助索引表。

### 风险：用户看不到自己的数据了

现在用户可以点开数据文件直接看。落库之后需要提供导出功能，并在设置界面保留"打开数据目录"入口，避免用户感觉数据"被藏起来了"。

### 风险：迁移过程中断电

处理方式：迁移整体事务化 + `schema_migrations` 记录版本 + 旧文件永不删除，保证任何时刻中断都能重来。

## 完成标准

- 全项目只剩 `gateway.sqlite` 与账号库 `stepview.sqlite` 两个数据库文件，不再有业务 JSON 文件和数据目录。
- `tests/dbBoundary.test.js` 通过，边界规则可被机器检查。
- 所有保留与清理逻辑集中在 `retention.js` 的规则表里，业务代码中不再出现 TTL 常量。
- 审批队列重启后不丢失，且记忆类与画布类行为一致。
- 账号上下文缓存在容量上限内，淘汰时会释放数据库连接。
- 浏览器模式不再保存明文密码。
- `npm test` 与 `npm run build` 通过。
- 现有用户数据在升级后完整可见，旧文件保留在磁盘上。

## 不包含

- 多设备实时同步。变更日志表会预留字段，但本次不实现同步协议。
- 数据库加密。
- 迁移到外部数据库（PostgreSQL 等）。当前定位是本地优先应用，SQLite 足够。
- 日记板块的界面。Phase 6 只做后端与接口，界面另行设计。
