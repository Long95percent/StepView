import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../electron/agent/toolRegistry.js";
import { registerBuiltInTools } from "../electron/agent/builtInTools.js";
import { createToolRuntime } from "../electron/agent/toolRuntime.js";

describe("built-in tools", () => {
  it("exposes scoped read tools", async () => {
    const registry = createToolRegistry(); registerBuiltInTools({ registry });
    const runtime = createToolRuntime({ registry });
    const result = await runtime.run("agent.get_current_context", {}, { accountId: "a", sessionId: "s" });
    expect(result.result).toMatchObject({ accountId: "a", sessionId: "s" });
    expect(registry.list().map((tool) => tool.id)).toContain("memory.search");
  });
  it("creates proposals without mutating stores", async () => {
    const registry = createToolRegistry(); registerBuiltInTools({ registry });
    const runtime = createToolRuntime({ registry, approval: async () => true });
    const result = await runtime.run("memory.propose_upsert", { category: "preference", subjectKey: "style", statement: "short" }, { accountId: "a" });
    expect(result.result).toMatchObject({ type: "memory_upsert", accountId: "a", memory: { status: "candidate" } });
  });
});
