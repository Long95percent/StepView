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
- 本地保存：桌面版数据保存到 Electron 用户目录的 `stepview-board.json`。
- 数据位置：左侧 `Folder` 按钮可以打开本地数据文件所在目录。

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
```

`family` 会检查 Docker Desktop、项目依赖、数据目录和端口，然后构建并启动整套服务。任一必需项不满足时会中止并给出修复方式。

启动器使用 `--pull never`，不会自动连接镜像仓库或拉取镜像。所需基础镜像必须已存在于本机；缺失时会立即报错。需要更新镜像时由用户显式执行 `docker pull`。

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

本机默认访问 `http://127.0.0.1:5173`。如需让局域网设备访问，在项目根目录创建 `.env`：

```dotenv
STEPVIEW_BIND_ADDRESS=192.168.1.10
```

API Key 和用户自定义 Base URL 保存在浏览器设置中，启动脚本无法读取；模型连通性会在实际发送消息时校验并显示具体主机和网络错误。

## 构建发布包

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
