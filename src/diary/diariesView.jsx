import React from "react";
import { summarizeDiaryEntry } from "../diaryCore";
import { DiaryEditor } from "./diaryEditor";
import { UNKNOWN_DAY, formatDayHeading, formatEntryTime, groupEntriesByDay, nodeLabelById } from "./diaryViewCore";

const KIND_FILTERS = [
  { id: "daily", label: "每日" },
  { id: "node", label: "节点" },
  { id: "all", label: "全部" },
];

/**
 * 日记板块。
 *
 * 数据只从 api（src/diary/diaryApi.js）来，不直接碰 desktopApi，也就不会出现
 * "桌面模式能跑、家庭模式 undefined"这种分叉。
 *
 * 同一天有多条时并列展示，不合并：一天写几条是正常用法，合并会让人以为日记被吞了。
 */
export function DiariesView({ api, nodeOptions = [], onToast, onOpenNode }) {
  const [listMode, setListMode] = React.useState("day");
  const [kind, setKind] = React.useState("daily");
  const [queryInput, setQueryInput] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [tag, setTag] = React.useState("");
  const [trashOpen, setTrashOpen] = React.useState(false);
  const [entries, setEntries] = React.useState([]);
  const [timeline, setTimeline] = React.useState([]);
  const [tags, setTags] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editor, setEditor] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [conflictId, setConflictId] = React.useState(null);

  // onToast 可能每次渲染都是新函数，放进 ref 就不会把它算进 load 的依赖里，
  // 否则"加载 → 提示 → 重渲染 → 再加载"会绕成一个死循环。
  const toastRef = React.useRef(onToast);
  React.useEffect(() => {
    toastRef.current = onToast;
  });

  const labels = React.useMemo(() => nodeLabelById(nodeOptions), [nodeOptions]);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const status = trashOpen ? "trashed" : "active";
      const kindFilter = kind === "all" ? undefined : kind;
      const filter = { status, kind: kindFilter, tag: tag || undefined, limit: 200 };
      const [list, tagList] = await Promise.all([
        query.trim() ? api.search({ ...filter, query: query.trim() }) : api.list(filter),
        api.listTags(),
      ]);
      setEntries(list);
      setTags(tagList);
      if (listMode === "timeline") setTimeline(await api.timeline({ status, kind: kindFilter }));
    } catch (error) {
      setEntries([]);
      toastRef.current?.(`日记加载失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, kind, listMode, query, tag, trashOpen]);

  React.useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setConflictId(null);
    setEditor({ mode: "create", kind: "daily", entry: null });
  }

  function openEdit(entry) {
    setConflictId(null);
    setEditor({ mode: "edit", kind: entry.kind, entry });
  }

  async function saveDraft(payload) {
    setBusy(true);
    try {
      if (editor.mode === "edit") {
        await api.update({ ...payload, diaryId: editor.entry.diaryId, rev: editor.entry.rev });
      } else {
        await api.create(payload);
      }
      setEditor(null);
      setConflictId(null);
      toastRef.current?.("日记已保存。");
      await load();
    } catch (error) {
      // 版本冲突不静默覆盖：留在编辑器里，让用户决定要不要重新载入。
      if (error.code === "DIARY_REVISION_CONFLICT" || error.statusCode === 409) {
        setConflictId(editor.entry?.diaryId ?? "unknown");
      } else {
        toastRef.current?.(`保存失败：${error.message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function reloadConflict() {
    try {
      const fresh = await api.get(editor.entry.diaryId);
      setEditor({ mode: "edit", kind: fresh.kind, entry: fresh });
      setConflictId(null);
      toastRef.current?.("已载入最新内容，请重新确认这次的修改。");
    } catch (error) {
      toastRef.current?.(`重新载入失败：${error.message}`);
    }
  }

  async function act(action, id, message) {
    try {
      await action(id);
      toastRef.current?.(message);
      await load();
    } catch (error) {
      toastRef.current?.(`操作失败：${error.message}`);
    }
  }

  const groups = React.useMemo(() => groupEntriesByDay(entries), [entries]);
  const now = new Date();

  function renderEntry(entry) {
    return (
      <article key={entry.diaryId} className="diaryEntry">
        <header>
          <time>{formatEntryTime(entry.occurredAt)}</time>
          {entry.title && <strong>{entry.title}</strong>}
          {entry.kind === "node" && <span className="diaryKindBadge">节点日记</span>}
        </header>
        <p>{summarizeDiaryEntry(entry, { length: 160 }) || "（空）"}</p>
        {(entry.tags.length > 0 || (entry.links ?? []).some((link) => link.targetType === "node")) && (
          <footer>
            {entry.tags.map((name) => <span key={name} className="diaryTag">{name}</span>)}
            {(entry.links ?? []).filter((link) => link.targetType === "node").map((link) => {
              const label = `${labels.get(link.targetId) || link.targetId}${link.orphanedAt ? "（原节点已删除）" : ""}`;
              // 原节点已经删掉了，点了也跳不到任何地方，那就不要做成按钮。
              if (link.orphanedAt || !onOpenNode) {
                return <span key={link.linkId} className="diaryNodeTag" title={link.orphanedAt ? "原节点已删除" : undefined}>📍 {label}</span>;
              }
              return (
                <button key={link.linkId} type="button" className="diaryNodeTag" title="回到画布并选中这个节点" onClick={() => onOpenNode(link.targetId)}>
                  📍 {label}
                </button>
              );
            })}
          </footer>
        )}
        <div className="diaryEntryActions">
          {trashOpen ? (
            <>
              <button type="button" className="ghost" onClick={() => act(api.restore, entry.diaryId, "已还原。")}>还原</button>
              <button type="button" className="danger" onClick={() => act(api.remove, entry.diaryId, "已彻底删除。")}>彻底删除</button>
            </>
          ) : (
            <>
              <button type="button" className="ghost" onClick={() => openEdit(entry)}>编辑</button>
              <button type="button" className="ghost" onClick={() => act(api.trash, entry.diaryId, "已移入回收站。")}>删除</button>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="diaryShell">
      <header className="diaryToolbar">
        <div className="diaryToolbarRow">
          <h1>📔 日记</h1>
          <div className="diarySegmented" role="group" aria-label="日记类型">
            {KIND_FILTERS.map((option) => (
              <button key={option.id} type="button" className={kind === option.id ? "active" : ""} onClick={() => setKind(option.id)}>{option.label}</button>
            ))}
          </div>
          <div className="diarySegmented" role="group" aria-label="视图">
            <button type="button" className={listMode === "day" ? "active" : ""} onClick={() => setListMode("day")}>按天</button>
            <button type="button" className={listMode === "timeline" ? "active" : ""} onClick={() => setListMode("timeline")}>时间线</button>
          </div>
          <button type="button" className="primary" onClick={openCreate}>写今天 ✍️</button>
        </div>
        <div className="diaryToolbarRow">
          <form className="diarySearch" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput); }}>
            <input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索日记…" />
            <button type="submit">搜索</button>
            {query && <button type="button" className="ghost" onClick={() => { setQueryInput(""); setQuery(""); }}>清除</button>}
          </form>
          {tags.length > 0 && (
            <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="按标签筛选">
              <option value="">全部标签</option>
              {tags.map((item) => <option key={item.name} value={item.name}>{item.name}（{item.count}）</option>)}
            </select>
          )}
          <button type="button" className={trashOpen ? "active ghost" : "ghost"} onClick={() => setTrashOpen((open) => !open)}>
            {trashOpen ? "退出回收站" : "回收站"}
          </button>
        </div>
      </header>

      <div className="diaryBody">
        {loading && <p className="diaryHint">正在载入…</p>}

        {!loading && listMode === "day" && groups.length === 0 && (
          <div className="diaryEmpty">
            <p>{trashOpen ? "回收站是空的。" : query ? "没有搜到符合条件的日记。" : "还没有日记。"}</p>
            {!trashOpen && !query && <button type="button" className="primary" onClick={openCreate}>写今天 ✍️</button>}
          </div>
        )}

        {!loading && listMode === "day" && groups.map((group) => (
          <section key={group.day} className="diaryDayGroup">
            <h2>
              {group.day === UNKNOWN_DAY ? UNKNOWN_DAY : formatDayHeading(group.day, { now })}
              <span className="diaryDayCount">{group.count} 条</span>
            </h2>
            {group.entries.map(renderEntry)}
          </section>
        ))}

        {!loading && listMode === "timeline" && (
          timeline.length === 0
            ? <p className="diaryHint">这段时间没有日记。</p>
            : (
              <ol className="diaryTimeline">
                {timeline.map((item) => (
                  <li key={item.diaryId}>
                    <time>{formatDayHeading(item.occurredDay, { now })}</time>
                    <strong>{item.title || "（无标题）"}</strong>
                    <p>{item.summary || "（空）"}</p>
                  </li>
                ))}
              </ol>
            )
        )}
      </div>

      {editor && (
        <DiaryEditor
          entry={editor.entry}
          kind={editor.kind}
          nodeOptions={nodeOptions}
          busy={busy}
          conflict={conflictId === editor.entry?.diaryId}
          onCancel={() => { setEditor(null); setConflictId(null); }}
          onSubmit={saveDraft}
          onReload={reloadConflict}
        />
      )}
    </section>
  );
}
