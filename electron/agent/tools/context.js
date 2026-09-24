export function requireToolContext(context, keys, toolId) {
  const missing = keys.filter((key) => context?.[key] === undefined || context?.[key] === null);
  if (missing.length) throw new Error(`Tool "${toolId}" is missing required context: ${missing.map((key) => `context.${key}`).join(", ")}.`);
  return context;
}
