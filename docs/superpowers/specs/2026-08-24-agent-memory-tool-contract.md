# Agent Memory Contract

## Scope

Every memory operation is bound to `accountId`, `agentId`, and optionally
`workspaceId`, `sessionId`, or a task scope. These values are injected by the
Gateway context; Renderer and model payloads cannot select an account.

## Lifecycle

Memory starts as `candidate` and may become `active` only through policy,
repeated evidence, or explicit user confirmation. Conflicts create separate
versions/relations. User deletion sets a durable `deleted` tombstone and an
audit feedback row, so automatic extraction cannot silently restore it.

## Plugin boundary

`memoryRepository` is the local authoritative store. `memoryPlugins` supplies
optional candidate providers (Mem0, vector search, or future services). A
provider can be registered, disabled, replaced, or removed independently and
must receive the injected account scope through its context.
