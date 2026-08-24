function validateInput(schema, input) {
  if (!schema || schema.type !== "object") return;
  for (const key of schema.required || []) if (input?.[key] === undefined) throw new Error(`Missing tool input: ${key}`);
}

export function createToolRuntime({ registry, policy = {}, approval, logger = console, timeoutMs = 10000, maxOutputBytes = 100000 } = {}) {
  if (!registry) throw new Error("Tool registry is required.");
  async function run(toolId, input = {}, context = {}) {
    const tool = registry.get(toolId); if (!tool) throw new Error(`Unknown tool: ${toolId}`);
    validateInput(tool.inputSchema, input);
    if (policy.allow && policy.allow(tool, context) === false) throw new Error("Tool permission denied.");
    if (tool.risk !== "read" && approval && !(await approval(tool, context))) throw new Error("Tool approval denied.");
    const started = Date.now(); const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await tool.execute(input, { ...context, abortSignal: controller.signal });
      const serialized = JSON.stringify(result ?? null); if (Buffer.byteLength(serialized) > maxOutputBytes) throw new Error("Tool output too large.");
      const audit = { toolRunId: `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`, toolId, status: "success", durationMs: Date.now() - started, accountId: context.accountId || null };
      context.audit?.(audit); return { result, audit };
    } catch (error) {
      const audit = { toolId, status: controller.signal.aborted ? "timeout" : "error", durationMs: Date.now() - started, errorType: error.name, accountId: context.accountId || null };
      logger.warn?.("Tool execution failed", error); context.audit?.(audit); throw error;
    } finally { clearTimeout(timer); }
  }
  return { run };
}
