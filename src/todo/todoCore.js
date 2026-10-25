/**
 * Todo and node-plan rules.
 *
 * This module stays free of React, DOM and database access so the same rules run
 * in the personal app, the service app, browser backups and Node tests.
 */

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_TODO_ID_LENGTH = 160;
const MAX_TODO_TITLE_LENGTH = 200;
const MAX_TODO_DETAIL_LENGTH = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export const TODO_STATUS = {
  open: "open",
  completed: "completed",
};

function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function dateKeyToUtc(dayKey) {
  const match = DATE_KEY_PATTERN.exec(String(dayKey ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

/** A real calendar date in `YYYY-MM-DD` form, not just a string that looks like one. */
export function isDateKey(value) {
  return dateKeyToUtc(value) !== null;
}

export function normalizeDateKey(value) {
  return isDateKey(value) ? String(value) : null;
}

export function toLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDaysToDateKey(dayKey, amount) {
  const date = dateKeyToUtc(dayKey);
  if (!date || !Number.isInteger(amount)) return null;
  return new Date(date.getTime() + amount * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetweenDateKeys(fromDay, toDay) {
  const from = dateKeyToUtc(fromDay);
  const to = dateKeyToUtc(toDay);
  if (!from || !to) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

export function getTodoWeekOffset(todoStartedOn, dayKey) {
  const distance = daysBetweenDateKeys(todoStartedOn, dayKey);
  if (distance === null) return 0;
  return Math.max(0, Math.floor(distance / 7));
}

/** Seven consecutive days anchored to the first time the Todo view was opened. */
export function getTodoWeek(todoStartedOn, { weekOffset = 0, today = toLocalDateKey() } = {}) {
  const anchor = normalizeDateKey(todoStartedOn);
  if (!anchor) return [];
  const safeOffset = Number.isInteger(weekOffset) ? Math.max(0, weekOffset) : 0;
  const start = addDaysToDateKey(anchor, safeOffset * 7);

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDaysToDateKey(start, index);
    const parsed = dateKeyToUtc(date);
    return {
      date,
      weekday: WEEKDAYS[parsed.getUTCDay()],
      dayNumber: Number(date.slice(8, 10)),
      month: Number(date.slice(5, 7)),
      isToday: date === today,
      isPast: today && date < today,
    };
  });
}

export function formatTodoDate(dayKey) {
  const date = dateKeyToUtc(dayKey);
  if (!date) return "";
  return `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${WEEKDAYS[date.getUTCDay()]}`;
}

export function formatTodoDateShort(dayKey) {
  const date = dateKeyToUtc(dayKey);
  if (!date) return "";
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日 ${WEEKDAYS[date.getUTCDay()]}`;
}

function normalizeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizeTimestamp(value) {
  if (typeof value !== "string" || !value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

/** A persisted Todo. Invalid records are ignored rather than rendered partially. */
export function normalizeTodo(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = normalizeText(value.id, MAX_TODO_ID_LENGTH);
  const title = normalizeText(value.title, MAX_TODO_TITLE_LENGTH);
  const date = normalizeDateKey(value.date);
  if (!id || !title || !date) return null;

  const status = value.status === TODO_STATUS.completed ? TODO_STATUS.completed : TODO_STATUS.open;
  const completedAt = status === TODO_STATUS.completed ? normalizeTimestamp(value.completedAt) : null;
  return {
    id,
    title,
    detail: normalizeText(value.detail, MAX_TODO_DETAIL_LENGTH),
    date,
    status,
    createdAt: normalizeTimestamp(value.createdAt),
    updatedAt: normalizeTimestamp(value.updatedAt),
    completedAt,
  };
}

export function normalizeTodos(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const todos = [];
  for (const candidate of value) {
    const todo = normalizeTodo(candidate);
    if (!todo || seen.has(todo.id)) continue;
    seen.add(todo.id);
    todos.push(todo);
  }
  return todos;
}

export function normalizeTodoStartedOn(value) {
  return normalizeDateKey(value);
}

function normalizeInput(input = {}) {
  const title = normalizeText(input.title, MAX_TODO_TITLE_LENGTH);
  const detail = normalizeText(input.detail, MAX_TODO_DETAIL_LENGTH);
  const date = normalizeDateKey(input.date);
  if (!title) throw new Error("Todo title is required.");
  if (!date) throw new Error("Todo date must be a valid YYYY-MM-DD calendar date.");
  return { title, detail, date };
}

function newTodoId() {
  return `todo-${crypto.randomUUID()}`;
}

function withNormalizedTodos(board) {
  return { ...board, todos: normalizeTodos(board?.todos) };
}

export function ensureTodoStartedOn(board, today = toLocalDateKey()) {
  const existing = normalizeTodoStartedOn(board?.todoStartedOn);
  if (existing) return { ...board, todos: normalizeTodos(board?.todos), todoStartedOn: existing };
  const validToday = normalizeDateKey(today);
  if (!validToday) throw new Error("Todo start date must be a valid YYYY-MM-DD calendar date.");
  return { ...board, todos: normalizeTodos(board?.todos), todoStartedOn: validToday };
}

export function addTodo(board, input, now = new Date()) {
  const fields = normalizeInput(input);
  const timestamp = now.toISOString();
  const todo = {
    id: newTodoId(),
    ...fields,
    status: TODO_STATUS.open,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  };
  return { ...withNormalizedTodos(board), todos: [...normalizeTodos(board?.todos), todo] };
}

export function updateTodo(board, todoId, patch = {}, now = new Date()) {
  const currentTodos = normalizeTodos(board?.todos);
  const current = currentTodos.find((todo) => todo.id === todoId);
  if (!current) throw new Error("Todo not found.");
  const nextFields = normalizeInput({ ...current, ...patch });
  const updated = {
    ...current,
    ...nextFields,
    updatedAt: now.toISOString(),
  };
  return {
    ...withNormalizedTodos(board),
    todos: currentTodos.map((todo) => (todo.id === todoId ? updated : todo)),
  };
}

export function setTodoCompleted(board, todoId, completed, now = new Date()) {
  const currentTodos = normalizeTodos(board?.todos);
  if (!currentTodos.some((todo) => todo.id === todoId)) throw new Error("Todo not found.");
  const timestamp = now.toISOString();
  return {
    ...withNormalizedTodos(board),
    todos: currentTodos.map((todo) => {
      if (todo.id !== todoId) return todo;
      const nextStatus = completed ? TODO_STATUS.completed : TODO_STATUS.open;
      return {
        ...todo,
        status: nextStatus,
        updatedAt: timestamp,
        completedAt: completed ? timestamp : null,
      };
    }),
  };
}

export function toggleTodoCompleted(board, todoId, now = new Date()) {
  const current = normalizeTodos(board?.todos).find((todo) => todo.id === todoId);
  if (!current) throw new Error("Todo not found.");
  return setTodoCompleted(board, todoId, current.status !== TODO_STATUS.completed, now);
}

export function deleteTodo(board, todoId) {
  return {
    ...withNormalizedTodos(board),
    todos: normalizeTodos(board?.todos).filter((todo) => todo.id !== todoId),
  };
}

export function setNodePlannedFor(board, nodeId, plannedFor) {
  const nextDate = plannedFor === null || plannedFor === undefined || plannedFor === ""
    ? null
    : normalizeDateKey(plannedFor);
  if (plannedFor && !nextDate) throw new Error("Planned date must be a valid YYYY-MM-DD calendar date.");

  let changed = false;
  const tasks = (board?.tasks || []).map((task) => {
    let taskChanged = false;
    const nodes = (task.nodes || []).map((node) => {
      if (node.id !== nodeId) return node;
      changed = true;
      taskChanged = true;
      if (nextDate === null) {
        const { plannedFor: _removed, ...rest } = node;
        return rest;
      }
      return { ...node, plannedFor: nextDate };
    });
    return taskChanged ? { ...task, nodes } : task;
  });
  if (!changed) throw new Error("Node not found.");
  return { ...board, tasks };
}

function compareTodoEntries(left, right) {
  const byCreated = String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
  if (byCreated !== 0) return byCreated;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

export function getTodosForDay(board, dayKey) {
  const date = normalizeDateKey(dayKey);
  if (!date) return [];
  return normalizeTodos(board?.todos).filter((todo) => todo.date === date).sort(compareTodoEntries);
}

export function getPlannedNodesForDay(board, dayKey) {
  const date = normalizeDateKey(dayKey);
  if (!date) return [];
  const entries = [];
  for (const task of board?.tasks || []) {
    for (const node of task.nodes || []) {
      if (node?.plannedFor !== date || !node.id) continue;
      const completed = node.kind === "plan-milestone" && node.status === "completed";
      entries.push({
        source: "node",
        id: node.id,
        title: String(node.title || "未命名节点"),
        detail: String(node.detail || ""),
        date,
        status: completed ? TODO_STATUS.completed : TODO_STATUS.open,
        createdAt: String(node.timestamp || ""),
        updatedAt: null,
        completedAt: completed ? String(node.completedAt || "") : null,
        canComplete: node.kind === "plan-milestone",
        node,
        taskId: task.id,
        taskTitle: String(task.title || ""),
        taskStatus: task.status,
      });
    }
  }
  return entries.sort(compareTodoEntries);
}

export function getTodoEntriesForDay(board, dayKey) {
  const manual = getTodosForDay(board, dayKey).map((todo) => ({ ...todo, source: "todo", canComplete: true }));
  const planned = getPlannedNodesForDay(board, dayKey);
  return [...manual, ...planned].sort(compareTodoEntries);
}

export function getTodoMemoryGroups(board, { status = "all" } = {}) {
  const days = new Set([
    ...normalizeTodos(board?.todos).map((todo) => todo.date),
    ...(board?.tasks || []).flatMap((task) =>
      (task.nodes || []).map((node) => normalizeDateKey(node?.plannedFor)).filter(Boolean),
    ),
  ]);

  return [...days]
    .sort((left, right) => right.localeCompare(left))
    .map((date) => {
      const entries = getTodoEntriesForDay(board, date).filter((entry) => {
        if (status === "all") return true;
        return entry.status === status;
      });
      return { date, entries, count: entries.length };
    })
    .filter((group) => group.entries.length > 0);
}
