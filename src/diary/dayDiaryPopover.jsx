import React from "react";
import { summarizeDiaryEntry } from "../diaryCore";
import { DiaryEditor } from "./diaryEditor";
import { formatDayHeading, formatEntryTime, placePopover } from "./diaryViewCore";

/**
 * 点节点上某个日期按钮后弹出的当日面板。
 *
 * 展示的是"那一天 **关联到这个节点** 的每日日记"，不是那天全部的日记：
 * 用户是从某个节点点进来的，看到的就该是跟这个节点有关的那部分。
 *
 * **不切换视图**（需求 6）。渲染在 shell 层、用屏幕坐标（N2），否则会跟着画布一起缩放、
 * 甚至被画布视口裁掉。
 */
export function DayDiaryPopover({ api, nodeId, nodeLabel, day, anchor, nodeOptions = [], revision = 0, onToast, onClose, onOpenBoard, onChanged }) {
  const [entries, setEntries] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editor, setEditor] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [conflictId, setConflictId] = React.useState(null);

  const toastRef = React.useRef(onToast);
  React.useEffect(() => {
    toastRef.current = onToast;
  });

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.list({ kind: "daily", targetType: "node", targetId: nodeId, from: day, to: day, limit: 100 });
      setEntries(list);
    } catch (error) {
      setEntries([]);
      toastRef.current?.(`当天的日记加载失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, nodeId, day, revision]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function act(action, diaryId, message) {
    try {
      await action(diaryId);
      toastRef.current?.(message);
      await load();
      onChanged?.();
    } catch (error) {
      toastRef.current?.(`操作失败：${error.message}`);
    }
  }

  async function saveDraft(payload) {
    setBusy(true);
    try {
      await api.update({ ...payload, diaryId: editor.entry.diaryId, rev: editor.entry.rev });
      setEditor(null);
      setConflictId(null);
      toastRef.current?.("日记已保存。");
      await load();
      onChanged?.();
    } catch (error) {
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

  const placed = placePopover(anchor, { width: window.innerWidth, height: window.innerHeight });

  return (
    <>
      <div className="diaryBackdrop" onPointerDown={onClose} />
      <section
        className="diaryPopover"
        role="dialog"
        aria-label="当天的每日日记"
        style={{ left: placed.left, top: placed.top, bottom: placed.bottom, width: placed.width, maxHeight: placed.maxHeight }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="diaryPopoverHead">
          <div>
            <strong>{formatDayHeading(day)}</strong>
            <small>{nodeLabel ? `关联到 ${nodeLabel}` : "这个节点的每日日记"}</small>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="关闭">✕</button>
        </header>

        <div className="diaryPopoverBody">
          {loading && <p className="diaryHint">正在载入…</p>}
          {!loading && entries.length === 0 && (
            <p className="diaryHint">这一天还没有关联到这个节点的每日日记。在日记板块写一条并关联它，就能在这里看到。</p>
          )}
          {entries.map((entry) => (
            <article key={entry.diaryId} className="diaryPopoverEntry">
              <header>
                <time>{formatEntryTime(entry.occurredAt)}</time>
                {entry.title && <strong>{entry.title}</strong>}
              </header>
              <p>{summarizeDiaryEntry(entry, { length: 200 }) || "（空）"}</p>
              <div className="nodeDiaryActions">
                <button type="button" onClick={() => { setConflictId(null); setEditor({ mode: "edit", entry }); }}>编辑</button>
                <button type="button" onClick={() => act(api.trash, entry.diaryId, "已移入回收站。")}>删除</button>
              </div>
            </article>
          ))}
        </div>

        <footer className="diaryPopoverFoot">
          <button type="button" className="ghost" onClick={() => onOpenBoard?.(day)}>在日记板块中打开 →</button>
        </footer>

        {editor && (
          <DiaryEditor
            key={`${editor.entry?.diaryId ?? "new"}:${editor.entry?.rev ?? 0}`}
            entry={editor.entry ?? null}
            kind="daily"
            nodeOptions={nodeOptions}
            busy={busy}
            conflict={conflictId === editor.entry?.diaryId}
            onCancel={() => { setEditor(null); setConflictId(null); }}
            onSubmit={saveDraft}
            onReload={reloadConflict}
          />
        )}
      </section>
    </>
  );
}
