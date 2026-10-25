# StepView

StepView 是一个成长路径可视化桌面应用。

它用自由画布、目标节点、里程碑、计划节点、支线、跨任务连接、Emoji 贴纸和成就系统，帮助你记录自己真实走过的每一步。

> Every step matters. 每个人走过的每一步，都值得被看见。

## 适合记录什么

- 学会了一个新技术、跑通了一个项目、修掉了一个 bug。
- 完成了一次作业、比赛、作品、实习准备或个人计划。
- 打了一局游戏、吃了新口味的烤冷面、认真休息了一会儿。
- 和朋友、同学、喜欢的人一起走过的一段支线。
- 那些很小、很普通，但确实证明你存在过、努力过、变化过的瞬间。

StepView 不只是待办工具。它更像一张属于自己的成长地图：不要求每一步都伟大，只希望每一步都不要被忘记。

## 下载使用

如果你只是想使用 StepView：

1. 打开 GitHub Releases：`https://github.com/Long95percent/StepView/releases`
2. 下载最新版本里的 `stepview.zip`
3. 解压压缩包
4. 运行解压目录中的 `StepView.exe`

桌面版数据会保存在本机，不会因为关闭应用而丢失。

## 使用说明在哪里

- 使用说明书：`docs/使用说明书.md`
- 产品说明书：`docs/产品说明书.md`

如果你是第一次使用，建议先看 `docs/使用说明书.md`。它会从创建目标、添加节点、使用支线、完成目标、查看成就等基础操作讲起。

如果你想了解 StepView 为什么被做出来、它想解决什么问题、它的产品理念是什么，可以看 `docs/产品说明书.md`。

## 当前能力

- 自由画布：拖动画布、缩放视角、自由摆放节点和贴纸。
- 快速建目标：左侧输入目标，或右键画布创建目标。
- 路径记录：自动生成 `🚀` 起点和 `🏁` 终点，可继续添加里程碑。
- 计划节点：记录还没发生但想去做的下一步，并在完成后标记。
- 关键节点：标记重要转折、突破、失败、休息或高光时刻。
- 支线系统：支持“我的分支”“伙伴支线”“心动支线”，支线可以延伸或接回主线。
- 跨任务连接：把不同目标之间的影响关系连起来。
- Emoji 贴纸：拖拽贴纸、放置图案、播放 Emoji rain，让画布更有情绪。
- 完成画廊：完成的目标会进入 Wins，可回看 Journey、恢复或删除。
- 成就系统：在记录过程中逐步解锁徽章，提醒你已经走了很远。
- 本地保存：桌面版数据保存在 Electron 用户目录的 SQLite 数据库里，不再分散成一堆文件。
- 数据位置：用户目录下的 `stepview.sqlite`（这个账号的账号库）和 `gateway.sqlite`（账号与登录会话）；左侧 `Folder` 按钮可以打开数据目录。
- 备份与恢复：可以把数据库导出一份带清单的完整快照；恢复前会先校验文件完整性、schema 版本和必要表是否齐全，恢复时当前数据改名保留、不删除。

## 开发启动

### 一键启动

双击项目根目录的 `start.bat`。

脚本会自动安装依赖并打开 Electron 桌面窗口。

### 手动启动

```bash
npm install
npm run desktop
```

### 家庭版网页端

家庭版网页由项目专属 Docker Compose 栈运行：

- `web`：Nginx 托管 React 生产构建。
- `gateway`：账号、Board、Agent 和流式模型接口。
- `redis`：Prompt/窗口缓存，启用 AOF 持久化且不暴露宿主机端口。

```bash
npm run family

# 停止
npm run family:stop

# 访问
http://localhost:5173/
```

`family` 会检查 Docker Desktop、项目依赖、数据目录和端口，然后构建并启动整套服务。任一必需项不满足时会中止并给出修复方式。

启动器使用 `--pull never`，不会自动连接镜像仓库或拉取镜像。所需基础镜像必须已存在于本机；缺失时会立即报错，
按提示执行 `docker compose pull` 或 `docker pull` 即可。

基础镜像在 `Dockerfile` / `compose.yaml` 里是按**摘要（digest）**固定的，不是浮动 tag——
这样重新构建不会悄悄换成上游刚推的新版本。要升级基础镜像时，先 pull 再换掉那串 `sha256:`，注释里写了怎么查。

两个应用容器都以**非 root**运行：网关是 `node` 用户（服务端本来就不需要任何 npm 依赖，镜像里没有 `node_modules`），
web 是 nginx 自己的 `nginx` 用户、监听 8080（宿主机端口仍然是 5173，不用改）。

- Node.js 22 或更高版本，以及 Node SQLite 支持。
- npm 核心依赖已完整安装。
- StepView 数据目录可创建、写入和删除探测文件。
- 前端 `5173` 端口和家庭 Gateway `3210` 端口未被占用。
- `.env.local` 中的配置和 LAN 网络策略合法。
- Docker Desktop 已启动且 Compose 可用。

可以单独运行检查：

```bash
npm run preflight:family
```

停止整套服务但保留容器和数据：

```bash
npm run family:stop
```

移除容器和项目网络但保留数据：

```bash
npm run family:down
```

查看服务日志：

```bash
npm run family:logs
```

账号、Board 和 SQLite 数据保存在 `.stepview-family-data`；Redis AOF 保存在 `.stepview-runtime/redis`。`family:stop` 和 `family:down` 都不会删除这些目录。

### 加账号

网页注册默认是**关闭**的（`STEPVIEW_ALLOW_REGISTRATION=false`）——它是整个应用里唯一一个
不需要凭据就能写数据的入口，放公网上不该默认开着。加人用服务端命令直接建号：

```bash
# 容器里建（推荐）
docker compose exec gateway node scripts/create-account.js <用户名>

# 不给密码就随机生成一个，只打印这一次
docker compose exec gateway node scripts/create-account.js <用户名> --name="显示名"
```

只有在完全信任的本地环境想临时放开网页注册时，才在 `.env` 里写
`STEPVIEW_ALLOW_REGISTRATION=true`，用完记得改回去。第一个注册的账号自动是 `owner`。

本机默认访问 `http://127.0.0.1:5173`。**只有 web 这一个端口需要可达**：
网关（3210）只存在于 Compose 内网，浏览器一律通过 `web` 的 Nginx 以同源 `/api` 访问它。

如需让局域网设备访问，在项目根目录创建 `.env`：

```dotenv
STEPVIEW_BIND_ADDRESS=192.168.1.10
```

构建前端时要装 npm 依赖。默认走官方源；国内网络慢或经常超时的话，换镜像源（同一份依赖，只是换个 CDN）：

```dotenv
NPM_REGISTRY=https://registry.npmmirror.com
```

前端默认通过**同源** `/api` 访问网关（开发时由 Vite 代理，容器里由 Nginx 代理），
所以浏览器只会连 `web` 这一个端口，跨域和混合内容问题都不会出现。
只有在前端和网关确实不部署在同一个源时，才需要在前端**构建期**配置：

```bash
# 直接构建
VITE_STEPVIEW_API_URL=https://api.example.com npm run build

# Docker Compose（compose.yaml 会作为 build arg 传给 web 镜像）
VITE_STEPVIEW_API_URL=https://api.example.com docker compose up -d --build
```

模型连通性会在实际发送消息时校验，并在界面上显示具体的主机和网络错误。

设置是**账号数据**：和画布、日记一样存在账号库里，每个账号一份，互相看不到。
API Key 落库前用 AES-256-GCM 加密，密钥来自 `STEPVIEW_SECRET_KEY`；没配的话会
自动生成 `dataDir/secret.key`（0600）。本地开发不配也能用，但**部署时必须显式设置**，
否则密钥会跟着数据目录的备份一起走：

```dotenv
STEPVIEW_SECRET_KEY=<openssl rand -hex 32>
```

## 构建发布包

macOS（Apple Silicon，自用 `.app`）：

```bash
npm run dist:personal:mac
```

产物位于 `release/personal/`，包含 `StepView Personal.app`、可分发的 `.dmg` 和 `.zip`。
把应用拖进 `/Applications` 即可使用。个人版不需要账号，数据继续保存在原来的
`~/Library/Application Support/StepView/`，升级不会换到新的数据目录。
开发模式使用独立的 `StepView Dev` 用户数据目录，不会与日用版混用。

个人版发布由 tag 触发。更新版本号并推送 `v*` tag 后，GitHub Actions 会运行测试、
构建 `.dmg` / `.zip`，并把产物和 `SHA256SUMS.txt` 附到对应的 GitHub Release：

```bash
git tag v1.2.0
git push origin v1.2.0
```

当前自用包使用 ad-hoc 签名，没有 Apple Developer ID 和 notarization。从浏览器下载后，
首次运行如果被 Gatekeeper 拦截，需要在 Finder 里右键应用并选择“打开”。

Windows：

```bash
npm run dist:win
```

当前 Windows 发布包通常位于 `release/stepview.zip`，可作为 GitHub Release 附件上传。

## 验证

```bash
npm test
npm run build
```

## 数据与安全

StepView 的记录是非常私人的东西。项目原则上不应加入任何会自动覆盖、替换用户画布数据的演示逻辑。任何示例或教程都应该是非破坏性的：以弹窗、单独预览，或用户明确确认后的导入方式出现。
