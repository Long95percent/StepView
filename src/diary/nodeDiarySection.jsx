import React from "react";
import { summarizeDiaryEntry } from "../diaryCore";
import { DiaryEditor } from "./diaryEditor";
import { formatDayChip, formatEntryTime } from "./diaryViewCore";

/**
 * 节点展开区里的日记块。
 *
 * 分上下两段是有意为之：
 *   - 上半是这个节点自己的原生日记（kind='node'，必须挂在这个节点上）；
 *   - 下半是"这个节点出现在哪些天里"——关联到它的每日日记，按天去重成日期按钮。
 * 两段的空态文案必须分开写：一个是"写一条节点日记"，一个是"去写某天的每日日记"，
 * 合成一句话用户就不知道该点哪个。
 *
 * 数据只从 api（src/diary/diaryApi.js）来，和日记板块共用同一个入口。
 */
export function NodeDiarySection({ api, nodeId, nodeOptions = [], revision = 0, onToast, onOpenDay, onChanged }) {
  const [entries, setEntries] = React.useState([]);
  const [days, setDays] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editor, setEditor] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [conflictId, setConflictId] = React.useState(null);

  // onToast 每次渲染都可能是新函数，放进 ref 就不必进 load 的依赖，
  // 否则"加载 → 提示 → 重渲染 → 再加载"会绕成死循环。
  const toastRef = React.useRef(onToast);
  React.useEffect(() => {
    toastRef.current = onToast;
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [nodeEntries, dayList] = await Promise.all([api.listNodeEntries(nodeId), api.listDailyDays(nodeId)]);
      setEntries(nodeEntries);
      setDays(dayList);
    } catch (error) {
      setEntries([]);
      setDays([]);
      toastRef.current?.(`节点日记加载失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, nodeId, revision]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function act(action, diaryId, message) {
    try {
      await action(diaryId);
      toastRef.current?.(message);
      await load();
      // 弹层里那排日期按钮的数据也变了，让兄弟组件一起刷新。
      onChanged?.();
    } catch (error) {
      toastRef.current?.(`操作失败：${error.message}`);
    }
  }

  async function saveDraft(payload) {
    setBusy(true);
    try {
      if (editor.mode === "edit") await api.update({ ...payload, diaryId: editor.entry.diaryId, rev: editor.entry.rev });
      else await api.create(payload);
      setEditor(null);
      setConflictId(null);
      toastRef.current?.("节点日记已保存。");
      await load();
      onChanged?.();
    } catch (error) {
      // 版本冲突不静默覆盖：留在编辑器里，让用户决定要不要重新载入。
      if (error.code === "DIARY_REVISION_CONFLICT" || error.statusCode === 409) setConflictId(editor.entry?.diaryId ?? "unknown");
      else toastRef.current?.(`保存失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function reloadConflict() {
    try {
      const fresh = await api.get(editor.entry.diaryId);
      setEditor({ mode: "edit", entry: fresh });
      setConflictId(null);
      toastRef.current?.("已载入最新内容，请重新确认这次的修改。");
    } catch (error) {
      toastRef.current?.(`重新载入失败：${error.message}`);
    }
  }

  return (
    // 整个块吞掉 pointerdown / click：节点卡片上这两个事件分别负责"拖节点"和"展开/收起"，
    // 不拦住的话在日记里点一下就会把节点拖走或把面板收起来。
    <div className="nodeDiary" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <header className="nodeDiaryHead">
        <span>📔 节点日记</span>
        {loading && <small>载入中…</small>}
      </header>

      {!loading && entries.length === 0 && <p className="nodeDiaryEmpty">这个节点还没写过日记。节点日记必须挂在这个节点上。</p>}

      {entries.map((entry) => (
        <article key={entry.diaryId} className="nodeDiaryEntry">
          <header>
            <time>{formatEntryTime(entry.occurredAt)}</time>
            {entry.title && <strong>{entry.title}</strong>}
          </header>
          <p>{summarizeDiaryEntry(entry, { length: 80 }) || "（空）"}</p>
          <div className="nodeDiaryActions">
            <button type="button" onClick={() => { setConflictId(null); setEditor({ mode: "edit", entry }); }}>编辑</button>
            <button type="button" onClick={() => act(api.trash, entry.diaryId, "已移入回收站。")}>删除</button>
          </div>
        </article>
      ))}

      <button type="button" className="nodeDiaryAdd" onClick={() => { setConflictId(null); setEditor({ mode: "create" }); }}>＋ 写一条节点日记</button>

      <header className="nodeDiaryHead nodeDiaryHeadDays">
        <span>🗓 关联的每日日记</span>
      </header>

      {!loading && days.length === 0 && (
        <p className="nodeDiaryEmpty">还没有哪天的每日日记挂到这个节点上。去日记板块写一条并关联它，这里就会多出一个日期按钮。</p>
      )}

      {days.length > 0 && (
        <div className="nodeDiaryDays">
          {days.map((item) => (
            <button
              key={item.day}
              type="button"
              className="nodeDiaryDay"
              title={`查看 ${item.day} 关联到这个节点的每日日记`}
              onClick={(event) => onOpenDay?.(item.day, event.currentTarget.getBoundingClientRect())}
            >
              {formatDayChip(item.day)}
              {item.count > 1 && <span className="nodeDiaryDayCount">{item.count}</span>}
            </button>
          ))}
        </div>
      )}

      {editor && (
        <DiaryEditor
          key={`${editor.entry?.diaryId ?? "new"}:${editor.entry?.rev ?? 0}`}
          entry={editor.entry ?? null}
          kind="node"
          defaultNodeIds={[nodeId]}
          nodeOptions={nodeOptions}
          busy={busy}
          conflict={conflictId === editor.entry?.diaryId}
          onCancel={() => { setEditor(null); setConflictId(null); }}
          onSubmit={saveDraft}
          onReload={reloadConflict}
        />
      )}
    </div>
  );
}
