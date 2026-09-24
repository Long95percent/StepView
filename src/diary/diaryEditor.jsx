import React from "react";

/** ISO 时间 → <input type="datetime-local"> 要的本地时间字符串。 */
export function toLocalInputValue(occurredAt) {
  const date = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 运行环境的时区。日记的"哪一天"按它算，所以必须跟着用户走。 */
export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * 日记的编辑表单。
 *
 * kind 不作为界面字段暴露：从日记板块进来就是每日日记，从节点进来就是节点日记。
 * 类型是内部概念，不该让用户去理解。
 *
 * 从已有的 entry 编辑时会带上 rev 做乐观锁；版本冲突由父组件处理（提示 + 重新载入），
 * 这里只负责把"冲突了"这件事显示出来，绝不做静默覆盖。
 */
export function DiaryEditor({
  entry = null,
  kind = "daily",
  nodeOptions = [],
  busy = false,
  conflict = false,
  onCancel,
  onSubmit,
  onReload,
}) {
  const [occurredAt, setOccurredAt] = React.useState(() => toLocalInputValue(entry?.occurredAt));
  const [title, setTitle] = React.useState(entry?.title ?? "");
  const [content, setContent] = React.useState(entry?.content ?? "");
  const [tags, setTags] = React.useState((entry?.tags ?? []).join("、"));
  const [linkedNodeIds, setLinkedNodeIds] = React.useState(() => new Set((entry?.links ?? []).filter((link) => link.targetType === "node").map((link) => link.targetId)));
  const [error, setError] = React.useState("");

  const toggleNode = (nodeId) => {
    setLinkedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  function submit(event) {
    event.preventDefault();
    if (!title.trim() && !content.trim()) {
      setError("标题和正文至少写一样。");
      return;
    }
    // 节点日记必须挂节点：在提交前就拦住，而不是等后端报错。
    if (kind === "node" && linkedNodeIds.size === 0) {
      setError("节点日记必须关联至少一个节点。");
      return;
    }
    setError("");
    onSubmit({
      kind,
      title: title.trim(),
      content: content.trim(),
      tags: tags.split(/[、,，\s]+/).map((tag) => tag.trim()).filter(Boolean),
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
      timezone: localTimezone(),
      links: [...linkedNodeIds].map((targetId) => ({ targetType: "node", targetId, role: "primary", createdBy: "user" })),
    });
  }

  return (
    <div className="modalBackdrop" onPointerDown={onCancel}>
      <form className="modal diaryEditor" onSubmit={submit} onPointerDown={(event) => event.stopPropagation()}>
        <h2>{entry ? "编辑日记" : kind === "node" ? "写一条节点日记" : "写日记"}</h2>

        {conflict && (
          <div className="diaryConflict">
            <p>这条日记在别处被改过，直接保存会把对方的内容盖掉。</p>
            <button type="button" className="ghost" onClick={onReload}>重新载入</button>
          </div>
        )}

        <label>时间<input type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} /></label>
        <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="可以只写正文" /></label>
        <label>正文<textarea rows={6} value={content} onChange={(event) => setContent(event.target.value)} placeholder="今天发生了什么？" /></label>
        <label>标签<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用顿号或逗号分隔" /></label>

        <fieldset className="diaryNodePicker">
          <legend>{kind === "node" ? "关联节点（必选，可多选）" : "关联节点（可选，可多选）"}</legend>
          {nodeOptions.length === 0 ? (
            <p className="diaryHint">画布上还没有节点，先去创建一条任务线。</p>
          ) : (
            <div className="diaryNodeList">
              {nodeOptions.map((option) => (
                <label key={option.id} className="diaryNodeOption">
                  <input type="checkbox" checked={linkedNodeIds.has(option.id)} onChange={() => toggleNode(option.id)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {error && <p className="diaryError">{error}</p>}

        <div className="modalActions">
          <button type="button" onClick={onCancel}>取消</button>
          <button className="primary" type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </div>
  );
}
