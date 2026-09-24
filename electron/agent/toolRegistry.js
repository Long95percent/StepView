import { normalizeToolDefinition } from "./toolSchema.js";

function toMetadata(tool) {
  const { id, version, title, description, category, risk, scopes, mutatesBoard, inputSchema } = tool;
  return { id, version, title, description, category, risk, scopes: [...scopes], mutatesBoard, inputSchema };
}

export function createToolRegistry() {
  const tools = new Map();

  function register(definition) {
    const tool = normalizeToolDefinition(definition);
    if (tools.has(tool.id)) throw new Error(`Tool "${tool.id}" is already registered.`);
    tools.set(tool.id, tool);
    return tool.id;
  }

  function registerAll(definitions = []) {
    const registered = [];
    for (const definition of definitions) registered.push(register(definition));
    return registered;
  }

  function get(id) { return tools.get(id) || null; }
  function has(id) { return tools.has(id); }
  function list(filter = {}) {
    return [...tools.values()]
      .filter((tool) => (!filter.category || tool.category === filter.category) && (!filter.risk || tool.risk === filter.risk))
      .map(toMetadata);
  }
  function describe(id) { const tool = tools.get(id); return tool ? toMetadata(tool) : null; }
  function size() { return tools.size; }

  return { register, registerAll, get, has, list, describe, size };
}
