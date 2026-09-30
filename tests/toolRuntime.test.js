import { describe, expect, it } from "vitest";
import { createToolRegistry } from "../electron/agent/toolRegistry.js";
import { createToolRuntime } from "../electron/agent/toolRuntime.js";

function registryWith(tool) {
  const registry = createToolRegistry();
  registry.register(tool);
  return registry;
}

describe("tool runtime", () => {
  it("validates, scopes and audits read tools", async () => {
    const registry = createToolRegistry(); registry.register({ id: "state.read", inputSchema: { type: "object", required: ["key"] }, execute: async ({ key }) => ({ key }) });
    const audits = []; const runtime = createToolRuntime({ registry });
    const result = await runtime.run("state.read", { key: "x" }, { accountId: "a", audit: (event) => audits.push(event) });
    expect(result.result).toEqual({ key: "x" }); expect(audits[0]).toMatchObject({ toolId: "state.read", status: "success", accountId: "a" });
    await expect(runtime.run("state.read", {}, {})).rejects.toThrow("Missing required input: key");
  });

  it("reports unknown tools with a stable code", async () => {
    const runtime = createToolRuntime({ registry: createToolRegistry() });
    await expect(runtime.run("board.missing", {}, {})).rejects.toMatchObject({ code: "TOOL_NOT_FOUND" });
  });

  it("fails closed for write tools when no approval handler is configured", async () => {
    const registry = registryWith({ id: "board.apply", risk: "write", execute: async () => ({ ok: true }) });
    const audits = [];
    const runtime = createToolRuntime({ registry });

    await expect(runtime.run("board.apply", {}, { accountId: "a", audit: (event) => audits.push(event) })).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
    expect(audits[0]).toMatchObject({ toolId: "board.apply", status: "denied" });
  });

  it("runs write tools only when the approval handler agrees", async () => {
    const registry = registryWith({ id: "board.apply", risk: "write", execute: async () => ({ ok: true }) });
    const denied = createToolRuntime({ registry, approval: async () => false });
    const allowed = createToolRuntime({ registry, approval: async () => true });

    await expect(denied.run("board.apply", {}, { accountId: "a" })).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
    await expect(allowed.run("board.apply", {}, { accountId: "a" })).resolves.toMatchObject({ result: { ok: true } });
  });

  it("keeps propose tools runnable without an approval handler", async () => {
    const registry = registryWith({ id: "board.propose", risk: "propose", execute: async () => ({ type: "board_change" }) });
    const runtime = createToolRuntime({ registry });
    await expect(runtime.run("board.propose", {}, { accountId: "a" })).resolves.toMatchObject({ result: { type: "board_change" } });
  });

  it("honours a deny policy before executing", async () => {
    const registry = registryWith({ id: "state.read", execute: async () => ({ ok: true }) });
    const runtime = createToolRuntime({ registry, policy: { allow: () => false } });
    await expect(runtime.run("state.read", {}, { accountId: "a" })).rejects.toMatchObject({ code: "TOOL_NOT_PERMITTED" });
  });

  it("guards oversized and unserializable results", async () => {
    const registry = createToolRegistry();
    registry.register({ id: "state.big", execute: async () => ({ blob: "x".repeat(500) }) });
    registry.register({ id: "state.cycle", execute: async () => { const value = {}; value.self = value; return value; } });
    const runtime = createToolRuntime({ registry, maxOutputBytes: 100 });

    await expect(runtime.run("state.big", {}, { accountId: "a" })).rejects.toMatchObject({ code: "TOOL_OUTPUT_TOO_LARGE" });
    await expect(runtime.run("state.cycle", {}, { accountId: "a" })).rejects.toMatchObject({ code: "TOOL_OUTPUT_UNSERIALIZABLE" });
  });

  it("wraps tool failures with the tool id", async () => {
    const registry = registryWith({ id: "state.fail", execute: async () => { throw new Error("boom"); } });
    const runtime = createToolRuntime({ registry });
    await expect(runtime.run("state.fail", {}, { accountId: "a" })).rejects.toMatchObject({ code: "TOOL_EXECUTION_FAILED", toolId: "state.fail" });
  });

  it("aborts tools that exceed the timeout", async () => {
    const registry = registryWith({ id: "state.slow", execute: async () => new Promise((resolve) => setTimeout(resolve, 60)) });
    const runtime = createToolRuntime({ registry, timeoutMs: 10 });
    await expect(runtime.run("state.slow", {}, { accountId: "a" })).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
  });

  it("never lets an audit sink failure break a successful tool result", async () => {
    const registry = registryWith({ id: "state.read", execute: async () => ({ ok: true }) });
    const runtime = createToolRuntime({ registry, logger: { warn: () => {} } });
    await expect(runtime.run("state.read", {}, { accountId: "a", audit: () => { throw new Error("audit sink down"); } })).resolves.toMatchObject({ result: { ok: true } });
  });
});
