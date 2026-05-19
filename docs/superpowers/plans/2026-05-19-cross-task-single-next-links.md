# Cross-Task Single-Next Links Plan

> Status: product/implementation plan only. Do not implement full branching yet.

## Goal

Allow a node in one task to connect to a node in another task, so users can reuse an existing task path as part of a larger goal while preserving a single forward path from every node.

Example: an AI project node can connect into a Knowledge Base task node when the AI project requires knowledge base work first.

## Product Principles

- Keep the current task path simple: each node has at most one next step.
- Allow node reuse: a node may have multiple incoming links from different tasks.
- Allow cross-task links to appear in the final Journey record.
- Keep completed Journey as a single line, not a branch graph.
- Start with a small MVP inspired by Git, but do not implement full Git-like branching or merging.

## MVP Scope

### In Scope

- Create a directed link from any node in one task to any node in another task.
- Supported node types: start, finish, milestone, plan-milestone.
- Enforce single outgoing next edge per node.
- Allow multiple incoming edges to the same target node.
- Prevent cycles across the unified graph.
- Render cross-task links separately from internal task edges.
- Right-click a cross-task link and delete that specific link.
- Include cross-task nodes in completed Journey when they are on the followed path.
- Show the source task name for cross-task nodes inside Journey.

### Out of Scope

- Full branching.
- Same-task extra links.
- Automatic return links.
- Auto layout.
- Multiple relationship types.
- Dependency-based completion blocking.
- Git merge-style visualization.

## Key Decision: Strict Mode

When a source node already has a next step, the user cannot create another outgoing link from it.

The user must delete the existing next edge/link first.

Reason: this keeps the first version aligned with the rule that every node has only one next step and avoids accidental path rewiring.

## Data Model

Keep cross-task links at board level instead of writing them into an individual task's `edges` array.

```js
board = {
  tasks: [],
  stickers: [],
  links: [
    {
      id: "link-xxx",
      fromTaskId: "task-ai",
      fromNodeId: "node-need-rag",
      toTaskId: "task-kb",
      toNodeId: "node-learn-vector-db",
      kind: "cross-task",
      createdAt: "2026-05-19T00:00:00.000Z"
    }
  ]
}
```

### Why Board-Level Links

- `task.edges` keeps its existing meaning: internal task path.
- Cross-task links can be deleted independently by `id`.
- Reused nodes and duplicate-looking relationships stay isolated.
- Future branch data can be introduced as a separate structure without rewriting the MVP.

## Graph Rules

Before adding `fromNodeId -> toNodeId`:

1. `fromNodeId` and `toNodeId` must both exist.
2. Source and target must belong to different tasks for the MVP.
3. Source node must not already have any outgoing internal edge or cross-task link.
4. Adding the link must not create a cycle.
5. Target node may already have incoming links.
6. Target node may already have its own outgoing next step.

## Journey Rules

Completed Journey follows a single path:

1. Start at the completed task's start node.
2. At each node, find its single next step from the unified graph.
3. The unified graph combines internal `task.edges` and board-level `links`.
4. Continue until there is no next node, a finish node is reached, or a visited node is encountered as a safety stop.
5. If a node belongs to another task, show its task title in the Journey metadata.

Journey remains a single line even when it crosses tasks.

## Implementation Phases

### Phase 1: Core Data and Validation

Files:

- `src/progressCore.js`
- `tests/progressCore.test.js`

Add:

- `normalizeBoard` support for `links: []`.
- `addCrossTaskLink(board, fromNodeId, toNodeId, now)`.
- `deleteCrossTaskLink(board, linkId)`.
- `getUnifiedEdges(board)`.
- `findNodeInBoard(board, nodeId)`.
- `nodeHasOutgoingNext(board, nodeId)`.
- `wouldCreateCycle(board, fromNodeId, toNodeId)`.

Tests:

- Normalizes old boards without links.
- Adds a cross-task link between two tasks.
- Rejects same-task links in MVP.
- Rejects links from a node that already has an outgoing next.
- Allows multiple incoming links to the same target node.
- Rejects links that would create a cycle.
- Deletes only the selected cross-task link.

### Phase 2: Unified Journey Path

Files:

- `src/progressCore.js`
- `tests/progressCore.test.js`
- `src/main.jsx`

Update:

- Add a board-aware journey function, for example `getTaskProcessEntries(board, task)`.
- Keep backwards compatibility if needed for existing call sites.
- Include `taskId` and `taskTitle` in each journey entry.
- Gallery/Journey uses the board-aware function.

Tests:

- Journey follows an internal task path when no cross-task links exist.
- Journey crosses into another task when a cross-task link is on the path.
- Journey includes task title metadata for reused nodes.
- Journey still stops safely if data is malformed.

### Phase 3: Rendering Cross-Task Links

Files:

- `src/main.jsx`
- `src/styles.css`

Add:

- Render board-level `links` in the canvas SVG separately from internal edges.
- Use a distinct style, such as purple dashed line with arrow direction.
- Add a wider invisible hit area for right-click targeting.
- Keep internal task edges visually unchanged.

Acceptance:

- Internal edges and cross-task links are visually distinguishable.
- Cross-task links point in the correct direction.
- Duplicate-looking links remain separately keyed by `id`.

### Phase 4: Link Creation Interaction

Files:

- `src/main.jsx`
- `src/styles.css`

Recommended MVP interaction:

- Show a small connection handle on selected or hovered nodes.
- Drag from the handle to a node in another task.
- Show a preview line while dragging.
- On drop, call `addCrossTaskLink`.
- If rejected, do not create a link and show a lightweight message.

Rejection messages:

- `Source already has a next step.`
- `This link would create a loop.`
- `Cross-task links only for now.`

### Phase 5: Right-Click Delete

Files:

- `src/main.jsx`
- `src/styles.css`

Add:

- Right-click cross-task link opens a context menu.
- Menu option: `Delete link`.
- Deleting removes only that `link.id`.
- Do not delete nodes or internal task edges.

## MVP Acceptance Criteria

- User can create a directed link from a node in `AI Project` to a node in `Knowledge Base`.
- Source node cannot have two outgoing next steps.
- Multiple different nodes can point into the same target node.
- A reverse link that creates a cycle is rejected.
- Cross-task link is visually separate from internal task lines.
- Right-clicking a cross-task link can delete only that link.
- Completing a task stores/displays a Journey that can include cross-task nodes.
- Journey remains a single line.

## Future Ideas

- Branch data structure.
- Same-task non-main links.
- Dependency completion gates.
- Auto layout and line routing.
- Git-like branch and merge visualization.
- Rich link labels.
