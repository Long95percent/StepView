const TOOL_ID_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
export const RISK_LEVELS = ["read", "propose", "write"];
const SCHEMA_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"];

export class ToolInputError extends Error {
  constructor(message, { path = "", toolId = null } = {}) {
    super(message);
    this.name = "ToolInputError";
    this.code = "TOOL_INPUT_INVALID";
    this.path = path;
    this.toolId = toolId;
  }
}

export class ToolDefinitionError extends Error {
  constructor(message, { toolId = null } = {}) {
    super(message);
    this.name = "ToolDefinitionError";
    this.code = "TOOL_DEFINITION_INVALID";
    this.toolId = toolId;
  }
}

function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(type, value) {
  switch (type) {
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

function assertSchemaShape(schema, { path, toolId }) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new ToolDefinitionError(`Schema at ${path || "input"} must be an object.`, { toolId });
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const type of types) {
      if (!SCHEMA_TYPES.includes(type)) throw new ToolDefinitionError(`Unsupported schema type "${type}" at ${path || "input"}.`, { toolId });
    }
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    throw new ToolDefinitionError(`Schema enum at ${path || "input"} must be an array.`, { toolId });
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    throw new ToolDefinitionError(`Schema required at ${path || "input"} must be an array.`, { toolId });
  }
  for (const [key, child] of Object.entries(schema.properties || {})) {
    assertSchemaShape(child, { path: path ? `${path}.${key}` : key, toolId });
  }
  if (schema.items !== undefined) assertSchemaShape(schema.items, { path: `${path || "input"}[]`, toolId });
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    assertSchemaShape(schema.additionalProperties, { path: `${path || "input"}.*`, toolId });
  }
}

export function assertInputSchema(schema, { toolId = null } = {}) {
  if (schema === undefined) return { type: "object", properties: {} };
  assertSchemaShape(schema, { path: "", toolId });
  return schema;
}

export function validateAgainstSchema(schema, value, { path = "", toolId = null } = {}) {
  if (!schema || typeof schema !== "object") return;
  const location = path || "input";

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new ToolInputError(`${location} must be one of: ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}.`, { path: location, toolId });
  }

  if (value === undefined || value === null) {
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (value === null && !types.includes("null")) throw new ToolInputError(`${location} must be ${types.join(" or ")}.`, { path: location, toolId });
    }
    return;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(type, value))) {
      throw new ToolInputError(`${location} must be ${types.join(" or ")}, received ${describe(value)}.`, { path: location, toolId });
    }
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new ToolInputError(`${location} must be at least ${schema.minLength} characters.`, { path: location, toolId });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new ToolInputError(`${location} must be at most ${schema.maxLength} characters.`, { path: location, toolId });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) throw new ToolInputError(`${location} does not match the expected format.`, { path: location, toolId });
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) throw new ToolInputError(`${location} must be >= ${schema.minimum}.`, { path: location, toolId });
    if (schema.maximum !== undefined && value > schema.maximum) throw new ToolInputError(`${location} must be <= ${schema.maximum}.`, { path: location, toolId });
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new ToolInputError(`${location} must contain at least ${schema.minItems} items.`, { path: location, toolId });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new ToolInputError(`${location} must contain at most ${schema.maxItems} items.`, { path: location, toolId });
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(schema.items, item, { path: `${location}[${index}]`, toolId }));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (value[key] === undefined) throw new ToolInputError(`Missing required input: ${path ? `${path}.` : ""}${key}`, { path: path ? `${path}.${key}` : key, toolId });
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (value[key] === undefined) continue;
      validateAgainstSchema(childSchema, value[key], { path: path ? `${path}.${key}` : key, toolId });
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new ToolInputError(`Unknown input: ${path ? `${path}.` : ""}${key}`, { path: path ? `${path}.${key}` : key, toolId });
      }
    }
  }
}

export function validateToolInput(tool, input) {
  validateAgainstSchema(tool.inputSchema, input, { toolId: tool.id });
}

export function normalizeToolDefinition(definition = {}) {
  const { id, execute } = definition;
  if (!id || typeof id !== "string" || !TOOL_ID_PATTERN.test(id)) {
    throw new ToolDefinitionError(`Tool id "${id}" must look like "namespace.action".`, { toolId: id || null });
  }
  if (typeof execute !== "function") throw new ToolDefinitionError(`Tool "${id}" requires an execute function.`, { toolId: id });
  const risk = definition.risk || "read";
  if (!RISK_LEVELS.includes(risk)) throw new ToolDefinitionError(`Tool "${id}" risk "${risk}" must be one of: ${RISK_LEVELS.join(", ")}.`, { toolId: id });
  const scopes = definition.scopes || [];
  if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) {
    throw new ToolDefinitionError(`Tool "${id}" scopes must be an array of strings.`, { toolId: id });
  }
  const title = definition.title || id;
  if (typeof title !== "string" || !title.trim()) throw new ToolDefinitionError(`Tool "${id}" title must be a non-empty string.`, { toolId: id });

  return Object.freeze({
    id,
    version: definition.version || "1.0.0",
    title,
    description: definition.description || "",
    category: definition.category || id.split(".")[0],
    risk,
    scopes: Object.freeze([...scopes]),
    mutatesBoard: definition.mutatesBoard === true,
    inputSchema: Object.freeze(assertInputSchema(definition.inputSchema, { toolId: id })),
    execute,
  });
}
