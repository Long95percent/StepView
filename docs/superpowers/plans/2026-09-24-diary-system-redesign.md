# StepView 日记系统重构实施计划（每日日记 / 节点日记）

> 状态：仅实施计划，当前不直接实现功能。
> 前置阅读：`docs/superpowers/plans/2026-09-24-database-layer-refactor.md`
> 数据库地基（Phase 0-5）与日记数据层/服务层（Phase 6）已完成。**日记界面是 Phase 6 明确留下的遗留项，目前一行都没有。**

## 零、已确认的决策与注意点

以下条目**已与需求方确认**，是要执行的约定，不是待讨论的选项。后文所有阶段都必须遵守。

### 已确认的决策

| # | 决策 | 落点 |
| --- | --- | --- |
| D1 | 日记板块用**顶层视图切换**（`画布 / 日记`）承载。**这是当前选定的做法，先按这个做**；后续若日记重到需要独立窗口，再重新评估 | 6.1 决策 1、Phase 3 |
| D2 | 前端**必须拆组件**，在 `src/diary/` 下立边界，不再往 `main.jsx` 里堆 | 6.1 决策 2、Phase 3 |
| D3 | 两种运行模式**只有一套界面代码**；`browserGatewayApi` 必须补出与 preload **同名同形**的 `diary` 命名空间 | 6.1 决策 3、Phase 2 |
| D4 | 类型 `kind` 必须**显式存字段**，不靠关联推导 | 五、Phase 1 |
| D5 | 节点日记"必须挂节点"用**事务内校验 + 全库不变量测试**双保险 | 五、Phase 1 |
| D6 | `node.detail` **永不自动改写**，接入日记系统走非破坏导入 | Phase 5 |

### 已确认的注意点

| # | 注意点 | 不改的后果 |
| --- | --- | --- |
| N1 | `isCanvasPanTarget`（`src/main.jsx:126`）白名单要加 `.diaryPopover` / `.diaryBackdrop` | 点弹层会拖动画布 |
| N2 | 日期弹层**渲染在 shell 层、用屏幕坐标**，不能塞进节点卡片 | 节点在带 transform 的世界坐标里，弹层会被一起缩放、甚至被画布视口裁掉 |
| N3 | 键盘监听要放行弹层与输入框内的按键 | 按 Delete / Backspace 会被当成删节点 |
| N4 | 排好 z-index：画布 < sidebar < 日记弹层 < 设置弹窗（现有 `.agentDrawer`=9、`.modalBackdrop`=10） | 弹层被遮挡，或反过来压住设置弹窗 |
| N5 | 报错统一走 `setToast` | 出现第二套报错 UI |
| N6 | 一天允许多条每日日记，日期按钮去重 + 计数角标 | 出现"一天只能写一条"的隐性限制 |
| N7 | 回填只认 `source='node-note-import'`，**不按关联回填** | 每日日记被误判成节点日记，从主视图消失 |
| N8 | 文案只改日记这一块，不顺手改画布文案 | 一次改动牵动全站 |

## 一、需求

把用户的话拆成六条可验收的条款：

1. 日记是一套**独立系统**，专门用来记每天的日记。
2. 每日日记**可以**关联到某个节点，也可以不关联。
3. 节点上的原生日记叫**节点日记**，它属于同一套日记系统，但**必须**关联一个节点。
4. 一个节点允许关联**无数条**日记；一条日记也可以关联**无数个**节点。
5. 点开节点，能看到原生日记，也能通过**标有日期的按钮**查看对应的每日日记。
6. 在节点里看每日日记时，**默认弹出面板**展示，不进入日记的专门面板。

## 二、术语

| 术语 | 含义 | 节点关联 | 日期语义 |
| --- | --- | --- | --- |
| 每日日记（daily） | 以"天"为单位的日记，日记板块的主视图 | 0..n，可选 | `occurred_day` 是核心字段 |
| 节点日记（node） | 挂在节点上的日记 | **≥1，必填** | 有 `occurred_at`，但不参与"按天"主视图 |
| 节点原生日记 | 画布上 `node.detail` 那段文本（历史形态） | 天然属于 1 个节点 | 无 |

## 三、后端现状（已核实的部分）

### 已经有的，不要重做

- **表结构**：`electron/db/migrations/0008-diary.sql` 已建 `diary_entries` / `diary_links` / `diary_tags` / `diary_entry_tags` / `diary_revisions` / `diary_fts`。
- **多对多已经满足需求 4**：`diary_links` 的唯一约束是 `UNIQUE (diary_id, target_type, target_id)`，
  一条日记可以有任意多条 link 行，一个节点也可以被任意多条日记关联。**这一层不用改表。**
- **业务层**：`electron/diaryService.js`（账号隔离、校验、回收站、时间线、节点备注导入）。
- **双通道**：Electron IPC `diary:*`（`electron/main.js:224`、`electron/preload.js:41`）与家庭 HTTP `/api/diary*`（`electron/gateway/familyHttpServer.js:171`），两边共用同一个 service。
- **审批接入**：Agent 只能通过 `diary_change` 提案写日记，用户批准后才落库。

### 后端缺的

| # | 缺口 | 位置 | 后果 |
| --- | --- | --- | --- |
| 1 | **没有"类型"字段** | `diary_entries` 只有 `source`，靠它区分不了"每日"和"节点" | 需求 2 / 3 无法表达 |
| 2 | **没有"节点日记必须挂节点"的约束** | 仓储层不校验 | 需求 3 的"必须"会退化成口头约定 |
| 3 | HTTP 缺还原入口 | `familyHttpServer.js` 的 DELETE 只区分 trash / purge，没有 restore 路由 | 家庭模式回收站还原不了 |
| 4 | 节点原生日记还躺在画布 JSON 里 | `node.detail` | 需求 5 的"原生日记"没进入日记系统 |

### 实测数据（决定迁移策略）

对 `.stepview-family-data` 的真实数据查过：

- `diary_entries`：**0 行**；`diary_links`：**0 行**。
- 画布 6 个节点，**6 个都有 `detail` 文本**。

结论：**日记表没有历史数据，加字段加约束几乎没有迁移风险**；真正的存量是画布上的 `node.detail`。

## 四、前端现状（为什么你完全看不到日记）

不是藏起来了，是**真的没写**。

| 事实 | 位置 | 影响 |
| --- | --- | --- |
| `main.jsx` 是**唯一**的 JSX 文件，`src/` 下没有任何组件目录 | `src/main.jsx`（1457 行） | 整套日记界面要从零搭，且项目此前没有既有的组件拆分约定 |
| `main.jsx` 里**没有任何 diary 引用** | `src/main.jsx` | 界面上一点入口都没有 |
| 家庭模式的 API 客户端**没有 diary** | `src/browserGatewayApi.js` | 就算做了界面，家庭模式（Docker 那套）也拿不到数据 |

### 必须服从的既有架构

- 布局：`.shell { grid-template-columns: 300px 1fr }` —— 左 `aside.sidebar`，右 `section.canvas`。
- 抽屉：`aside.agentDrawer` 固定在右侧（z-index 9），靠 `.open` class 滑入。
- 弹窗：`.modalBackdrop`（fixed，z-index 10，居中 `place-items:center`）+ `.modal` 面板。
- 报错：统一 `setToast(message)`。
- 画布是**带 transform 的世界坐标**：节点 `position:absolute; transform: translate(-50%,-50%)`，跟随 viewport 的 `x/y/scale` 一起缩放。
- `isCanvasPanTarget`（`src/main.jsx:126`）白名单决定"点这里算不算拖画布"：
  `.node, .sticker, .contextMenu, .modalBackdrop, .galleryBackdrop, .linkHandle, .crossTaskEdgeHit`。

## 五、目标数据模型（后端）

只动一处，加一个显式类型列：

```sql
ALTER TABLE diary_entries ADD COLUMN kind TEXT NOT NULL DEFAULT 'daily';  -- daily | node
CREATE INDEX IF NOT EXISTS idx_diary_kind ON diary_entries(account_id, kind, occurred_at DESC);
```

### 为什么必须显式存 `kind`，不能靠关联推导

需求 2 说每日日记**也可以**关联节点。所以"有没有 node 关联"无法区分两种日记——
一条不挂节点的可能是每日日记，一条挂着节点的也可能是每日日记。类型是条目的固有属性，必须存下来。

### 规则表

| `kind` | 节点关联数 | `occurred_day` | 出现在哪里 |
| --- | --- | --- | --- |
| `daily` | 0..n | 必填，按用户时区算 | 日记板块主视图、节点上的日期按钮 |
| `node` | **≥1** | 填了但不作主视图 | 节点展开后的"原生日记"列表 |

### "必须挂节点"怎么强制

SQLite 无法跨表 `CHECK`，触发器也没法做延迟校验（插入条目的那一刻关联还没写）。所以：

- 在仓储的**同一个事务**里，写完 links 之后校验 `kind='node'` 的条目至少有 1 条 `target_type='node'` 的关联；
  不满足就抛错，事务整体回滚。校验失败等于什么都没写，不会留下半条脏数据。
- 反向也拦：把节点日记的最后一条节点关联解绑时，直接拒绝。
- 校验规则同时放进 `src/diaryCore.js`（前端与主进程共用的纯函数），让界面在提交前就能提示，而不是等报错。
- 新增一条不变量测试：全库扫描，不允许存在 `kind='node'` 却零 node 关联的条目。

### 节点被删除时怎么办

沿用现有策略，**不动用户写的内容**：`diary_links` 不删，只打 `orphaned_at`（`markLinksOrphaned` 已实现）。
节点日记因此可能变成"关联已失效"，界面上标注"原节点已删除"，但正文一个字都不丢。

## 六、前端设计

### 6.1 三项已确认的决策

#### 决策 1（D1，已确认）：日记板块放在顶层视图切换里

`main.jsx` 现在右侧 `1fr` 列永远渲染画布。日记是"独立板块"，所以在这一列里做**视图切换**：`画布 / 日记`，侧栏不动。

理由：不用新开窗口、不用改 `.shell` 网格、切回画布时 viewport 和选中状态都还在。
不选"A 第三个抽屉"的原因：抽屉适合辅助工具（Agent），不适合承载一个完整板块的浏览与检索。

**这是当前选定的做法，先按这个做。** 切换点只落在 `main.jsx` 的一处状态上，
所以将来若日记重到需要独立窗口或第三个抽屉，改动成本被限制在这一个地方，不会牵动 `src/diary/` 下的组件。

#### 决策 2（D2，已确认）：必须拆组件，不能继续往 `main.jsx` 里塞

`main.jsx` 已经 1457 行，再塞一整套日记界面会到 2500+ 行，没法维护。
这是本项目**第一次**拆 React 组件，所以先把约定写死：

```
src/diary/
  diariesView.jsx       日记板块（按天 / 时间线 / 搜索 / 标签 / 回收站）
  diaryEditor.jsx       新建 / 编辑表单
  nodeDiarySection.jsx  节点内的"原生日记 + 日期按钮排"
  dayDiaryPopover.jsx   点日期按钮弹出的那一层
  diaryApi.js           统一数据入口：Electron 走 IPC，家庭模式走 HTTP
  diaryViewCore.js      纯函数：按天分组、日期去重、chip 排序、摘要（可单测）
```

`main.jsx` 只负责：视图切换状态、把 `desktopApi` 传下去、以及和画布选中项的联动。

#### 决策 3（D3，已确认）：两种运行模式只能有一套界面代码

`main.jsx:57` 现在是 `const desktopApi = window.stepview || createBrowserGatewayApi();`

Electron 下 `desktopApi.diary` 是 preload 暴露的**命名空间对象**（`electron/preload.js:41`）：

```
diary: { list, get, create, update, trash, restore, remove,
         search, timeline, listTags, listRevisions,
         previewNodeNotes, importNodeNotes }
```

家庭模式下的 `createBrowserGatewayApi()` **一个都没有**。所以：

- `browserGatewayApi` 必须补出一个**同名同形的 `diary` 命名空间**，方法名与 IPC 通道一一对应。
- 界面只写 `desktopApi.diary.list(...)`，两种模式共用一套代码。

（此处更正上一版计划：不是平铺的 `listDiary / getDiary`，必须和 preload 的 `diary: { ... }` 形状完全一致，否则
`main.jsx` 里会出现 "Electron 走一个名字、浏览器走另一个名字" 的分叉。）

### 6.2 界面清单

#### C1. 日记板块（独立视图）

布局：左列表 + 右详情。这是本项目首次出现双栏，但比"全屏弹窗"更适合按天翻阅。

顶部工具条：

- 视图切换：`按天` / `时间线`
- 搜索框（复用混合检索：三字以上走 FTS5 trigram，两字回退 LIKE）
- 标签筛选（复用 `listTags`）
- 回收站开关
- 主按钮：`写今天`

按天视图：

- 按 `occurred_day` 分组，组头显示日期 + 当天条数
- 每条显示：时间、标题或首行摘要、标签、关联节点小标签
- 关联节点小标签点一下 → 切回画布并选中该节点（复用现有选中逻辑）

时间线视图：复用 `diaryService.timeline` 的返回形态。

状态处理：

- 空态：`还没有日记。` + `写今天` 按钮
- 加载态：骨架或 `Loading...`（沿用画布的朴素做法）
- 错误：一律 `setToast`

#### C2. 日记编辑器

- 字段：日期、标题、正文、标签、关联节点（多选）
- **`kind` 不作为界面字段暴露**：从日记板块进就是每日日记，从节点进就是节点日记。类型是内部概念，不该让用户理解。
- 版本冲突（`DIARY_REVISION_CONFLICT`，409）：提示"这条日记在别处改过"并给"重新载入"，**不静默覆盖**

#### C3. 节点里的日记区（`nodeDiarySection.jsx`）

挂在节点卡片展开区（现在 `selectedNodeId === node.id` 那段）下方，分上下两段：

- **上半 · 原生日记**：该节点的 `kind='node'` 日记，按时间倒序。底部一个 `+ 写一条节点日记`。
- **下半 · 日期按钮排**：该节点关联的 `kind='daily'` 日记，按 `occurred_day` **去重、倒序**排成一行芯片按钮，
  按钮文字是日期，带条数角标（一天有多条时显示）。
- 空态文案要区分两个入口："写一条节点日记" vs "查看某天的每日日记"，避免用户不知道点哪个。

#### C4. 当日日记弹层（`dayDiaryPopover.jsx`）

点日期按钮 → 弹出，展示**那一天关联到该节点的全部每日日记**，可就地编辑。

- **默认弹层，不切换视图**（需求 6）
- **必须渲染在 shell 层、用屏幕坐标**，不能塞进节点卡片里。
  节点在带 transform 的画布世界坐标里，塞进去会跟着缩放，还可能被画布视口裁掉。
  实现上：把"当前打开的日期 + 节点 id"作为 `main.jsx` 的状态，弹层渲染在 `.shell` 的兄弟层级。
- 弹层内给一个次级入口 `在日记板块中打开`（可选动作，不是默认）
- `Esc` 关闭；点背板关闭

### 6.3 必须同步改动的公共设施

这几处不改，新界面就会有"点一下就拖了画布""弹层压不住"这类毛病：

| 位置 | 改动 | 不改的后果 |
| --- | --- | --- |
| `isCanvasPanTarget`（`src/main.jsx:126`） | 白名单加 `.diaryPopover`、`.diaryBackdrop` | 点弹层会触发画布平移 |
| 键盘监听（`main.jsx` 的 `keydown`） | 放行弹层/输入框内的按键 | Delete / Backspace 会被当成删节点 |
| 层级（z-index） | 画布 < sidebar < diary 弹层；与 `.agentDrawer`(9)、`.modalBackdrop`(10) 排好序 | 弹层被遮挡或压住设置弹窗 |
| `setToast` | 日记所有失败路径统一走它 | 出现第二套报错 UI |

### 6.4 文案语言

现状是**混的**：画布和侧栏是英文（`Tutorial ✨` / `Settings ⚙️` / `No details yet.`），
更新的 Agent 抽屉是中文（`收起` / `会话` / `待确认的修改`）。

日记整块建议**统一中文**，和 Agent 面板保持一致。
边界：**只做日记这一块，不顺手改画布文案**，避免一次改动牵动全站。

### 6.5 样式

复用现有 token，不引入新色板：

- 面板底 `rgba(9,12,28,.92)` / `#10162d`；背景 `#070912`
- 边框 `rgba(255,255,255,.12~.14)`
- 圆角：芯片 10、输入 14、卡片 18~24、弹层 24~28
- 次要文字 `#aab9d4` / `#9fb2d2`；标题 `#dbe8ff`
- 毛玻璃 `backdrop-filter: blur(...)`，配 `color-scheme: dark`

新增 class 统一用 `diary*` 前缀，避免和现有的 `.node` / `.modal` / `.agentDrawer` 撞名。

### 6.6 前端怎么测

本项目现在没有前端组件测试（`tests/` 全是 Node 侧），所以：

- 可抽成纯函数的逻辑（按天分组、日期去重、chip 排序、摘要）放进 `diaryViewCore.js`，**加单元测试**，
  沿用现有 `src/*Core.js` + `tests/*.test.js` 的写法。
- **不引入新的测试框架**（不加 jsdom / testing-library 依赖），组件靠 `npm run build` + 手动验收清单。
- 手动验收清单：

  1. 切到日记板块，写一条每日日记，不关联节点 → 出现在按天视图对应日期下。
  2. 同一天再写一条 → 同一天显示两条，日期按钮角标显示 2。
  3. 从节点里写一条节点日记 → 出现在该节点"原生日记"里。
  4. 给节点日记取消全部节点关联 → 被界面拦截，写不进去。
  5. 点节点上的日期按钮 → 弹层出现，**当前视图没有改变**，画布没被拖动。
  6. 把一条每日日记关联到两个节点 → 两个节点的日期按钮排里都能看到它。
  7. 删掉一个被日记关联的节点 → 日记还在，标注"原节点已删除"。
  8. 回收站里还原一条日记 → 回到按天视图。
  9. 家庭模式（`localhost:5173`）与桌面模式各跑一遍 1-8。

## 七、实施阶段

每个阶段独立提交、独立可验证、可随时停下。前一个阶段不完成不开下一个。

### Phase 1：数据模型加 `kind` 与不变量约束（落实 D4、D5、N7）

- [ ] 迁移 `electron/db/migrations/0009-diary-kind.sql`：加 `kind` 列与 `idx_diary_kind` 索引。
- [ ] 回填：只把 `source='node-note-import'` 的条目判为 `node`，其余留 `daily`。
      **不根据"有没有节点关联"回填**——那会把"某天顺手关联了节点"的每日日记误判成节点日记，
      而误判成 `node` 会让它从日记板块主视图消失，属于对用户数据的静默破坏。
- [ ] `src/diaryCore.js`：新增 `DIARY_KINDS = ['daily','node']`；`normalizeDiaryInput` 校验 `kind`，
      并在 `kind='node'` 且没有任何 node 关联时抛 `DiaryInputError`。
- [ ] `electron/db/repositories/diaryRepository.js`：`create` / `update` / `syncLinks` 全部带上 `kind`；
      事务内做"node 必须 ≥1 关联"的校验；解绑最后一条节点关联时报错回滚。
- [ ] `list` / `search` / `timeline` 支持按 `kind` 过滤。
- [ ] 测试：`tests/diaryCore.test.js` 补 kind 校验；`tests/diaryRepository.test.js` 补
      "node 无关联必须报错并回滚""解绑最后一条被拒""按 kind 过滤"。
- [ ] 验证：`npm test` 全绿。

### Phase 2：业务层与双通道对齐（前端开工的前提）（落实 D3）

- [ ] `electron/diaryService.js`：`create` / `update` / `planChange` 透传并校验 `kind`。
- [ ] 新增两个查询口径，专门喂节点界面：
      `listNodeEntries(nodeId)` → 该节点的原生日记；
      `listDailyDaysForNode(nodeId)` → 去重后的 `{ day, count }[]`，正好是日期按钮排的数据。
- [ ] HTTP：`/api/diary` 列表支持 `kind` 参数；补 `restore` 路由。
- [ ] **补 `src/browserGatewayApi.js` 的 `diary` 命名空间**，方法名与 `electron/preload.js:41` 完全一致。
- [ ] `src/diary/diaryApi.js`：包一层薄适配，界面只认这一个入口。
- [ ] 测试：`tests/diaryService.test.js` 补 kind 与两个新查询；
      `tests/familyHttpServer.test.js` 补 kind 过滤与 restore；
      **新增 `tests/diaryChannelParity.test.js`**：同一组用例分别打 IPC 与 HTTP，断言返回结构和错误码一致。
- [ ] 验证：`npm test` 全绿。

### Phase 3：前端骨架 + 日记板块（落实 D1、D2、N5、N6、N8）

- [ ] `main.jsx` 加视图切换状态（`画布 / 日记`），右侧 `1fr` 列按状态渲染（**D1**，当前选定做法）。
- [ ] 新建 `src/diary/diariesView.jsx`：按天视图、时间线视图、搜索、标签筛选、回收站。
- [ ] 新建 `src/diary/diaryEditor.jsx`：新建/编辑，含关联节点多选。
- [ ] 新建 `src/diary/diaryViewCore.js` + 单元测试（按天分组、日期去重、排序、摘要）。
- [ ] `styles.css` 加 `diary*` 样式，复用现有 token。
- [ ] 处理空态 / 加载态 / 错误态；409 冲突给出"重新载入"；所有失败路径走 `setToast`（**N5**）。
- [ ] 按天视图同一天允许多条并列展示，不做合并（**N6**）。
- [ ] 日记界面文案统一中文，且**不改动**画布既有文案（**N8**）。
- [ ] 验收：手动清单 1、2、8 通过（先跑桌面模式）。
- [ ] 验证：`npm run build` 通过、`npm test` 全绿。

### Phase 4：节点侧界面 + 当日弹层（落实 N1、N2、N3、N4）

- [ ] 新建 `src/diary/nodeDiarySection.jsx`：接进节点展开区，上半原生日记、下半日期按钮排。
- [ ] 新建 `src/diary/dayDiaryPopover.jsx`：**渲染在 shell 层、用屏幕坐标**，**不切换视图**（**N2**）。
- [ ] 改 `isCanvasPanTarget`（`src/main.jsx:126`）白名单，加 `.diaryPopover` / `.diaryBackdrop`（**N1**）。
- [ ] 改键盘监听，放行弹层与输入框内的按键（**N3**）。
- [ ] 排好 z-index 层级（画布 < sidebar < 日记弹层 < 设置弹窗）（**N4**）。
- [ ] 验收：手动清单 3-7、9 通过（桌面模式 + 家庭模式各一遍）。
- [ ] 验证：`npm run build` 通过、`npm test` 全绿。

### Phase 5：节点原生日记接入日记系统（非破坏）（落实 D6）

- [ ] 复用现有 `previewNodeNoteImport` / `importNodeNotes` 的**非破坏**模式：
      先预览、显式确认、**`node.detail` 原文一个字都不删**、幂等（已导过的节点不再重复导）。
- [ ] 导入产生的条目改为 `kind='node'`（现在是 `source='node-note-import'` 的普通条目）。
- [ ] 导入入口放在节点日记区，做成一个明确的按钮 + 预览弹窗，**不做自动导入**。
- [ ] 导入完成后节点区以节点日记为准；`node.detail` 保留为画布字段，作为只读历史折叠展示。
- [ ] 绝不做的事：不自动导入、不在用户没确认时改写画布、不删除任何 `detail` 文本。
- [ ] 测试：补"导入后原文逐字节相同""重复导入幂等""导入条目 kind 为 node"。
- [ ] 验证：`npm test` 全绿。

### Phase 6：Agent 接入与文档

- [ ] Agent 的 `diary.propose_entry` 提案带上 `kind`，提案摘要里说清是"节点日记"还是"每日日记"。
- [ ] `src/agentMemory.js` 里引用日记信号的部分适配 `kind`（当前按 `diarySignals` 取，需确认口径）。
- [ ] 更新 `docs/使用说明书.md` 与 `docs/ARCHITECTURE_AND_EXTENSION_GUIDE.md`。
- [ ] 验证：`npm test` 全绿、`npm run build` 通过。

## 八、迁移规则

1. 迁移只做加列与建索引，**不删列、不改旧值**。
2. 回填只认 `source='node-note-import'` 这一条明确信号，其余一律 `daily`。
3. 迁移在事务内完成；`schema_migrations` 记录版本，校验和不匹配直接拒绝启动。
4. 任何阶段中断都能重来，旧数据文件永不删除。
5. 画布 JSON 里 `node.detail` 在 Phase 5 之前完全不动；Phase 5 之后依然不删。

## 九、测试清单

- **core**：`kind` 取值校验；`kind='node'` 无关联报错；一天多条的日期去重。
- **repository**：事务内不变量（node 必须 ≥1 关联）；解绑最后一条被拒；按 `kind` 过滤；孤儿标记不因编辑被抹掉。
- **service**：kind 透传；`listNodeEntries` / `listDailyDaysForNode` 的口径；账号隔离。
- **双通道一致性**：同一套用例分别走 IPC 与 HTTP，行为与错误码必须一致。
- **前端纯函数**：按天分组、日期去重、chip 排序、摘要。
- **不变量**：全库扫描，不存在 `kind='node'` 且零 node 关联的条目。
- **非破坏性**：节点备注导入前后 `node.detail` 逐字节相同。

## 十、风险与处理

| 风险 | 处理 |
| --- | --- |
| 误把每日日记回填成节点日记，导致它从主视图消失 | 只认 `source='node-note-import'`；不按关联回填 |
| 不变量校验失效，库里出现无关联的节点日记 | Phase 1 的仓储事务校验 + 全库不变量测试 |
| 前端一次性铺得太开，`main.jsx` 继续膨胀 | Phase 3 之前先立好 `src/diary/` 目录边界；`main.jsx` 只留视图切换与联动 |
| 节点弹层与画布手势冲突 | `isCanvasPanTarget` 白名单 + Phase 4 验收项 |
| 家庭模式与桌面模式行为不一致 | 双通道共用同一个 service；Phase 2 的 parity 测试；手动清单第 9 条 |
| 一天多条每日日记让界面变复杂 | 日期按钮去重 + 计数角标，弹层内按时间列出 |
| 日记文案语言和其他区域不一致 | 明确只做日记这一块，不顺手改画布文案 |

## 十一、完成标准

- 日记板块可以独立使用：按天、时间线、搜索、标签、回收站都可用。
- 节点展开后能看到原生日记列表，并通过日期按钮在弹层里看到当天的每日日记，**不跳转视图**。
- 一个节点可关联任意多条日记；一条日记可关联任意多个节点。
- 节点日记在没有节点关联时**写不进去**（界面拦截 + 仓储拒绝 + 全库不变量测试）。
- 桌面模式（Electron IPC）与家庭模式（HTTP）界面代码只有一套，行为一致。
- `node.detail` 在整条链路上从未被自动改写或删除。
- `npm test` 与 `npm run build` 通过。
- 「零、已确认的决策与注意点」里的 **D1-D6 与 N1-N8 全部落地**，且每一条都有对应的检查手段（自动化测试、手动验收清单条目，或代码位置改动）。

## 十二、不包含

- 多设备实时同步。
- 日记加密。
- 富文本编辑器（先用纯文本 + 现有标签/检索能力）。
- 每日日记"一天只能一条"的强约束。
- 拆分 `main.jsx` 里画布和 Agent 的既有代码（本次只为日记立组件边界）。
- 迁移到外部数据库。
