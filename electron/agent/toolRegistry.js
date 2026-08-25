export function createToolRegistry() {
  const tools = new Map();
  function register(tool) { if (!tool?.id || typeof tool.execute !== "function") throw new Error("Tool requires id and execute."); tools.set(tool.id, tool); return tool.id; }
  function get(id) { return tools.get(id) || null; }
  function list() { return [...tools.values()].map(({ id, version = "1.0.0", risk = "read", scopes = [], title = id }) => ({ id, version, risk, scopes, title })); }
  return { register, get, list };
}
