# StepView 服务器部署改造计划

> 状态：**执行中**。D1-D5 已完成（各自独立提交），D6 待做。
> 前置阅读：`docs/ARCHITECTURE_AND_EXTENSION_GUIDE.md` 第 7 节（数据隔离和目录约定）。
> 目标：从"只能在本机跑"变成"能放到一台公网服务器上，多个账号互不干扰、别人打不进来"。
> 本文只描述要改什么、为什么、怎么验收；具体代码改动在各 Phase 里。

## 零、先回答你的问题：数据现在是不是全在本地

**是。** 除了模型调用，StepView 现在不依赖任何云服务。

| 数据 | 存在哪 | 形态 | 现在在哪 |
| --- | --- | --- | --- |
| 账号、登录会话、全局设置 | `dataDir/gateway.sqlite` | SQLite | 本机 |
| 看板（画布） | `dataDir/accounts/<账号>/stepview.sqlite` 的 `board_documents` | SQLite（外加一份 JSON 导出镜像） | 本机 |
| 日记、审批、Agent 会话、长期记忆、画像、知识库、快照 | 同一个账号库 | SQLite | 本机 |
| Agent 提示词 / 窗口缓存 | Redis（`REDIS_URL`） | Redis + AOF 落盘 | 本机 |
| 浏览器里的看板 / 设置副本、登录 token | 浏览器 `localStorage` | **只是缓存**，事实源在服务端 | 用户电脑上 |
| 备份 | `dataDir/backups/`、`dataDir/stepview-backup-*/` | VACUUM INTO 快照 + 导出包 | 本机 |

**唯一会出网的两处**：OpenAI API（`openaiApiKey` / `openaiBaseUrl`），以及可选的 mem0（不配 `MEM0_API_KEY` 就退回本地实现）。

所以"部署"这件事，本质上是**把 `dataDir` 这一个目录搬到服务器上**，再加上"怎么安全地让公网访问"。`compose.yaml` 里 `./.stepview-family-data:/data` 那一行就是全部持久化状态。

好消息：**数据库层和账号隔离层已经做完了**（每账号一个库、一个目录，`accountContext` 强制边界，上一轮刚修过浏览器副本串号），这部分不用重做。要补的是"公网"这一层。

---

## 一、现状盘点

### 1.1 已经能用的，不要重做

- 家庭模式 HTTP Gateway（`electron/gateway/familyHttpServer.js`）：Bearer session 鉴权、按账号建 context、请求体 2MB 上限。
- 容器化（`Dockerfile` + `compose.yaml`）：web = nginx 托管构建产物，gateway = node，redis = AOF。
- 数据生命周期：账号库/全局库的保留规则集中在 `electron/db/retention.js`，备份走 `VACUUM INTO` 轮转（`electron/db/backup.js`），导出/恢复有清单校验（`electron/db/archive.js`、`transfer.js`）。
- 启动自检 `npm run preflight:family`：Node 版本、依赖、数据目录可写、端口占用、`.env.local` 与 LAN 策略。

### 1.2 现在只因为"一切都挤在本机"才成立的假设

这些不是 bug——当初的目标就是本机。但上公网会逐个变成问题。

| # | 隐含假设 | 代码位置 | 上公网会怎样 |
| --- | --- | --- | --- |
| A1 | 前端和网关在同一个 `hostname`，只是端口不同 | `src/browserGatewayApi.js:3` | 页面走 HTTPS 后请求 `http://host:3210` 会被浏览器按混合内容拦掉 |
| A2 | 只有一个可信来源访问 API | `familyHttpServer.js:14` | `Access-Control-Allow-Origin` 反射任意 Origin |
| A3 | 网络层是可信的 | `compose.yaml` | gateway 直接把 3210 发布到宿主机，没有 TLS、没有反代 |
| A4 | 没人会恶意爆破登录 | `accountStore.js:69` | 登录接口没有任何失败计数或退避 |
| A5 | 只有自己人会注册 | `config.js:11` | `allowRegistration` 默认 `true` |
| A6 | 所有账号都是自己人 | `accountStore.js:103` + `accountRepository.js:42` | **设置是全局的、不是按账号的**：`/api/settings` 返回明文 OpenAI key，且所有账号共用同一把 |
| A7 | 进程只有一个、SQLite 是本地的 | `gateway/contextCache.js` | 多实例会各自持有 context，SQLite 单文件也不适合多写者 |

---

## 二、P0：不改就上不了线

按依赖顺序排列。每项给"现状 / 为什么不行 / 怎么改 / 怎么验收"。

### P0-1 前端 API 地址同源化

**现状**：`src/browserGatewayApi.js:3-8`，只有显式设置了 `VITE_STEPVIEW_API_URL` 才用它，否则拼 `${protocol}//${hostname}:3210/api`。而 `VITE_STEPVIEW_API_URL` 在仓库里**除这一行外没有任何地方设置**：`Dockerfile` 的 web 阶段没有 ARG/ENV，`.env.local.example` 里也没有。

**为什么不行**：
- HTTPS 页面请求 `http://...:3210` 是混合内容，会被浏览器直接拦掉（`Failed to fetch`）。
- 就算不用 HTTPS，也等于把 3210 端口暴露到公网，网关要自己扛所有攻击面。

**怎么改**：
1. 默认值改成**同源相对路径** `/api`——即"不配置也是对的"。显式配置只作为逃生口保留。
2. `docker/nginx.conf` 增加 `location /api/ { proxy_pass http://gateway:3210; }`（含 SSE 需要的 `proxy_buffering off`、`proxy_read_timeout`）。
3. `Dockerfile` web 阶段加可选 `ARG VITE_STEPVIEW_API_URL`，需要单独域名时再传。

**验收**：浏览器打开 `https://域名/`，DevTools Network 里所有请求都是 `https://域名/api/...`，页面里搜不到 `3210`。

### P0-2 CORS 收敛到白名单

**现状**：`familyHttpServer.js:14`（以及 SSE 的 `:115`）无条件 `Access-Control-Allow-Origin: <请求里的 Origin>`。等于谁问都答"你可以跨域读我的响应"。

**为什么不行**：同源部署之后浏览器**根本不会**发跨域请求，CORS 头完全没必要存在。留着它反而是把浏览器侧那道锁拆了——任何第三方页面都能拿用户的 token 调 API。

**怎么改**：
- 增加 `STEPVIEW_ALLOWED_ORIGINS`（逗号分隔）；为空时**不返回任何 CORS 头**（同源部署的正常状态）。
- 只有显式配了白名单，才对这些 Origin 回 CORS 头；不在名单里的一律不加。

**验收**：同源部署下响应里没有 `Access-Control-Allow-Origin`；用 `curl -H 'Origin: https://evil.example'` 请求，响应里也没有这个头。

### P0-3 只暴露反向代理，不暴露后端端口

**现状**：`compose.yaml` 把 `gateway` 的 3210 和 `web` 的 5173 分别发布到宿主机（默认绑 `127.0.0.1`，`STEPVIEW_BIND_ADDRESS` 可改）。nginx 只托管静态文件，不代理 API。

**怎么改**：
- gateway 改成 `expose: [3210]`（只在 compose 网络内可达），**不 publish**。
- web 只 publish `127.0.0.1:8080:80`，由宿主机的反向代理（Caddy 或 Nginx）终结 TLS 并转发。
- 补一份 `deploy/` 目录：Caddyfile（自动证书，最省事）或 nginx + certbot，外加一份 `.env.production.example`。
- `STEPVIEW_BIND_HOST` 保持 `0.0.0.0` 只在容器内生效，宿主机不暴露。

**验收**：从服务器外部 `curl http://<公网IP>:3210` 连不上；`curl https://域名/api/health` 返回 `{"ok":true,"mode":"family"}`。

### P0-4 登录防爆破

**现状**：`accountStore.login()` 只做密码校验，没有任何失败计数、延迟或锁定。用户名规则是公开的（3-64 位），密码下限 8 位。

**怎么改**：
- 内存里按 `用户名 + 客户端 IP` 记失败次数：连续 N 次失败后指数退避（例如 5 次后每分钟最多试 1 次，1 小时后重置）。
- 反向代理层再加一道 `limit_req`（Caddy/Nginx 都能配），双保险。
- 失败响应保持现有的模糊文案（不区分"用户不存在"和"密码错"），别引入新的信息泄露。

**验收**：脚本连续打错密码，第 N 次之后开始被拒；正常密码仍能登录；重启进程后退避状态清零（可接受）。

**实际做法**：
- 新增 `electron/gateway/loginThrottle.js`，两个桶：`IP+用户名`（5 次失败后锁）和 `IP`（20 次，拦住换用户名试），
  退避时长 15 分钟起步、每多触发一轮翻倍、封顶 1 小时。**只在内存里**，进程重启即清零——
  写进库等于给攻击者一个"把磁盘写满"的开关。桶有上限（5000）并按 5 分钟清理过期项（`sweep()`）。
- 客户端 IP 取 `X-Forwarded-For` 第一段（正常部署里网关只在内网、前面是反代，所以可信）；
  文档同时注明：**一旦把 3210 直接发布出去，这个头就能伪造，退避随之失效**——D2 那条"不暴露网关端口"是这里的前提。
- 登录失败从"裸 Error → HTTP 500"改成 401 `INVALID_CREDENTIALS`；用户名重复 409 `USERNAME_TAKEN`；
  用户名/密码格式错误 400。文案仍然不区分"用户不存在"和"密码错"。
- 超限返回 429 `LOGIN_THROTTLED`，界面按 `code` 显示"请 N 分钟后再试"。

### P0-5 注册开关默认收紧

**现状**：`config.js:11` `allowRegistration: true`，`compose.yaml` 里也是 `${STEPVIEW_ALLOW_REGISTRATION:-true}`。第一个注册的人自动成为 `owner`（`accountStore.js:56`）。

**怎么改**：
- 公网模板里默认 `STEPVIEW_ALLOW_REGISTRATION=false`。
- 部署流程写清楚：先起服务 → 注册第一个账号（owner）→ 关掉注册 → 之后加人由 owner 在服务端开一个"邀请码"或临时打开开关。
- 提供一条 CLI：`node scripts/create-account.js <username>` 直接建号（跳过 HTTP 注册），这样常态可以一直关着注册。

**验收**：关闭注册后 `POST /api/accounts/register` 返回 403；CLI 仍能建号。

**实际做法**：
- `compose.yaml` 与 `.env.local.example` 的默认值都改成 `false`（原来是 `true`）。
- 新增 `scripts/create-account.js`（`npm run account:create -- <用户名>`），走的是和 HTTP 注册同一套
  `createAccountStore.registerAccount`，不复制密码哈希逻辑；不给 `--password` 就随机生成并只打印一次。
- 建号 CLI 的数据目录用新的 `resolveDataDir()`（`electron/config.js`），和 `familyServer` / `preflight` 同一处求解——
  否则迟早出现"CLI 建的账号服务端看不见"。
- `Dockerfile` 的 gateway 阶段补 `COPY scripts ./scripts`，容器里可以直接跑。

### P0-6 设置（含 OpenAI key）改成按账号隔离 + 加密落库

**现状**：`/api/settings` 的读写全部落到 `gateway_settings` 表，而这张表**只有 `key` 主键，没有 account_id**（`electron/db/repositories/accountRepository.js:42`）。后果有三个：

1. **越权**：任何登录账号 `GET /api/settings` 都能拿到别人填的 OpenAI key（明文）。
2. **计费共享**：所有人共用一把 key，用量无法归属。
3. **明文落库**：key 在 SQLite 里是明文。

**为什么现在不算炸**：本机自用、家庭场景，等于只有你自己。上公网就是三个真问题。

**已经核实**：本机这台的数据目录里，`gateway_settings` 现在就躺着一把明文的 key，
任何登录账号都能通过 `GET /api/settings` 读到。也就是说这不是"以后可能有问题"，
是**现在就是错的**（和上一轮修掉的浏览器副本串号是同一类）。D3 建议最先做。

**实际做法**（与下面的初稿有两处偏差，理由写在括号里）：
- 三项移到账号库的 `account_settings` 表（migration 0010）。
- `openaiApiKey` 用 AES-256-GCM 加密，格式 `v1:<iv>:<tag>:<密文>`。密钥优先取 `STEPVIEW_SECRET_KEY`；
  没配时**自动生成** `dataDir/secret.key`（0600）而**不是拒绝保存**——桌面版和本地开发
  不该为了存一个 Key 先配环境变量，而且"自动生成"同样满足"永不落明文"这条底线。
  代价是密钥会随数据目录的备份一起走，所以文档和设置页都明确提示部署时要用环境变量。

**怎么改**（初稿，保留作为记录）：
- 把 `openaiApiKey` / `openaiBaseUrl` / `agentModel` 移到**账号库**（`accounts/<id>/stepview.sqlite`），新建一张 `account_settings` 表（或复用现有的 kv 表），键仍然叫这三个名字。
- `openaiApiKey` 落库前用 `STEPVIEW_SECRET_KEY`（32 字节，来自环境变量）做 AES-256-GCM 加密，库里存 `v1:<iv>:<tag>:<密文>`；没配密钥时**拒绝保存 key**并给出明确报错，而不是偷偷存明文。
- 迁移：老数据在 `gateway_settings` 里的那份，在 owner 第一次登录时提示"检测到旧的全局 key，是否迁到当前账号"，**不要自动搬**（无法判断该归谁）。
- `/api/settings` 的 GET 不再回传明文 key，只回 `hasOpenAiKey: true/false` 和脱敏尾四位；前端设置页相应改成"已保存，重新输入可覆盖"。
- 顺带确认 Electron 桌面模式那条路（`desktopApi.loadSettings/saveSettings`）也走同一套，别再出现"桌面模式好、家庭模式串"的分裂。

**验收**：
- A 填 key，B 登录后 `GET /api/settings` 看不到 A 的 key；B 自己填的只对自己生效。
- 直接打开 `stepview.sqlite`，`openaiApiKey` 的值是密文不是 `sk-...`。
- 新增单测覆盖"两个账号互不可见"和"加密往返"。

### P0-7 会话生命周期

**现状**：session 存在 `localStorage`，TTL 168 小时（`STEPVIEW_SESSION_TTL_HOURS`），没有轮换、没有"登出所有设备"，也没找到改密码的 HTTP 接口。

**怎么改**：
- 加"修改密码"接口（现在没有）：改密码时**吊销该账号所有 session**。
- session 表加一个 `last_used_at` 已有，补一条"长期不动自动失效"的保留规则（走 `retention.js`，不要另起一套 TTL）。
- 至少给出一个 owner 用的"踢掉某个账号的所有登录"的运维手段。

**验收**：改密码后旧 token 立刻 401；`retention.js` 里有对应规则、有单测。

---

## 三、P1：上公网前最好有

### P1-1 镜像瘦身与运行安全

**现状**：`Dockerfile` 的 gateway 阶段直接 `COPY electron ./electron` + `COPY src ./src` 然后 `CMD node`，跑在 root 下；web 阶段用 `npm ci`（含 devDependencies）。

**怎么改**：
- gateway 阶段 `npm ci --omit=dev` 或干脆只拷必要文件；`USER node`（非 root）；加 `.dockerignore` 检查（已有 `.dockerignore`，核对一遍别把 `.stepview-family-data` 打进镜像）。
- 基础镜像固定到具体版本 tag，不用浮动 tag。
- 只读根文件系统 + `tmpfs`（可选，看兼容性）。

**验收**：镜像内 `whoami` 不是 root；镜像里搜不到 `.stepview-family-data`。

**实际做法**：
- 基础镜像按**摘要**固定（`node:22-bookworm-slim@sha256:83f4…`、`nginx:1.27-alpine@sha256:6564…`、
  `redis:7.4-alpine@sha256:ff02…`）。tag 会随上游发版改变内容，摘要不会；`Dockerfile` 顶部写了升级时怎么查新摘要。
- 网关 `USER node`，`COPY --chown=node:node`，`ENV HOME=/app`；实测 `process.getuid() === 1000`。
  顺带确认了**服务端一个 npm 依赖都没有**（全部 `node:` 内置，SQLite 走 `node:sqlite`），
  所以镜像里没有 `node_modules`，`/app` 总共 892K——原来那套 `npm ci` 本来就只服务前端。
- 前端构建阶段加了 `--omit=dev`：`electron` / `electron-builder` 是 devDependencies，容器里只构建网页，不需要它们
  （少装一大半，构建快很多、也不那么容易在慢网络下超时）。同时加了 `NPM_REGISTRY` 构建参数
  （默认官方源，compose 透传），国内部署可以换镜像源——这是实测出来的痛点：本机跑官方源超时、跑 npmmirror 秒回。
- web 改成非 root 的 nginx：监听 8080（1024 以下只有 root 能绑）、`pid` 挪到 `/tmp`、
  `chown` 缓存目录，`USER nginx`；`compose.yaml` 的宿主机端口仍是 5173（`:5173:8080`），对外没有变化。
- `.dockerignore` 补齐：数据目录（`.stepview-family-data` / `.stepview-personal-data` / `.stepview-runtime`）与
  `docs` / `tests` / `*.md` 都不进构建上下文；前者是安全底线，后者只是别拖慢构建。
- 启动器 `requireLocalImages` 的报错文案改成引导 `docker compose pull`（按摘要拉取），不再是裸 `docker pull` tag。

**实测**：用一份真实数据目录的拷贝跑网关容器（非 root、注册关闭），`/api/health` 正常、`POST /api/accounts/register` 返回 403、
`lsq` 能登录——证明非 root 用户对挂载进去的 SQLite 有读写权限（这条在 Docker Desktop 的 bind mount 上不是理所当然的，所以要实测）。

### P1-2 备份落异地

**现状**：`VACUUM INTO` 轮转 + 手动导出，都在同一块盘上。盘坏 = 全没。

**怎么改**：写一个 `scripts/backup-offsite.js`，调现有的 `createBackupManager` 生成快照后推到对象存储（S3/R2）或 rsync 到另一台机器；配 cron。**同时**要有一份"从快照恢复"的演练步骤写进运维文档——备份没演练过等于没有。

### P1-3 可观测性

**现状**：只有 `/api/health` 返回 `{ok, mode}`，日志是 `console.log`。

**怎么改**：结构化日志（JSON 一行一条）+ 请求 id；`/api/health` 扩展成带磁盘余量、DB 可读、Redis 状态的 `readyz`；错误上报可以先用"日志 + 告警脚本"。

### P1-4 配额与限流

**现状**：只有请求体 2MB 上限。没有每账号的日记条数、画布节点数上限，更没有 LLM 调用配额。

**怎么改**：这几个数字都属于"数据留多久/留多少"的范畴，按项目既有约定**加到 `electron/db/retention.js` 或相邻的配置里**，不要散在业务代码。LLM 配额单独一层（按账号/按天计数），因为它是钱。

---

## 四、P2：以后再说

- **迁到 Postgres**：只有在"要多实例 / 要读写分离 / 数据量超过单机 SQLite 舒适区"时才做。现在做是纯负担。
- **Redis 降级为可选**：确认 Redis 挂掉时 agent 只是丢缓存、不影响落库（现在日志里已经能看到它连不上也继续跑）。
- **多实例水平扩容**：和 SQLite、`contextCache` 冲突，明确"一个部署只跑一个 gateway 实例"，写进文档免得有人乱加副本。
- **桌面版与服务器版账号打通**。

---

## 五、阶段划分与提交

沿用仓库惯例：每个 Phase 一个 commit（必要时 feature + docs 两个）。

| Phase | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- |
| D1 | 前端同源 `/api` + nginx 反代 + 构建参数 | 无 | ✅ 已完成 |
| D2 | CORS 白名单 + compose 只暴露反代 | D1 | ✅ 已完成 |
| D3 | 设置按账号隔离 + key 加密落库 + 前端脱敏 | 无（独立） | ✅ 已完成 |
| D4 | 登录退避 + 注册默认关闭 + 建号 CLI | 无（独立） | ✅ 已完成 |
| D5 | 镜像瘦身 / 非 root / 固定 tag | 无 | ✅ 已完成 |
| D6 | 异地备份 + 结构化日志 + readyz + 运维文档 | D2 | 备份能在另一台机器恢复出可登录实例 |

**D3 建议优先做**：它是唯一一个"现在就是错的"（越权 + 明文），其余都是"现在没问题、上公网才有问题"。

---

## 六、人工验收清单（部署后跑一遍）

1. 全新服务器：`docker compose up -d` → 注册第一个账号 → 关掉注册 → 重启，账号还在。
2. 公网访问走 HTTPS，证书有效，http 自动跳 https。
3. 从外部 `curl` 3210 / 5173 都连不上。
4. 建第二个账号：**确认看不到第一个账号的任何东西**（画布、日记、设置、key）。
5. 错误密码连续尝试会被退避；正确密码仍可登录。
6. 断开 Redis，应用仍能写日记、保存画布（只丢缓存）。
7. 从快照恢复到一个全新目录，能起来、能登录、数据完整。
8. 杀容器再起，数据不丢（验证 volume 挂载正确）。

---

## 七、需要你拍板的几件事

下面几条会直接影响 D1-D6 的做法，先定下来再开工：

1. **有没有域名、证书怎么来？** → 决定用 Caddy（自动签）还是 Nginx + 你已有的证书。
2. **到底几个人用？** 只有你和家人几个账号，还是要开放注册？→ 决定要不要做邀请码、配额、限流强度。
3. **OpenAI key 谁出？** 每人自己填自己的，还是服务器统一给一把？→ 决定 D3 是"按账号隔离"还是"按角色分配"。
4. **数据放哪？** 服务器本地盘，还是挂云盘？→ 决定备份策略和 I/O 预期。

---

## 八、明确不做的

- 不引入 Kubernetes、微服务、消息队列这一类当前规模用不上的东西。
- 不做"为了以后可能的多实例"而提前换 Postgres。
- 不动数据库层和账号隔离层（已经做完并且有测试覆盖）。
- 不为了部署而改动用户数据格式——所有改造都必须能在现有数据上原地升级，不允许"重新导入一遍"。
