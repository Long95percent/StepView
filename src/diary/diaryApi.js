/**
 * 日记的唯一数据入口。
 *
 * 桌面模式走 preload 暴露的 IPC 命名空间，家庭模式走 HTTP 客户端。两边形状完全一致
 * （见 electron/preload.js 的 `diary: { ... }` 与 src/browserGatewayApi.js 的 `diary`），
 * 所以这一层只做两件事：
 *
 *   1. 把裸 id 包成后端约定的请求对象（`{ diaryId }` / `{ nodeId }`），
 *      免得每个组件都记一遍"哪个方法要传对象、哪个要传 id"。
 *   2. 通道不存在时立刻报错，而不是等到某个组件里冒出 `undefined is not a function`。
 *
 * 界面组件只认这个入口，不直接碰 desktopApi.diary。
 */
export function createDiaryApi(desktopApi) {
  const source = desktopApi?.diary;
  if (!source) throw new Error("当前运行模式没有提供日记通道。");

  return {
    list: (options = {}) => source.list(options),
    get: (diaryId) => source.get({ diaryId }),
    create: (input = {}) => source.create(input),
    /** input 需要带 diaryId；rev / expectedRev 二选一，用来做乐观锁。 */
    update: (input = {}) => source.update(input),
    trash: (diaryId) => source.trash({ diaryId }),
    restore: (diaryId) => source.restore({ diaryId }),
    remove: (diaryId) => source.remove({ diaryId }),
    search: (options = {}) => source.search(options),
    timeline: (options = {}) => source.timeline(options),
    listTags: () => source.listTags(),
    listRevisions: (diaryId, options = {}) => source.listRevisions({ diaryId, ...options }),
    /** 某个节点的原生日记。 */
    listNodeEntries: (nodeId, options = {}) => source.listNodeEntries({ nodeId, ...options }),
    /** 某个节点关联到的每日日记，按天去重 —— 节点上那排日期按钮。 */
    listDailyDays: (nodeId, options = {}) => source.listDailyDays({ nodeId, ...options }),
    previewNodeNotes: () => source.previewNodeNotes(),
    importNodeNotes: (input = {}) => source.importNodeNotes(input),
  };
}
