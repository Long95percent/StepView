import { ToolInputError, ToolDefinitionError, validateToolInput } from "./toolSchema.js";

export class ToolExecutionError extends Error {
  constructor(message, { code = "TOOL_EXECUTION_FAILED", toolId = null, cause = null } = {}) {
    super(message);
    this.name = "ToolExecutionError";
    this.code = code;
    this.toolId = toolId;
    if (cause) this.cause = cause;
  }
}

function safeSerialize(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (error) {
    throw new ToolExecutionError("Tool result is not serializable.", { code: "TOOL_OUTPUT_UNSERIALIZABLE", cause: error });
  }
}

function abortable(promise, signal, buildError) {
  if (signal.aborted) return Promise.reject(buildError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(buildError());
    signal.addEventListener("abort", onAbort, { once: true });
    const settle = (callback) => (value) => {
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    Promise.resolve(promise).then(settle(resolve), settle(reject));
  });
}

function safeAudit(context, event, logger) {
  if (typeof context?.audit !== "function") return;
  try {
    context.audit(event);
  } catch (error) {
    logger?.warn?.("Tool audit sink failed", error);
  }
}

export function createToolRuntime({ registry, policy = {}, approval, logger = console, timeoutMs = 10000, maxOutputBytes = 100000, requireApprovalForWrite = true } = {}) {
  if (!registry) throw new Error("Tool registry is required.");

  async function gate(tool, context) {
    if (policy.allow && policy.allow(tool, context) === false) return { allowed: false, reason: "Tool permission denied." };
    if (tool.risk === "read") return { allowed: true };
    if (approval) {
      const approved = await approval(tool, context);
      return approved ? { allowed: true } : { allowed: false, reason: `Tool approval denied: ${tool.id}` };
    }
    if (tool.risk === "write" && requireApprovalForWrite) {
      return { allowed: false, reason: `Tool "${tool.id}" mutates user data and requires an approval handler.` };
    }
    return { allowed: true };
  }

  async function run(toolId, input = {}, context = {}) {
    const tool = registry.get(toolId);
    if (!tool) throw new ToolExecutionError(`Unknown tool: ${toolId}`, { code: "TOOL_NOT_FOUND", toolId });

    try {
      validateToolInput(tool, input);
    } catch (error) {
      if (error instanceof ToolInputError || error instanceof ToolDefinitionError) {
        throw new ToolExecutionError(error.message, { code: error.code, toolId });
      }
      throw error;
    }

    const gateResult = await gate(tool, context);
    if (!gateResult.allowed) {
      safeAudit(context, { toolId, status: "denied", accountId: context.accountId || null, reason: gateResult.reason }, logger);
      throw new ToolExecutionError(gateResult.reason, { code: "TOOL_NOT_PERMITTED", toolId });
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await abortable(
        tool.execute(input, { ...context, abortSignal: controller.signal }),
        controller.signal,
        () => new ToolExecutionError(`Tool "${toolId}" timed out after ${timeoutMs}ms.`, { code: "TOOL_TIMEOUT", toolId }),
      );
      const bytes = Buffer.byteLength(safeSerialize(result));
      if (bytes > maxOutputBytes) throw new ToolExecutionError(`Tool output too large (${bytes} bytes).`, { code: "TOOL_OUTPUT_TOO_LARGE", toolId });
      const audit = { toolRunId: `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`, toolId, risk: tool.risk, status: "success", durationMs: Date.now() - started, accountId: context.accountId || null };
      safeAudit(context, audit, logger);
      return { result, audit };
    } catch (error) {
      const status = controller.signal.aborted ? "timeout" : "error";
      const wrapped = error instanceof ToolExecutionError
        ? error
        : new ToolExecutionError(controller.signal.aborted ? `Tool "${toolId}" timed out after ${timeoutMs}ms.` : error.message, { code: controller.signal.aborted ? "TOOL_TIMEOUT" : "TOOL_EXECUTION_FAILED", toolId, cause: error });
      safeAudit(context, { toolId, risk: tool.risk, status, durationMs: Date.now() - started, errorType: error.name, accountId: context.accountId || null }, logger);
      logger.warn?.("Tool execution failed", error);
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  return { run };
}
