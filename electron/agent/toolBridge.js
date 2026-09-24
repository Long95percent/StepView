export function createToolContext(context, sessionId, extra = {}) {
  return {
    accountId: context.accountId,
    agentId: "user",
    sessionId,
    boardStorage: context.boardStorage,
    boardChangeStore: context.boardChangeStore,
    memoryRepository: context.memoryRepository,
    audit: (event) => sessionId && context.agentSqliteStore?.recordSignal?.({ sessionId, kind: "tool_run", payload: event }),
    ...extra,
  };
}

export function openAiToolSchemas(registry) {
  return (registry?.list?.() || []).map((tool) => ({
    type: "function",
    function: { name: tool.id, description: tool.description || tool.title, parameters: tool.inputSchema },
  }));
}

export function createToolRunner(context, sessionId, extra) {
  return (toolId, input) => context.toolRuntime
    .run(toolId, input, createToolContext(context, sessionId, extra))
    .then((value) => value.result);
}
