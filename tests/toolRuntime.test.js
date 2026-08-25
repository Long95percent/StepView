import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../electron/agent/toolRegistry.js";
import { createToolRuntime } from "../electron/agent/toolRuntime.js";

describe("tool runtime", () => {
  it("validates, scopes and audits read tools", async () => {
    const registry = createToolRegistry(); registry.register({ id: "state.read", inputSchema: { type: "object", required: ["key"] }, execute: async ({ key }) => ({ key }) });
    const audits = []; const runtime = createToolRuntime({ registry });
    const result = await runtime.run("state.read", { key: "x" }, { accountId: "a", audit: (event) => audits.push(event) });
    expect(result.result).toEqual({ key: "x" }); expect(audits[0]).toMatchObject({ toolId: "state.read", status: "success", accountId: "a" });
    await expect(runtime.run("state.read", {}, {})).rejects.toThrow("Missing tool input");
  });
});
