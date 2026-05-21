# Agent System Initial Design

> Status: initial product and architecture design. This document defines the first direction for adding a built-in Agent to StepView. It is intentionally scoped as a design draft, not an implementation plan.

## Goal

Add a built-in Agent to StepView that can chat with the user, understand whether people and relationship branches have progressed, propose safe canvas updates, maintain its own long-term memory, and eventually receive messages through WeChat.

The Agent should feel like a lightweight companion inside StepView, not a rigid chatbot. It should speak briefly, remember useful context, and help the user turn life, projects, relationships, and thoughts into visible progress on the canvas.

## Product Positioning

Feature name: 内置 Agent 智能体

Core promise: 陪你聊天，也帮你把推进变成可确认的路线。

The Agent is not an automatic board editor. It is a thinking and proposal layer. Any change that affects user board data must be shown as a confirmation card before it is applied.

## Product Principles

- User board safety first: the Agent must never directly overwrite, replace, or silently rewrite user board data.
- Confirm before acting: all canvas mutations created by the Agent must pass through explicit user confirmation.
- Local-first by default: early versions should work with local desktop data before adding cloud or external messaging dependencies.
- Separate identities: the user has a user canvas; the Agent has its own independent canvas and memory space.
- Short and alive: the Agent should speak in concise, natural, emotionally aware language.
- Inspectable memory: user preferences and long-term memories should be viewable, editable, and removable by the user.
- Incremental intelligence: start with reliable narrow actions before adding autonomous planning or external connectors.

## User Stories

### Basic Chat

As a user, I can chat with the Agent inside StepView so I can reflect, plan, and ask for lightweight help without leaving the app.

Flow:

1. User opens the Agent panel.
2. User sends a message.
3. Agent replies with a concise, human-like response.
4. Conversation history is saved locally.

### Detect Relationship Progress

As a user, I can casually describe something that happened with a person, and the Agent can notice possible progress on a related branch.

Example message:

> 今天和小A聊得还不错，感觉关系近了一点。

Flow:

1. Agent identifies the person or relationship entity.
2. Agent checks whether that person is already represented on the user canvas.
3. Agent determines whether the message implies meaningful progress.
4. Agent creates a pending confirmation card instead of changing the board directly.
5. User confirms, edits, or rejects the card.
6. Only after confirmation is the board updated.

### Confirm Canvas Update

As a user, I can review proposed canvas changes before they affect my board.

Confirmation card examples:

- Add a milestone to a relationship branch.
- Add a planned milestone to an existing goal.
- Create a new person branch from a relevant node.
- Update the detail of an existing node.
- Link two related goals.

Card actions:

- `确认添加`
- `改一下`
- `忽略`
- `以后别这样记`

### Agent Own Canvas

As a user, I can let the Agent maintain its own canvas so it can organize what it has learned without polluting my main board.

The Agent canvas can store:

- User preference nodes.
- Important people and relationship hypotheses.
- Learned concepts and conclusions.
- Open questions the Agent wants to clarify later.
- Tasks the Agent sets for itself, such as `观察用户更喜欢哪种提醒方式`.

The Agent canvas is not the user canvas. It can inform suggestions, but it cannot directly create user-board mutations without confirmation.

### Long-Term Learning

As a user, I want the Agent to gradually understand me over time, while still letting me correct or delete memories.

Memory examples:

- The user likes short replies.
- The user is building StepView.
- The user treats relationship progress as something worth visualizing.
- The user dislikes destructive demos or automatic overwrites.
- The user prefers suggestions that feel light, not preachy.

### WeChat Message Entry

As a user, I eventually want the Agent to have its own WeChat account or WeChat-facing identity so I can message it outside StepView.

Early design stance:

- WeChat should be treated as an external message connector.
- Messages from WeChat should enter the same Agent inbox as desktop chat messages.
- WeChat should not receive special permission to mutate the board.
- Any board update triggered by WeChat messages still requires confirmation in StepView unless the user explicitly enables a narrower trusted mode later.

## Scope

### In Scope For First Agent Release

- Add an in-app Agent chat panel.
- Store local conversation history.
- Add an Agent service boundary that can later call a model provider.
- Add a proposal system for pending canvas update cards.
- Support a small first set of proposal actions, such as adding milestones to existing tasks or branches.
- Add local Agent memory storage with user-editable preference and fact entries.
- Keep all Agent-created canvas changes non-destructive and confirmation-gated.

### Out Of Scope For First Agent Release

- Fully autonomous board editing.
- Real WeChat account automation.
- Cloud sync.
- Multi-user collaboration.
- Complex vector database infrastructure.
- Agent-to-Agent collaboration.
- Unbounded background tasks.
- Auto-import demos or sample boards that overwrite user data.

## Existing Project Fit

StepView currently has a compact architecture:

- `src/main.jsx` owns most UI state and rendering.
- `src/progressCore.js` owns board operations and graph rules.
- `electron/main.js` exposes IPC handlers for board load, save, and reveal.
- `electron/boardStorage.js` persists local board data.

The Agent feature should not be implemented as a large block inside `src/main.jsx`. The existing file can host the first panel UI, but Agent logic should live in separate modules so memory, proposals, model calls, and external connectors remain testable.

## Proposed Architecture

### 1. Agent UI Layer

Responsibilities:

- Render the Agent panel.
- Render chat messages.
- Render pending confirmation cards.
- Let the user accept, edit, reject, or mute suggestions.

This layer should not decide how to mutate the board. It should call proposal application functions after user confirmation.

### 2. Agent Runtime Layer

Responsibilities:

- Receive user messages.
- Build model context from recent chat, relevant board state, and selected memory.
- Produce a conversational reply.
- Produce structured analysis results and proposal candidates.

The runtime should return structured data, not free-form instructions for the UI to parse.

### 3. Canvas Intent Layer

Responsibilities:

- Convert Agent analysis into board-safe intentions.
- Match mentioned people to existing tasks, branches, or nodes.
- Decide whether a candidate update is specific enough to become a confirmation card.
- Reject vague or risky updates.

Example intent:

```json
{
  "type": "add_branch_milestone",
  "confidence": 0.82,
  "reason": "User described a clear relationship progress event with 小A.",
  "target": {
    "branchId": "branch-...",
    "afterNodeId": "node-..."
  },
  "draft": {
    "title": "聊天更自然了",
    "detail": "用户提到今天和小A聊得不错，感觉关系近了一点。",
    "emoji": "💗"
  }
}
```

### 4. Proposal Layer

Responsibilities:

- Store pending proposal cards.
- Record accepted and rejected proposal history.
- Apply accepted proposals using existing board core functions.
- Prevent proposal actions that would delete or replace unrelated user data.

Proposal states:

- `pending`
- `accepted`
- `edited`
- `rejected`
- `muted`
- `applied`
- `failed`

### 5. Memory Layer

Responsibilities:

- Maintain short-term conversation context.
- Store explicit user preferences.
- Store stable facts.
- Store episodic events.
- Store Agent-generated insights.
- Expose memory review and deletion controls.

Memory should include source metadata so the Agent can explain why it believes something.

### 6. Agent Board Layer

Responsibilities:

- Store the Agent's own canvas separately from the user's board.
- Let the Agent organize knowledge as nodes and links.
- Allow internal Agent tasks without affecting user tasks.
- Support future visualization of the Agent's thinking.

The Agent board can reuse parts of the existing board model, but it should have a separate storage key or file.

### 7. External Connector Layer

Responsibilities:

- Normalize external messages into the Agent inbox format.
- Keep connector-specific authentication and event handling outside the Agent runtime.
- Support WeChat later through a compliant integration path.

Initial connector interface:

```json
{
  "source": "desktop" | "wechat",
  "senderId": "local-user-or-external-id",
  "text": "message text",
  "receivedAt": "ISO timestamp",
  "metadata": {}
}
```

## Data Model Draft

### Agent State

```json
{
  "version": 1,
  "profile": {
    "name": "StepView Agent",
    "tone": "short_alive_warm"
  },
  "conversations": [],
  "memories": [],
  "proposals": [],
  "agentBoard": {
    "tasks": [],
    "stickers": [],
    "links": [],
    "branches": [],
    "achievements": []
  },
  "updatedAt": null
}
```

### Memory Entry

```json
{
  "id": "memory-...",
  "kind": "preference" | "fact" | "episode" | "insight" | "rule",
  "text": "用户喜欢简洁、有灵气的表达。",
  "confidence": 0.9,
  "source": {
    "type": "chat",
    "messageId": "message-..."
  },
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp",
  "status": "active"
}
```

### Proposal Entry

```json
{
  "id": "proposal-...",
  "kind": "canvas_update",
  "status": "pending",
  "summary": "给小A支线添加一个新进展。",
  "reason": "用户提到今天聊天更自然，关系近了一点。",
  "action": {
    "type": "add_branch_milestone",
    "target": {
      "branchId": "branch-...",
      "afterNodeId": "node-..."
    },
    "draft": {
      "title": "聊天更自然了",
      "detail": "今天和小A聊得不错，感觉关系近了一点。",
      "emoji": "💗"
    }
  },
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

## Safety Rules

- The Agent must never call a board mutation directly from raw model output.
- The Agent must never clear the board, import demo data, or replace user data.
- The Agent must never silently create relationship branches from ambiguous input.
- Low-confidence analysis should become a chat question, not a proposal.
- Proposal application must use typed action handlers, not arbitrary code execution.
- Rejected proposals should teach the Agent user preference when appropriate.
- User must be able to inspect and delete memories.

## Personality Direction

The Agent should feel concise, warm, and alive.

Reply style:

- Prefer 1 to 3 short sentences.
- Reflect the user's emotion before suggesting structure.
- Avoid long lectures.
- Avoid generic assistant phrases.
- Use gentle uncertainty when inferring relationships.
- Ask before turning private or emotional events into permanent board data.

Example:

User:

> 今天和小A聊得还不错，感觉关系近了一点。

Agent:

> 嗯，这像是一个小推进。要不要我帮你记到小A那条支线上？我先生成一张卡，你确认了再放进去。

## WeChat Integration Notes

WeChat should be treated carefully because real account automation can involve platform restrictions, account risk, and maintenance burden.

Preferred path:

1. First build desktop Agent inbox.
2. Then define external message connector interfaces.
3. Then evaluate compliant WeChat options such as official accounts, enterprise WeChat, or a user-approved bridge.
4. Only after connector stability is proven should WeChat replies and notifications be enabled.

Even after WeChat is connected, board mutations should remain confirmation-gated in StepView.

## Milestone Roadmap

### Phase 1: Local Chat MVP

- Add Agent panel.
- Add local conversation storage.
- Add Agent runtime interface.
- Support basic chat with a model provider or local mock provider.

### Phase 2: Proposal Cards

- Add pending proposal storage.
- Add proposal card UI.
- Add typed handlers for safe board mutations.
- Support milestone and branch-milestone proposals.

### Phase 3: Memory MVP

- Add memory entries for preferences, facts, and rules.
- Add memory review UI.
- Let rejected proposals update suggestion preferences.
- Include relevant memories in Agent context.

### Phase 4: Agent Own Canvas

- Add independent Agent board storage.
- Let the Agent organize learned knowledge and open questions.
- Provide a read-only or review-first UI for the Agent board.

### Phase 5: WeChat Connector

- Add normalized external inbox events.
- Integrate a compliant WeChat message source.
- Route WeChat messages through the same Agent runtime.
- Keep confirmation cards inside StepView.

### Phase 6: Lifelong Learning Refinement

- Add memory confidence decay.
- Add memory conflict detection.
- Add summarization of old episodes.
- Add user-controlled privacy and export tools.

## Open Questions

- Should the first Agent provider be cloud-based, local, or pluggable from day one?
- Should Agent state be stored in the same board file or a separate `stepview-agent.json` file?
- Should the Agent panel be always visible, docked, or opened as a floating companion?
- How should the user edit a generated confirmation card before applying it?
- What is the minimum useful memory UI for the first release?
- Which WeChat integration route is acceptable for the user's intended distribution model?

## Recommended First Implementation Boundary

The first implementation should stop at local chat plus proposal cards. This is enough to validate whether the Agent feels useful and safe without taking on the hardest parts of lifelong memory and WeChat integration immediately.

The minimal valuable version is:

1. User chats with Agent in StepView.
2. Agent replies naturally.
3. Agent can detect a small set of canvas-worthy events.
4. Agent creates pending confirmation cards.
5. User confirms a card.
6. StepView applies the card through existing board functions.

