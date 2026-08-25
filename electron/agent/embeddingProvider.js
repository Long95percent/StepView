export function createEmbeddingManager({ providers = [] } = {}) {
  const registry = new Map(providers.filter((p) => p?.id && typeof p.embed === "function").map((p) => [p.id, p]));
  function register(provider) { if (!provider?.id || typeof provider.embed !== "function") throw new Error("Embedding provider requires id and embed."); registry.set(provider.id, provider); }
  async function embed(text, options = {}) { const provider = registry.get(options.providerId) || registry.values().next().value; if (!provider) return null; return provider.embed(text, options); }
  return { register, embed, list: () => [...registry.keys()] };
}
