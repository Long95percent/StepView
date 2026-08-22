# StepView 可插拔网关与家庭账号隔离实施计划

> 状态：仅实施计划，当前不直接实现功能。

## 目标

为 StepView 增加一个位于 Electron 主进程中的可插拔网关层，通过 `.env.local` 配置运行模式和基础服务。

支持两种模式：

- `personal`：保持当前单用户本地运行方式，现有数据路径和使用体验不变。
- `family`：通过网关管理本地账号；每个账号拥有独立的画布文件、Agent SQLite 数据库和后续扩展数据目录。

网关层需要成为 Renderer 与本地存储、Agent 服务、LLM 服务之间的统一边界，避免账号判断和数据库路径散落在 UI 或业务模块中。

## 产品原则

- 默认仍为 `personal`，升级后不能影响现有用户数据。
- 家庭模式未登录时，不加载任何账号业务数据。
- 账号身份只由 Electron 主进程维护，Renderer 不能通过 IPC 参数伪造 `accountId`。
- 不同账号之间的 Board、Agent 会话、Prompt Snapshot、Signal 和 Mem0 同步记录必须隔离。
- 个人数据迁移到家庭账号必须由用户显式确认，不能自动覆盖目标账号数据。
- 本阶段优先实现本地网关；远程认证、云同步和复杂家庭权限不纳入 MVP。

## MVP 范围

### 包含

- `.env.local.example` 配置模板。
- 统一配置加载、默认值和配置校验。
- `personal` 和 `family` 两种运行模式。
- Electron 主进程 Gateway 抽象和本地实现。
- 家庭模式本地账号注册、登录、退出、当前账号和切换账号。
- 每个账号独立的 Board 文件和 Agent SQLite 数据库。
- 通过 preload 暴露网关状态和账号 API。
- 家庭模式登录界面和当前账号切换入口。
- 个人模式到家庭账号的显式数据导入和备份。
- 配置、账号、网关上下文和账号隔离测试。

### 不包含

- 远程网关或服务端账号系统。
- 多设备同步和云端数据库。
- 邮箱验证、找回密码、社交登录。
- 复杂的家庭管理员授权模型。
- 将 OpenAI API Key 明文写入 `.env.local`。
- 一次性重写现有 Board 或 Agent 存储格式。

## 架构边界

```text
Renderer
  -> preload IPC
    -> Gateway
       -> 当前模式与当前账号
       -> BoardStorage
       -> AgentService
       -> Agent SQLite
       -> Redis / Mem0 / LLM Provider
```

建议新增模块：

```text
.env.local.example
electron/config.js
electron/gateway/
  createGateway.js
  localGateway.js
  accountStore.js
  accountContext.js
```

现有 `boardStorage.js` 和 `agentSqliteStore.js` 保持通用，只通过 `dataDir` 接收存储位置，不感知账号系统。

## 配置设计

新增 `.env.local.example`：

```env
# personal | family
STEPVIEW_MODE=personal

# local gateway implementation
STEPVIEW_GATEWAY=local

# Optional. Defaults to Electron userData
STEPVIEW_DATA_DIR=

# LLM defaults
STEPVIEW_LLM_PROVIDER=openai
STEPVIEW_OPENAI_BASE_URL=https://api.openai.com/v1
STEPVIEW_OPENAI_MODEL=gpt-5.1

# family mode options
STEPVIEW_ALLOW_REGISTRATION=true
STEPVIEW_SESSION_TTL_HOURS=168
```

实际使用时：

```bash
cp .env.local.example .env.local
```

配置加载规则：

- `.env.local` 不存在时使用默认值。
- `STEPVIEW_MODE` 只接受 `personal` 或 `family`。
- 配置错误需要在启动阶段给出明确错误。
- 日志可以显示模式和网关类型，但不能输出 API Key 或密码。
- Electron 主进程和 Vite 开发环境使用同一份配置解析逻辑，避免两套环境变量行为。

## 数据目录设计

### 个人模式

必须保持现有路径不变：

```text
userData/
  stepview-board.json
  stepview-board.backup.json
  stepview-agent.sqlite
```

Gateway 返回固定个人上下文：

```js
{
  mode: "personal",
  accountId: "local-personal",
  dataDir: app.getPath("userData")
}
```

### 家庭模式

```text
userData/
  gateway.sqlite
  accounts/
    <account-id>/
      stepview-board.json
      stepview-board.backup.json
      stepview-agent.sqlite
```

`gateway.sqlite` 只管理账号和登录会话，不存放账号的 Board 或 Agent 业务内容。

如果 Redis 或 Mem0 启用，所有 key、metadata 和查询参数必须包含账号范围，例如：

```text
stepview:<account-id>:agent:session:<session-id>
```

## 账号数据模型

`gateway.sqlite` 建议包含：

```text
accounts
  id
  username
  display_name
  password_hash
  role
  status
  created_at
  updated_at

sessions
  session_id
  account_id
  created_at
  expires_at
  last_used_at
```

MVP 只保留两个角色：

- `owner`
- `member`

密码使用 Node.js `scrypt` 或项目允许的安全密码哈希方案保存，禁止明文保存。Renderer 不保存密码；当前会话由主进程持有。

## Gateway 接口草案

```js
const gateway = createGateway({
  config,
  appDataDir: app.getPath("userData"),
});

await gateway.initialize();

gateway.getMode();
gateway.getCurrentAccount();

await gateway.registerAccount({ username, password, displayName });
await gateway.login({ username, password });
await gateway.logout();
await gateway.listAccounts();
await gateway.switchAccount({ accountId });

await gateway.loadBoard();
await gateway.saveBoard(board);
await gateway.loadAgentJournal();
await gateway.chatAgent(request);
```

所有业务 API 从当前账号上下文解析存储对象：

```js
{
  accountId,
  dataDir,
  boardStorage,
  agentSqliteStore,
  agentService,
}
```

禁止由 Renderer 传入任意 `dataDir` 或用 `accountId` 直接选择文件路径。

## 实施阶段

### Phase 1：配置层和 Gateway 抽象

文件：

- `.env.local.example`
- `electron/config.js`
- `electron/gateway/createGateway.js`
- `electron/gateway/localGateway.js`
- `electron/main.js`
- `tests/config.test.js`
- `tests/gateway.test.js`

工作内容：

- 增加配置模板和配置解析。
- 将 `main.js` 顶层创建的 Board storage、Agent SQLite 和 Agent service 移入 Gateway。
- 让个人模式继续使用原有 `userData` 根目录。
- 保持现有 IPC 名称和 Renderer 行为可用。
- 统一处理退出时的 flush、Redis close 和 SQLite close。

验收：

- 没有 `.env.local` 时应用默认为个人模式。
- 现有个人 Board 和 Agent 数据可以直接读取。
- `npm test` 和 `npm run build` 通过。
- Gateway 可以被测试用临时目录创建，不依赖真实 Electron 窗口。

### Phase 2：家庭账号存储和账号上下文

文件：

- `electron/gateway/accountStore.js`
- `electron/gateway/accountContext.js`
- `electron/gateway/localGateway.js`
- `electron/boardStorage.js`（只在需要时补充路径/关闭能力）
- `electron/agentSqliteStore.js`（只在需要时补充生命周期能力）
- `tests/accountStore.test.js`
- `tests/accountContext.test.js`
- `tests/gateway.test.js`

工作内容：

- 创建 `gateway.sqlite` 的账号和会话表。
- 实现注册、登录、退出、账号列表和切换账号。
- 实现用户名规范化、密码哈希、会话过期和错误登录处理。
- 根据账号 ID 创建稳定且安全的数据目录名，不能直接拼接未经校验的用户名。
- 为当前账号创建独立的 Board storage、Agent SQLite store 和 Agent service。
- 切换账号前 flush 当前 Board 写入并关闭当前 SQLite，再创建新上下文。

验收：

- 账号 A 和账号 B 使用不同目录和不同 SQLite 文件。
- 账号 A 无法读取或写入账号 B 的数据。
- 切换账号后 Board、Agent journal 和会话内容都来自新账号。
- 退出后所有业务读取和写入 API 都被拒绝或返回未登录状态。

### Phase 3：IPC 和 Renderer 账号流程

文件：

- `electron/preload.js`
- `electron/main.js`
- `src/main.jsx`
- `src/styles.css`
- `tests/agentSessionUi.test.js`（如需要）

新增 IPC：

```text
 gateway:info
 account:list
 account:register
 account:login
 account:logout
 account:current
 account:switch
```

工作内容：

- preload 只暴露稳定的业务 API，不暴露文件路径选择或 Node 能力。
- 个人模式直接进入主应用。
- 家庭模式启动后先显示登录/注册界面。
- 登录成功后再加载 Board 和 Agent journal。
- 当前账号菜单支持退出和切换账号。
- 切换账号时清空旧账号的 Renderer 状态，避免界面短暂显示旧数据。
- 在账号切换或退出期间禁用可能触发保存的操作。

验收：

- 家庭模式未登录时不会调用 `board:load` 或 Agent 加载接口。
- 登录、退出和切换账号后的界面状态正确。
- 个人模式不显示不必要的账号登录流程。
- 浏览器模式仍然可以使用现有 localStorage 降级行为；账号隔离只适用于 Electron 网关模式。

### Phase 4：个人数据显式导入家庭账号

文件：

- `electron/gateway/localGateway.js`
- `electron/gateway/accountContext.js`
- `electron/preload.js`
- `electron/main.js`
- `src/main.jsx`
- `tests/gatewayMigration.test.js`

工作内容：

- 增加“导入个人数据到当前家庭账号”操作。
- 导入前检查目标账号是否已有 Board 或 Agent 数据。
- 目标账号已有数据时必须要求明确确认，默认不覆盖。
- 导入前创建目标目录备份。
- Board 使用现有规范化和备份恢复逻辑。
- Agent SQLite 使用文件复制或可靠备份方式导入，并验证数据库可以打开。
- 记录迁移时间、来源和目标账号，便于诊断。

验收：

- 用户取消时目标账号数据完全不变。
- 导入失败时可以恢复目标账号原数据。
- 导入不会删除原个人模式数据。
- 不会因为首次启用家庭模式而自动覆盖任何账号数据。

### Phase 5：外部服务隔离和安全强化

文件：

- `electron/agentRedisClient.js`
- `electron/agentMem0Client.js`
- `electron/agentService.js`
- `electron/gateway/localGateway.js`
- `tests/agentAdapters.test.js`
- `tests/agentService.test.js`

工作内容：

- 为 Redis key 增加 `accountId` 前缀。
- 为 Mem0 查询、写入和 metadata 增加账号范围。
- 检查 Agent service 的所有入口都通过当前上下文访问存储。
- 防止切换账号后遗留旧账号的异步请求写入新账号。
- 对登录错误、会话过期和账号不存在使用不泄露额外信息的错误响应。

验收：

- 账号 A 的 Redis/Mem0 状态不会被账号 B 查询到。
- 账号切换期间的旧请求不会写入新账号。
- 退出时外部连接和 SQLite 都能正常关闭。

## 测试清单

### 配置

- 默认配置为个人模式。
- `.env.local` 可以覆盖模式、网关和模型默认值。
- 无效模式被拒绝。
- API Key 不出现在启动日志中。

### 个人模式兼容

- 原 `stepview-board.json` 可继续读取。
- 原 `stepview-board.backup.json` 恢复逻辑不变。
- 原 `stepview-agent.sqlite` 可继续读取。
- 现有 Board storage 和 Agent service 测试继续通过。

### 家庭模式隔离

- 注册和登录成功。
- 错误密码不能登录。
- 会话过期后业务 API 被拒绝。
- 不同账号目录不同。
- 不同账号的 Board、Agent session、turn、window 和 signal 完全隔离。
- 切换账号会 flush、close 并创建新上下文。
- 退出后不能继续使用旧上下文。

### 迁移

- 空目标账号可以导入个人数据。
- 非空目标账号不会被静默覆盖。
- 用户取消导入后数据不变。
- 导入失败可以恢复备份。
- 原个人数据始终保留。

## 风险与处理

### 风险：账号切换时异步请求串账号

处理：为 Gateway 上下文增加 generation/token；请求开始时绑定当前上下文，完成写入前检查上下文仍然有效。

### 风险：个人模式升级导致数据路径变化

处理：个人模式继续使用 `app.getPath("userData")` 根目录，不做隐式迁移。

### 风险：Renderer 伪造账号 ID

处理：IPC 不接受用于选目录的 `accountId`；所有账号操作由主进程当前会话解析。

### 风险：外部 Agent 缓存串号

处理：Redis key、Mem0 metadata 和查询参数都强制带账号范围，并补充跨账号测试。

### 风险：目标家庭账号数据被覆盖

处理：导入操作必须显式确认、先备份，禁止默认覆盖。

## 完成标准

- `personal` 模式现有功能和数据完全兼容。
- `family` 模式具备可用的本地账号登录和切换流程。
- 每个家庭账号拥有独立 Board 和 Agent 数据库。
- 账号边界由主进程强制执行，而不是依赖前端约定。
- 个人数据迁移是显式、可取消、可恢复的。
- 相关单元测试通过，且 `npm test`、`npm run build` 均通过。
- 后续可以在不修改 Renderer 业务逻辑的情况下替换为远程 Gateway 实现。
