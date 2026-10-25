import React from "react";
import { togglePlanMilestoneComplete } from "../progressCore";
import {
  addTodo,
  deleteTodo,
  formatTodoDate,
  formatTodoDateShort,
  getTodoEntriesForDay,
  getTodoMemoryGroups,
  getTodoWeek,
  getTodoWeekOffset,
  setTodoCompleted,
  toLocalDateKey,
  updateTodo,
} from "./todoCore";

function TodoEditor({ editor, onCancel, onSave }) {
  const [title, setTitle] = React.useState(editor.todo?.title || "");
  const [detail, setDetail] = React.useState(editor.todo?.detail || "");
  const [date, setDate] = React.useState(editor.todo?.date || editor.date);

  React.useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function submit(event) {
    event.preventDefault();
    onSave({ title, detail, date });
  }

  return (
    <div className="modalBackdrop todoEditorBackdrop" onPointerDown={onCancel}>
      <form className="modal todoEditor" onSubmit={submit} onPointerDown={(event) => event.stopPropagation()}>
        <h2>{editor.todo ? "编辑 Todo" : "添加 Todo"}</h2>
        <label>标题<input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>说明<textarea maxLength={4000} value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="可选：写下这次要做的事" /></label>
        <label>日期<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <div className="modalActions">
          <button type="button" onClick={onCancel}>取消</button>
          <button className="primary" type="submit">保存 ✅</button>
        </div>
      </form>
    </div>
  );
}

function TodoItem({ entry, onEdit, onDelete, onToggle, onTogglePlan, onOpenNode }) {
  const completed = entry.status === "completed";
  const isNodePlan = entry.source === "node";
  return (
    <article className={`todoItem ${completed ? "completed" : ""} ${isNodePlan ? "fromNode" : ""}`}>
      <div className="todoItemMain">
        {isNodePlan && !entry.canComplete ? (
          <span className="todoPlanMark" aria-hidden="true">◇</span>
        ) : (
          <button
            type="button"
            className={`todoCheck ${completed ? "checked" : ""}`}
            aria-label={completed ? "标记为未完成" : "标记为完成"}
            aria-pressed={completed}
            onClick={() => (isNodePlan ? onTogglePlan(entry.id) : onToggle(entry.id, !completed))}
          >
            {completed ? "✓" : ""}
          </button>
        )}
        <div className="todoItemCopy">
          <strong>{entry.title}</strong>
          {entry.detail && <p>{entry.detail}</p>}
          {isNodePlan && (
            <div className="todoItemMeta">
              <span className="todoSourceBadge">来自节点</span>
              <span>{entry.taskTitle}{entry.taskStatus === "completed" ? " · 目标已完成" : ""}</span>
            </div>
          )}
        </div>
      </div>
      <div className="todoItemActions">
        {isNodePlan ? (
          <button type="button" className="ghost" onClick={() => onOpenNode(entry.id)}>打开节点</button>
        ) : (
          <>
            <button type="button" className="ghost" onClick={() => onEdit(entry)}>编辑</button>
            <button type="button" className="danger" onClick={() => onDelete(entry)}>删除</button>
          </>
        )}
      </div>
    </article>
  );
}

function TodoDay({ day, entries, onAdd, ...itemActions }) {
  return (
    <section className={`todoDay ${day.isToday ? "today" : ""} ${day.isPast ? "past" : ""}`}>
      <header>
        <span>{day.weekday}</span>
        <strong>{day.dayNumber}</strong>
        <small>{day.month}月</small>
        {day.isToday && <em>今天</em>}
      </header>
      <div className="todoDayItems">
        {entries.length === 0 ? (
          <p className="todoDayEmpty">空白的一天</p>
        ) : (
          entries.map((entry) => (
            <TodoItem key={`${entry.source}-${entry.id}`} entry={entry} {...itemActions} />
          ))
        )}
      </div>
      <button type="button" className="todoAddDay" onClick={() => onAdd(day.date)}>＋ 添加</button>
    </section>
  );
}

export function TodosView({ board, onUpdateBoard, onOpenNode, onToast, onStartTodo }) {
  const today = toLocalDateKey();
  const [weekOffset, setWeekOffset] = React.useState(() => getTodoWeekOffset(board.todoStartedOn, today));
  const [editor, setEditor] = React.useState(null);
  const [memoryFilter, setMemoryFilter] = React.useState("all");
  const currentWeekOffset = getTodoWeekOffset(board.todoStartedOn, today);
  const week = getTodoWeek(board.todoStartedOn, { weekOffset, today });
  const memoryGroups = getTodoMemoryGroups(board, { status: memoryFilter });

  React.useEffect(() => {
    setWeekOffset(getTodoWeekOffset(board.todoStartedOn, today));
  }, [board.todoStartedOn, today]);

  function report(action) {
    try {
      action();
    } catch (error) {
      onToast(error.message || "Todo 操作失败。");
    }
  }

  function saveEditor(fields) {
    report(() => {
      onUpdateBoard((current) => (editor.todo
        ? updateTodo(current, editor.todo.id, fields, new Date())
        : addTodo(current, fields, new Date())));
      setEditor(null);
      onToast(editor.todo ? "Todo 已更新。" : "Todo 已添加。");
    });
  }

  function toggleTodo(todoId, completed) {
    report(() => onUpdateBoard((current) => setTodoCompleted(current, todoId, completed, new Date())));
  }

  function togglePlan(nodeId) {
    report(() => onUpdateBoard((current) => ({
      ...current,
      tasks: current.tasks.map((task) => (
        task.nodes.some((node) => node.id === nodeId)
          ? togglePlanMilestoneComplete(task, nodeId, new Date())
          : task
      )),
    })));
  }

  function removeTodo(entry) {
    if (!window.confirm(`删除「${entry.title}」？这条 Todo 会从回忆箱中移除。`)) return;
    report(() => {
      onUpdateBoard((current) => deleteTodo(current, entry.id));
      onToast("Todo 已删除。");
    });
  }

  const itemActions = {
    onEdit: (entry) => setEditor({ todo: entry, date: entry.date }),
    onDelete: removeTodo,
    onToggle: toggleTodo,
    onTogglePlan: togglePlan,
    onOpenNode,
  };

  if (!board.todoStartedOn) {
    return (
      <section className="todoShell">
        <div className="todoStartEmpty">
          <span>✓</span>
          <h1>开启你的 Todo 时间轴</h1>
          <p>第一次打开后，今天会成为 7 天视图的起点，并永久保留。</p>
          <button type="button" className="primary" onClick={onStartTodo}>从今天开始</button>
        </div>
      </section>
    );
  }

  const firstDay = week[0]?.date;
  const lastDay = week.at(-1)?.date;
  const currentTodoCount = week.reduce((total, day) => (
    total + getTodoEntriesForDay(board, day.date).filter((entry) => entry.status !== "completed").length
  ), 0);

  return (
    <section className="todoShell">
      <header className="todoToolbar">
        <div>
          <p className="todoEyebrow">7 日计划</p>
          <h1>✓ Todo</h1>
          <p>从 {formatTodoDate(board.todoStartedOn)} 开始，记录不会因为翻周而消失。</p>
        </div>
        <div className="todoStats">
          <strong>{currentTodoCount}</strong>
          <span>当前周未完成</span>
        </div>
      </header>

      <div className="todoBody">
        <div className="todoWeekBar">
          <button type="button" className="ghost" disabled={weekOffset === 0} onClick={() => setWeekOffset((value) => Math.max(0, value - 1))}>← 上一周</button>
          <div>
            <strong>{firstDay && formatTodoDateShort(firstDay)} — {lastDay && formatTodoDateShort(lastDay)}</strong>
            <button type="button" className="todoThisWeek" disabled={weekOffset === currentWeekOffset} onClick={() => setWeekOffset(currentWeekOffset)}>回到本周</button>
          </div>
          <button type="button" className="ghost" onClick={() => setWeekOffset((value) => value + 1)}>下一周 →</button>
        </div>

        <div className="todoWeekGrid">
          {week.map((day) => (
            <TodoDay
              key={day.date}
              day={day}
              entries={getTodoEntriesForDay(board, day.date)}
              onAdd={(date) => setEditor({ todo: null, date })}
              {...itemActions}
            />
          ))}
        </div>

        <section className="todoMemory">
          <header>
            <div>
              <p className="todoEyebrow">永久归档</p>
              <h2>回忆箱</h2>
              <p>手动创建的 Todo 不会自动删除，节点计划也会按日期持续归入这里。</p>
            </div>
            <div className="todoSegmented" role="group" aria-label="回忆箱筛选">
              {[["all", "全部"], ["open", "未完成"], ["completed", "已完成"]].map(([value, label]) => (
                <button key={value} type="button" className={memoryFilter === value ? "active" : ""} onClick={() => setMemoryFilter(value)}>{label}</button>
              ))}
            </div>
          </header>
          {memoryGroups.length === 0 ? (
            <div className="todoMemoryEmpty">这里还是空的。完成或过去的事情，都会留在这里。</div>
          ) : (
            memoryGroups.map((group) => (
              <div key={group.date} className="todoMemoryGroup">
                <h3>{formatTodoDate(group.date)}<span>{group.count}</span></h3>
                {group.entries.map((entry) => (
                  <TodoItem key={`${entry.source}-${entry.id}`} entry={entry} {...itemActions} />
                ))}
              </div>
            ))
          )}
        </section>
      </div>

      {editor && <TodoEditor editor={editor} onCancel={() => setEditor(null)} onSave={saveEditor} />}
    </section>
  );
}
