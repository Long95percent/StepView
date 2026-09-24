import { normalizeToolDefinition } from "../toolSchema.js";

export function defineTool(definition) {
  return normalizeToolDefinition(definition);
}
