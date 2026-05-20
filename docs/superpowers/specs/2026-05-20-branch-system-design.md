# Branch System Product Design

> Status: approved product design. This document defines the next major branch-system direction after the earlier cross-task single-next-link MVP.

## Goal

Add a relationship-aware branch system to StepView so users can create, delete, style, and later reconnect branches from any node while keeping the product both useful for project planning and playful for personal storytelling.

The feature should support Git-inspired branching and merging, but it should feel native to StepView: visual, lightweight, emotional, and safe for local user board data.

## Product Positioning

Feature name: 分支线

Core promise: 把目标走成故事，把关系画进路线里。

Initial branch types:

- 我的分支: personal alternative path or side quest.
- 伙伴线: a path representing a friend, teammate, collaborator, or external participant.
- 恋人线: a special relationship branch with pink/red visual styling and optional 530 event easter eggs.

Event marketing name for the lover branch: 心动支线。

## Product Principles

- Functional first: branches must help users represent real alternative paths, parallel work, collaborators, and future reconnection.
- Playful but optional: lover and event effects should add delight without making the product feel unserious.
- Extensible by configuration: branch types and event packs should be data/config driven, not hard-coded into graph logic.
- Non-destructive: branch demos, easter eggs, and event packs must never overwrite or replace user board data.
- Local-first: first version expresses relationships on the user's local board; it does not require real-time multi-user collaboration.
- Legible graph: visual decoration must not make lines unreadable or block normal project use.

## User Stories

### Create My Branch

As a user, I can right-click a node and create a branch from it so I can explore another path without replacing the main path.

Flow:

1. User right-clicks a node.
2. User chooses `新建分支`.
3. User chooses `我的分支`.
4. StepView shows anchor choices around the node.
5. User selects the anchor where the branch should start.
6. A new branch edge and first branch node are created.

### Create Partner Branch

As a user, I can create a partner branch for a friend or teammate so their contribution is visually separated from my own route.

Flow:

1. User right-clicks a node.
2. User chooses `新建分支`.
3. User chooses `伙伴支线`.
4. User enters or selects a partner name, color, and optional emoji/avatar.
5. StepView creates a branch with partner styling and metadata.

### Create Lover Branch

As a user, I can create a lover branch so a project, relationship, or memory route has a warmer and more playful expression.

Flow:

1. User right-clicks a node.
2. User chooses `新建分支`.
3. User chooses `恋人支线`.
4. StepView shows a short delightful confirmation or title prompt.
5. User creates the branch with pink/red styling and optional nickname or anniversary metadata.

### Merge Branch Back

As a user, I can reconnect a branch to a later node so an alternative or relationship path can return to the main journey.

Flow:

1. User right-clicks the end node of a branch.
2. User chooses `接回已有节点`.
3. StepView enters target-pick mode.
4. User clicks an existing node.
5. StepView creates a merge edge if graph rules allow it.

### Delete Branch

As a user, I can delete a branch when it is no longer needed, without damaging unrelated main-line data.

Flow:

1. User right-clicks a branch line or branch root node.
2. User chooses `删除分支`.
3. StepView explains what will be deleted.
4. User confirms.
5. Only the selected branch subtree and branch edges are removed.

## Scope

### In Scope For First Branch Release

- Create multiple branches from a node.
- Delete a selected branch safely with confirmation.
- Let users select branch anchor position when creating a branch.
- Store branch type and metadata separately from core graph rules.
- Render different line styles for self, partner, and lover branches.
- Let branch end nodes connect back to an existing node.
- Add a small lover-branch easter egg system that is optional and configuration-driven.
- Preserve existing boards and migrate old data without overwriting user content.

### Out Of Scope For First Branch Release

- Real-time multiplayer collaboration.
- Account system or cloud partner identity.
- Git concepts such as rebase, cherry-pick, conflict resolution, commit hash, or branch checkout.
- Heavy automatic graph layout.
- Activity packs that automatically create or replace user nodes.
- Mandatory animations that reduce readability.

## Interaction Design

### Context Menu

Node right-click menu should include:

- 新建分支
  - 我的分支
  - 伙伴支线
  - 恋人支线
- 接回已有节点, only shown when the selected node can act as a branch endpoint.
- 删除分支, only shown for branch lines or branch-owned nodes.

### Anchor Selection

After choosing a branch type, StepView should show anchor handles around the source node.

Recommended anchors:

- right-top
- right-bottom
- bottom
- left-bottom

The selected anchor is stored on the edge, so rendering remains stable after reload. Users should later be able to change the anchor from the line or node context menu.

### Visual Language

Default styles:

- Main path: keep current style.
- My branch: blue or violet line, solid or lightly curved.
- Partner branch: green/orange line, optional avatar badge near branch root.
- Lover branch: pink/red gradient line, subtle glow, optional heart or sparkle accents.
- Merge edge: visually distinct from normal forward branch edges, such as a curved return line or small merge badge.

Decoration should be restrained by default. A future setting can expose `低调 / 标准 / 浪漫` intensity levels for lover branches.

## Extensible Architecture

The core branch system should not know about 530, romance copywriting, or any specific easter egg. It should only handle graph operations and store metadata.

### Core Branch Concepts

Branch graph data should represent:

- branch identity
- source node
- branch node ownership
- optional target node for merge/reconnection
- anchor and route information
- branch type
- metadata

Conceptual shape:

```js
branch = {
  id: "branch-xxx",
  taskId: "task-xxx",
  type: "self" | "partner" | "lover" | string,
  sourceNodeId: "node-source",
  rootNodeId: "node-branch-root",
  status: "open" | "merged",
  metadata: {
    label: "支线标题",
    ownerName: "小王",
    emoji: "🐱",
    eventPackId: "530-lover"
  },
  createdAt: "2026-05-20T00:00:00.000Z"
}
```

Branch edges should represent visual and graph connections:

```js
branchEdge = {
  id: "edge-xxx",
  taskId: "task-xxx",
  branchId: "branch-xxx",
  fromNodeId: "node-a",
  toNodeId: "node-b",
  kind: "branch" | "merge",
  sourceAnchor: "right-bottom",
  targetAnchor: "left-top",
  createdAt: "2026-05-20T00:00:00.000Z"
}
```

Exact implementation may adapt to the existing `progressCore` data model, but the separation between core graph data, branch type config, and event pack logic should remain.

### Branch Type Registry

Branch types should be defined by configuration rather than scattered conditionals.

Conceptual shape:

```js
branchTypeRegistry = {
  self: {
    label: "我的分支",
    color: "violet",
    lineStyle: "solid",
    defaultMetadata: {}
  },
  partner: {
    label: "伙伴支线",
    color: "green",
    lineStyle: "solid",
    metadataSchema: ["ownerName", "emoji"]
  },
  lover: {
    label: "恋人支线",
    color: "pink-red-gradient",
    lineStyle: "glow",
    eventPacks: ["530-lover"]
  }
}
```

### Event Pack Registry

Event packs should be optional extensions attached to branch types through metadata.

Event pack responsibilities:

- Provide copywriting.
- Provide visual accents.
- React to safe lifecycle events.
- Never mutate board graph data without explicit user action.

Allowed lifecycle hooks:

- `onBranchCreatePreview`
- `onBranchCreated`
- `onNodeCountMilestone`
- `onBranchMerged`
- `onBranchSelected`

Forbidden behavior:

- Automatically deleting user nodes.
- Automatically overwriting node titles or notes.
- Replacing an existing board with demo data.
- Creating destructive demo/sample/tutorial flows.

## Lover Branch And 530 Easter Eggs

The lover branch should provide delight without becoming a hard dependency of the branch system.

Suggested 530 event pack: `530-lover`.

Potential easter eggs:

- Creation prompt: 要不要开一条只属于 TA 的路线？
- First node message: 心动支线已开启。
- Third node milestone: 这条路开始有故事了。
- Fifth node milestone: 你们已经一起走过 5 个节点。
- Merge message: 我们又在这里汇合了。
- Subtle visual pulse when a lover branch is selected.
- Optional heart/sparkle particles on merge, capped to a short non-blocking animation.

Easter eggs should be user-visible but not mandatory. If a user disables event effects, lover branches still work as normal styled branches.

## Graph Rules

- A node can have multiple outgoing branch edges.
- A node can keep its existing main next edge while also having branches.
- A branch can have internal forward edges.
- A branch can merge into an existing node if the connection does not create a cycle.
- A branch can stay open without merging.
- Deleting a branch should delete only branch-owned nodes and branch edges.
- If a branch edge points to a shared existing node, deleting the branch must not delete that shared target node.
- Existing cross-task single-next links should remain compatible and should not be silently converted into branches.

## Migration And Data Safety

Migration must be additive.

- Existing boards without branch data load normally.
- Missing `branches` or `branchEdges` arrays default to empty arrays.
- Existing task nodes and edges are not rewritten unless a user explicitly creates or edits a branch.
- Demo, event, or tutorial logic must never overwrite user board data.
- If malformed branch data is found, StepView should ignore or quarantine only the malformed branch records instead of blocking the whole board.

## Success Metrics

Product success:

- Users understand the difference between main path, branch, partner line, and lover line without documentation.
- Users can create a branch from a node in under 10 seconds.
- Users can visually distinguish branch ownership/type on a busy board.
- Users perceive lover branch as delightful rather than intrusive.

Technical success:

- Existing tests still pass.
- Existing boards load without migration loss.
- Branch type and event pack additions do not require editing core graph operations.
- Delete behavior is covered by tests because it is the highest-risk destructive operation.

## Open Implementation Notes

The existing repository already has a plan for cross-task single-next links that intentionally excludes full branching. This branch-system design should be implemented as the next layer, not by retroactively changing the earlier MVP assumptions.

Recommended implementation order:

1. Add additive data structures and migration defaults.
2. Add pure graph operations and tests for create, merge, cycle prevention, and delete safety.
3. Add rendering for branch edges and anchors.
4. Add context menu flows.
5. Add branch type registry.
6. Add lover event pack as the first optional extension.
7. Add visual polish and small animations only after core behavior is stable.
