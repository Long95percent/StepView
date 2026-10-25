import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  addTodo,
  daysBetweenDateKeys,
  deleteTodo,
  ensureTodoStartedOn,
  formatTodoDateShort,
  getPlannedNodesForDay,
  getTodoEntriesForDay,
  getTodoMemoryGroups,
  getTodoWeek,
  getTodoWeekOffset,
  isDateKey,
  normalizeTodo,
  normalizeTodos,
  setNodePlannedFor,
  setTodoCompleted,
  toLocalDateKey,
  toggleTodoCompleted,
  updateTodo,
} from "../src/todo/todoCore";

const now = new Date("2026-10-25T09:30:00.000Z");

function boardWith(...todos) {
  return ensureTodoStartedOn({ tasks: [], stickers: [], todos }, "2026-10-21");
}

function taskWithNode(node, status = "active") {
  return {
    id: "task-1",
    title: "发布 StepView",
    status,
    nodes: [{ id: "start-1", kind: "start", title: "开始", timestamp: "2026-10-20T09:00:00.000Z" }, node],
    edges: [],
  };
}

describe("todo date rules", () => {
  it("accepts only real calendar dates", () => {
    expect(isDateKey("2026-10-25")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-1-01")).toBe(false);
  });

  it("adds days by calendar rather than by local 24-hour intervals", () => {
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetweenDateKeys("2026-10-21", "2026-10-28")).toBe(7);
  });

  it("builds seven anchored slots and keeps the first-open date as the anchor", () => {
    const week = getTodoWeek("2026-10-21", { today: "2026-10-25" });

    expect(week.map((day) => day.date)).toEqual([
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
    ]);
    expect(week[0]).toMatchObject({ weekday: "周三", month: 10, dayNumber: 21, isPast: true });
    expect(week[4]).toMatchObject({ isToday: true, isPast: false });
    expect(getTodoWeek("2026-10-21", { weekOffset: 1 })[0].date).toBe("2026-10-28");
  });

  it("finds the anchored week containing today", () => {
    expect(getTodoWeekOffset("2026-10-21", "2026-10-27")).toBe(0);
    expect(getTodoWeekOffset("2026-10-21", "2026-10-28")).toBe(1);
    expect(getTodoWeekOffset("2026-10-21", "2026-10-19")).toBe(0);
    expect(getTodoWeekOffset(null, "2026-10-19")).toBe(0);
  });

  it("derives the local date key without going through UTC", () => {
    const localNoon = new Date(2026, 9, 25, 12, 0, 0);
    expect(toLocalDateKey(localNoon)).toBe("2026-10-25");
    expect(formatTodoDateShort("2026-10-25")).toBe("10月25日 周日");
  });
});

describe("todo persistence and CRUD", () => {
  it("normalizes persisted records and rejects unusable rows", () => {
    const valid = {
      id: "todo-1",
      title: "  写测试  ",
      detail: "覆盖日期边界",
      date: "2026-10-25",
      status: "completed",
      createdAt: "2026-10-24T09:00:00Z",
      updatedAt: "2026-10-25T09:00:00Z",
      completedAt: "2026-10-25T10:00:00Z",
      injected: "must not survive",
    };

    expect(normalizeTodo(valid)).toMatchObject({ id: "todo-1", title: "写测试", status: "completed" });
    expect(normalizeTodo(valid)).not.toHaveProperty("injected");
    expect(normalizeTodo({ ...valid, date: "2026-02-30" })).toBeNull();
    expect(normalizeTodo({ ...valid, title: "   " })).toBeNull();
    expect(normalizeTodos([valid, { ...valid, id: "todo-1", title: "重复 id" }, null])).toHaveLength(1);
  });

  it("records the Todo start only once", () => {
    const first = ensureTodoStartedOn({ tasks: [], todos: [] }, "2026-10-21");
    const later = ensureTodoStartedOn(first, "2026-11-30");

    expect(first.todoStartedOn).toBe("2026-10-21");
    expect(later.todoStartedOn).toBe("2026-10-21");
  });

  it("adds, edits, completes, reopens and deletes a Todo without mutating the source", () => {
    const original = boardWith();
    const added = addTodo(original, { title: "准备发布", detail: "先跑测试", date: "2026-10-25" }, now);
    const todo = added.todos[0];
    const edited = updateTodo(added, todo.id, { title: "准备正式发布", date: "2026-10-26" }, new Date("2026-10-25T10:00:00Z"));
    const completed = setTodoCompleted(edited, todo.id, true, new Date("2026-10-25T11:00:00Z"));
    const reopened = toggleTodoCompleted(completed, todo.id, new Date("2026-10-25T12:00:00Z"));
    const removed = deleteTodo(reopened, todo.id);

    expect(original.todos).toEqual([]);
    expect(added.todos[0]).toMatchObject({ title: "准备发布", date: "2026-10-25", status: "open" });
    expect(edited.todos[0]).toMatchObject({ title: "准备正式发布", date: "2026-10-26" });
    expect(completed.todos[0]).toMatchObject({ status: "completed", completedAt: "2026-10-25T11:00:00.000Z" });
    expect(reopened.todos[0]).toMatchObject({ status: "open", completedAt: null });
    expect(removed.todos).toEqual([]);
  });

  it("rejects invalid writes instead of persisting ambiguous dates or empty titles", () => {
    const board = boardWith();
    expect(() => addTodo(board, { title: "坏日期", date: "2026-02-30" }, now)).toThrow(/valid YYYY-MM-DD/);
    expect(() => addTodo(board, { title: "   ", date: "2026-10-25" }, now)).toThrow(/required/);
  });
});

describe("node plans and the Todo view", () => {
  it("sets and clears a planned date on any canvas node", () => {
    const planNode = { id: "plan-1", kind: "plan-milestone", title: "上线", plannedFor: "2026-10-25" };
    const board = { tasks: [taskWithNode(planNode)], todos: [] };
    const changed = setNodePlannedFor(board, "plan-1", "2026-10-26");
    const cleared = setNodePlannedFor(changed, "plan-1", null);

    expect(changed.tasks[0].nodes[1].plannedFor).toBe("2026-10-26");
    expect(cleared.tasks[0].nodes[1]).not.toHaveProperty("plannedFor");
    expect(() => setNodePlannedFor(board, "plan-1", "2026-02-30")).toThrow(/valid YYYY-MM-DD/);
  });

  it("projects node plans into the matching day without copying them into todos", () => {
    const planNode = {
      id: "plan-1",
      kind: "plan-milestone",
      title: "发布 1.2",
      detail: "跑完回归测试",
      plannedFor: "2026-10-25",
      status: "planned",
      timestamp: "2026-10-20T09:00:00.000Z",
    };
    const board = boardWith();
    board.tasks = [taskWithNode(planNode)];

    const projected = getPlannedNodesForDay(board, "2026-10-25");
    const entries = getTodoEntriesForDay(board, "2026-10-25");

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ source: "node", title: "发布 1.2", canComplete: true, taskTitle: "发布 StepView" });
    expect(entries).toHaveLength(1);
    expect(board.todos).toEqual([]);
    expect(getPlannedNodesForDay(board, "2026-10-26")).toEqual([]);
  });

  it("keeps manual Todos forever and groups the memory box by date and status", () => {
    let board = boardWith();
    board = addTodo(board, { title: "周一事项", date: "2026-10-21" }, new Date("2026-10-21T09:00:00Z"));
    board = addTodo(board, { title: "完成事项", date: "2026-10-22" }, new Date("2026-10-22T09:00:00Z"));
    const completedId = board.todos[1].id;
    board = setTodoCompleted(board, completedId, true, new Date("2026-10-22T10:00:00Z"));

    expect(getTodoMemoryGroups(board).map((group) => group.date)).toEqual(["2026-10-22", "2026-10-21"]);
    expect(getTodoMemoryGroups(board, { status: "open" })).toEqual([
      expect.objectContaining({ date: "2026-10-21", count: 1 }),
    ]);
    expect(getTodoMemoryGroups(board, { status: "completed" })).toEqual([
      expect.objectContaining({ date: "2026-10-22", count: 1 }),
    ]);
  });

  it("marks completed plan milestones as complete in the projected entries", () => {
    const planNode = {
      id: "plan-1",
      kind: "plan-milestone",
      title: "上线",
      plannedFor: "2026-10-25",
      status: "completed",
      completedAt: "2026-10-25T09:00:00Z",
      timestamp: "2026-10-20T09:00:00.000Z",
    };
    const board = { tasks: [taskWithNode(planNode)], todos: [] };

    expect(getPlannedNodesForDay(board, "2026-10-25")[0]).toMatchObject({
      status: "completed",
      completedAt: "2026-10-25T09:00:00Z",
    });
  });
});
