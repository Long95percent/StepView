import { describe, expect, it } from "vitest";
import { ToolDefinitionError, ToolInputError, normalizeToolDefinition, validateAgainstSchema, validateToolInput } from "../electron/agent/toolSchema.js";

describe("tool schema", () => {
  it("rejects malformed tool definitions", () => {
    expect(() => normalizeToolDefinition({ id: "bad id", execute: async () => {} })).toThrow(ToolDefinitionError);
    expect(() => normalizeToolDefinition({ id: "board.search" })).toThrow("requires an execute function");
    expect(() => normalizeToolDefinition({ id: "board.search", execute: async () => {}, risk: "danger" })).toThrow("must be one of");
    expect(() => normalizeToolDefinition({ id: "board.search", execute: async () => {}, title: "  " })).toThrow("non-empty string");
    expect(() => normalizeToolDefinition({ id: "board.search", execute: async () => {}, scopes: [1] })).toThrow("array of strings");
    expect(() => normalizeToolDefinition({ id: "board.search", execute: async () => {}, inputSchema: { type: "wat" } })).toThrow("Unsupported schema type");
  });

  it("applies defaults uniformly and freezes the definition", () => {
    const tool = normalizeToolDefinition({ id: "board.search", execute: async () => ({}) });
    expect(tool).toMatchObject({ version: "1.0.0", risk: "read", category: "board", mutatesBoard: false });
    expect(Object.isFrozen(tool)).toBe(true);
    expect(Object.isFrozen(tool.scopes)).toBe(true);
  });

  it("validates nested input and reports the failing path", () => {
    const schema = { type: "object", required: ["a"], properties: { a: { type: "object", required: ["b"], properties: { b: { type: "number" } } } } };
    expect(() => validateAgainstSchema(schema, {})).toThrow("Missing required input: a");
    expect(() => validateAgainstSchema(schema, { a: {} })).toThrow("Missing required input: a.b");
    expect(() => validateAgainstSchema(schema, { a: { b: "x" } })).toThrow("a.b must be number, received string");
    expect(() => validateAgainstSchema(schema, { a: { b: 1 } })).not.toThrow();
  });

  it("rejects unknown properties when additionalProperties is false", () => {
    const schema = { type: "object", additionalProperties: false, properties: { title: { type: "string" } } };
    expect(() => validateAgainstSchema(schema, { title: "ok" })).not.toThrow();
    expect(() => validateAgainstSchema(schema, { tittle: "typo" })).toThrow("Unknown input: tittle");
  });

  it("enforces enum, length, range and item limits", () => {
    expect(() => validateAgainstSchema({ type: "string", enum: ["task.create"] }, "task.delete")).toThrow("must be one of");
    expect(() => validateAgainstSchema({ type: "string", maxLength: 3 }, "abcd")).toThrow("at most 3 characters");
    expect(() => validateAgainstSchema({ type: "integer", minimum: 1, maximum: 5 }, 0)).toThrow(">= 1");
    expect(() => validateAgainstSchema({ type: "array", maxItems: 2, items: { type: "string" } }, ["a", "b", "c"])).toThrow("at most 2 items");
  });

  it("validates tool input through the tool definition", () => {
    const tool = normalizeToolDefinition({
      id: "board.search",
      execute: async () => ({}),
      inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1 } } },
    });
    expect(() => validateToolInput(tool, {})).toThrow(ToolInputError);
    expect(() => validateToolInput(tool, { query: "" })).toThrow("at least 1 characters");
    expect(() => validateToolInput(tool, { query: "x" })).not.toThrow();
  });
});
