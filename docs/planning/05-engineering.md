# 工程待办

> 状态：规划草案  
> 最后整理：2026-10-19  
> 范围：架构、数据层、依赖、性能、可靠性和开源协作治理  
> 导航：[返回规划中心](README.md)

## 工程架构与可维护性

### 渐进拆分前端巨型文件

- [ ] `src/main.jsx` 约 1738 行：先按领域提取 `AuthShell`、`Sidebar`、`Canvas`、`GoalCard`、`Wins`、`Settings`、`DataManagement`，每次小步迁移并保持行为测试。
- [ ] `src/styles.css` 约 1937 行：按 tokens、layout、components、features、utilities 拆分，删除死样式前先做视觉回归。
- [ ] 提取 hooks：加载/保存 Board、视口变换、拖拽、选择、键盘命令、toast、dialog、账号会话。
- [ ] 提取 service adapter：Electron IPC、家庭 Gateway、browser local 三种模式遵循同一类型化接口和错误模型。
- [ ] 不进行一次性整文件重写；用 characterization tests 锁住现有行为后逐块替换。

### 类型、契约与状态

- [ ] 分阶段引入 TypeScript 或 JSDoc strict：先覆盖共享数据模型、IPC、Gateway、Agent 工具和数据库边界。
- [ ] Board schema 有显式版本与运行时校验；未知字段可保留，坏数据不会拖垮整个应用。
- [ ] 前后端共享 DTO/schema，避免 Electron、HTTP、browser adapters 的能力和错误语义漂移。
- [ ] 用 reducer/state machine 表达加载、保存、离线、审批和导入流程，减少互相竞争的布尔值。
- [ ] 引入 Error Boundary，单个日记/公式/卡片渲染失败不导致整页白屏。
- [ ] 为 ID、时间、时区、排序和软删除定义统一规则；禁止各模块各自生成兼容性不明的数据。
- [ ] 关键更新使用不可变操作与明确命令，便于 undo、审计和同步。

### 数据库与持久化

- [ ] 为每次迁移增加 forward、失败回滚/恢复策略和真实旧版本 fixture 测试。
- [ ] 迁移前自动备份，迁移成功后做完整性检查；失败时保留日志与原库。
- [ ] 将 Board 整体 JSON 高频写入改为拖动结束批处理、debounce 或增量事件；先以基准验证瓶颈。
- [ ] 审查每次保存是否同步构建 memory 和镜像文件，拆离非关键路径，减少写放大。
- [ ] 长任务使用事务边界与取消语义，避免“数据库成功、镜像失败”产生不一致。
- [ ] 定期执行并展示 SQLite quick_check/integrity_check、WAL checkpoint、备份校验结果。
- [ ] 定义数据保留与 vacuum 策略；不能在用户不知情时清除可恢复记录。
- [ ] 对 100、500、2000、10000 节点与 10 年日记数据建立基准 fixture。

### 配置与依赖

- [ ] 将 `package.json` 中多个 `latest` 改为经过验证的固定范围；lockfile 作为发布输入。
- [ ] 使用 Renovate/Dependabot 分批升级，自动生成变更说明并跑完整测试，不自动合并大版本。
- [ ] 区分 runtime 与 dev dependencies；`@vitejs/plugin-react`、Vite、Vitest、wait-on 等归位。
- [ ] 校验所有环境变量，启动时输出脱敏后的有效配置摘要和修复建议。
- [ ] 模型、超时、数据路径、端口和功能开关集中配置，避免散落常量。
- [ ] 删除或解释 `dist/index.html` 被跟踪而 assets 被忽略的不一致；明确构建产物是否进仓库。
- [ ] 生成并发布 SBOM，记录 Node/Electron/基础镜像版本与安全支持周期。

## 性能与可靠性

- [ ] 使用 `React.lazy`/动态 import 拆分日记、Agent、KaTeX、完成画廊和设置；为每块提供稳定 skeleton/error boundary。
- [ ] 设首屏 JS 预算、各异步 chunk 预算和 CI 回归阈值；当前约 679 KB 主包先降至合理基线。
- [ ] ReactMarkdown/KaTeX 仅在需要渲染的视图加载；列表预览避免全量公式渲染。
- [ ] 大 Board 只渲染视口附近内容或采用分层缓存；SVG 连线避免每次微小 state 更新全量重算。
- [ ] 拖拽使用 `requestAnimationFrame` 合并更新，避免 layout thrashing。
- [ ] 日记使用游标分页与虚拟列表，搜索做索引/FTS 前先测量真实规模。
- [ ] 建立冷启动、恢复会话、首次绘制、交互可用、保存延迟和内存占用指标。
- [ ] 低性能设备与大数据量出现降级时明确提示，不能静默丢内容。
- [ ] 所有网络请求有 timeout、取消、有限重试和退避；写请求使用幂等键。
- [ ] 提供健康检查：数据库、数据目录权限、剩余磁盘、网关、模型连接分别显示状态。
- [ ] 崩溃后可生成用户确认发送的脱敏诊断包；默认本地保存并可删除。

## 开源与协作治理

- [ ] 增加明确 LICENSE；没有许可证时外部用户无法确定使用和贡献权利。
- [ ] 增加 `CONTRIBUTING.md`：环境、测试、架构边界、编码规范、数据安全红线。
- [ ] 增加 `SECURITY.md`：支持版本、私下报告方式、响应流程、敏感问题披露规则。
- [ ] 维护 `CHANGELOG.md`，按 Added/Changed/Fixed/Security 记录用户能感知的变化。
- [ ] 增加 issue 模板：bug、功能建议、数据恢复、安全问题；安全问题不走公开 issue。
- [ ] 增加 PR 模板和 CODEOWNERS，数据库、认证、备份、Agent 执行路径要求专项审查。
- [ ] 架构文档补充当前真实数据流、信任边界、三种运行模式差异和恢复流程图。
- [ ] 删除过期 worklog 或标注历史状态，防止新贡献者把旧计划当现状。
- [ ] 文档示例全部使用虚构独立数据，不提供会覆盖用户 Board 的执行脚本。
