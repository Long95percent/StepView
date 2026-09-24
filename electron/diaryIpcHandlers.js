/**
 * 日记的 IPC 通道定义。
 *
 * 抽成独立模块，是为了让"桌面模式走 IPC、家庭模式走 HTTP"这两条路能被同一组用例打穿
 * （见 tests/diaryChannelParity.test.js）。两边共用同一个 diaryService，参数映射与错误码
 * 也必须一致——否则同一件小事在两种模式下给出不同结果，而这是最容易悄悄漂移的地方。
 *
 * 这里只做参数搬运，不写业务规则。
 */
export function createDiaryIpcHandlers({ getContext } = {}) {
  if (typeof getContext !== "function") throw new Error("createDiaryIpcHandlers requires a getContext function.");

  return {
    "diary:list": (_event, options = {}) => getContext().diaryService.list(options || {}),
    "diary:get": (_event, request = {}) => getContext().diaryService.get(request.diaryId),
    "diary:create": (_event, input = {}) => getContext().diaryService.create(input),
    "diary:update": (_event, request = {}) =>
      getContext().diaryService.update(request.diaryId, request, { expectedRev: request.expectedRev ?? request.rev }),
    "diary:trash": (_event, request = {}) => getContext().diaryService.trash(request.diaryId),
    "diary:restore": (_event, request = {}) => getContext().diaryService.restore(request.diaryId),
    "diary:remove": (_event, request = {}) => getContext().diaryService.remove(request.diaryId),
    "diary:search": (_event, options = {}) => getContext().diaryService.search(options || {}),
    "diary:timeline": (_event, options = {}) => getContext().diaryService.timeline(options || {}),
    "diary:tags": () => getContext().diaryService.listTags(),
    "diary:list-revisions": (_event, request = {}) => getContext().diaryService.listRevisions(request.diaryId, request),
    // 节点界面专用：上半段的原生日记，和下半段的日期按钮排。
    "diary:list-node-entries": (_event, request = {}) => getContext().diaryService.listNodeEntries(request.nodeId, request),
    "diary:list-daily-days": (_event, request = {}) => getContext().diaryService.listDailyDaysForNode(request.nodeId, request),
    "diary:preview-node-notes": async () => {
      const context = getContext();
      await context.boardStorage.flushWrites();
      return context.diaryService.previewNodeNoteImport(await context.boardStorage.readBoard());
    },
    "diary:import-node-notes": async (_event, input = {}) => {
      const context = getContext();
      await context.boardStorage.flushWrites();
      return context.diaryService.importNodeNotes(await context.boardStorage.readBoard(), input || {});
    },
  };
}
