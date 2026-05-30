# Agent Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement StepView's Agent memory pipeline so it can build lightweight signals, task-line summaries, branch memory, user state snapshots, and bounded long-term facts from the current board without deleting or overwriting user canvas data.

**Architecture:** Keep the current board as the source of truth and treat `agentMemory` as derived data stored alongside it. Build memory from current tasks, branches, nodes, and diary text with local helpers in `src/agentMemory.js`, and keep query routing in the same module so the Agent UI can stay thin. Add tests for scope filtering, stale-memory rejection, and summary generation before changing behavior.

**Tech Stack:** React, Vite, Vitest, plain JavaScript.

---

### Task 1: Lock down the expected memory shape

**Files:**
- Modify: `tests/agentMemory.test.js`
- Modify: `src/agentMemory.js`

- [ ] **Step 1: Write the failing test**

```js
it("builds lightweight memory from the current board only", () => {
  // active task, completed task, one archived branch, and one stale memory entry
  // expect task summaries, branch memories, diary signals, and scope options to only reflect current board content
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd.exe /c npx vitest run tests/agentMemory.test.js --pool=threads`
Expected: FAIL because stale memory entries still leak into scope options.

- [ ] **Step 3: Write minimal implementation**

```js
export function getAgentScopeOptions(board, memory = buildAgentMemory(board)) {
  const visibleTaskIds = new Set((board.tasks || []).filter((task) => task.status === "active" || task.status === "completed").map((task) => task.id));
  const visibleBranchIds = new Set([
    ...(board.branches || []).filter((branch) => visibleTaskIds.has(branch.taskId)).map((branch) => branch.id),
    ...(board.tasks || []).filter((task) => task.status === "completed").flatMap((task) => Array.isArray(task.archivedBranches) ? task.archivedBranches : []).map((branch) => branch.id),
  ]);
  return [
    { id: "global", label: "全局", detail: "所有任务线" },
    ...memory.taskLineSummaries.filter((summary) => visibleTaskIds.has(summary.taskLineId)).map((summary) => ({ id: `task:${summary.taskLineId}`, label: summary.title, detail: summary.status === "completed" ? "已完成" : "任务线" })),
    ...memory.branchMemories.filter((branch) => visibleTaskIds.has(branch.taskLineId) && visibleBranchIds.has(branch.branchId)).map((branch) => ({ id: `branch:${branch.branchId}`, label: branch.partnerName || branch.label, detail: `${branch.taskTitle} / ${branch.status}` })),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd.exe /c npx vitest run tests/agentMemory.test.js --pool=threads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/agentMemory.test.js src/agentMemory.js
git commit -m "feat: filter agent scope memory to current board"
```

### Task 2: Keep agent memory derived from the live board

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/agentMemory.js`
- Test: `tests/agentMemory.test.js`

- [ ] **Step 1: Write the failing test**

```js
it("rebuilds agentMemory from the loaded board without changing board content", () => {
  // loading a board snapshot with stale agentMemory should still preserve tasks, branches, and completed WINS data
  // but agentMemory should be recomputed from the live board state
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd.exe /c npx vitest run tests/agentMemory.test.js --pool=threads`
Expected: FAIL because the app still trusts old cached agentMemory in some flows.

- [ ] **Step 3: Write minimal implementation**

```js
function withFreshAgentMemory(board) {
  const normalized = normalizeBoard(board);
  return { ...normalized, agentMemory: buildAgentMemory(normalized) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd.exe /c npx vitest run tests/agentMemory.test.js --pool=threads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.jsx tests/agentMemory.test.js src/agentMemory.js
git commit -m "feat: recompute agent memory from live board state"
```

### Task 3: Match the design doc's memory layers

**Files:**
- Modify: `src/agentMemory.js`
- Modify: `tests/agentMemory.test.js`

- [ ] **Step 1: Write the failing test**

```js
it("creates diary signals, task summaries, branch memory, and stable user snapshot fields", () => {
  // verify the returned memory includes updatedAt, diarySignals, taskLineSummaries, branchMemories, userMemoryFacts, and userStateSnapshot
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cmd.exe /c npx vitest run tests/agentMemory.test.js --pool=threads`
Expected: FAIL if any required field is missing or stale.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildAgentMemory(board) {
  const safeBoard = {
    tasks: Array.isArray(board?.tasks) ? board.tasks : [],
    branches: Array.isArray(board?.branches) ? board.branches : [],
    stickers: Array.isArray(board?.stickers) ? board.stickers : [],
    links: Array.isArray(board?.links) ? board.links : [],
  };
  const taskLineSummaries = safeBoard.tasks.map((task) => summarizeTask(task, safeBoard));
  const branchMemories = safeBoard.tasks.flatMap((task) => getTaskBranches(safeBoard, task).map((branch) => summarizeBranch(safeBoard, task, branch)));
  const diarySignals = buildDiarySignals(safeBoard);
  const userMemoryFacts = buildProfileFacts(taskLineSummaries, diarySignals);
  return { version: AGENT_MEMORY_VERSION, updatedAt: new Date().toISOString(), userEvents: [], diarySignals, taskLineSummaries, branchMemories, userMemoryFacts, userStateSnapshot: { /* snapshot fields */ } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cmd.exe /c npx vitest run tests/agentMemory.test.js --pool=threads`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agentMemory.js tests/agentMemory.test.js
git commit -m "feat: align agent memory layers with design"
```

### Task 4: Verify the full app still builds and preserves user data

**Files:**
- None new; verification only

- [ ] **Step 1: Run the full test suite**

Run: `cmd.exe /c npm test`
Expected: all tests pass.

- [ ] **Step 2: Build the app**

Run: `cmd.exe /c npm run build`
Expected: build succeeds.

- [ ] **Step 3: Sanity-check preserved data behavior**

Confirm the code path only rewrites `agentMemory` and does not call any delete or reset helper on tasks, branches, WINS, or board storage.

