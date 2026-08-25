/**
 * Coordinates pluggable memory providers. Providers are candidates, while the
 * local repository remains the authoritative, auditable store.
 */
export function createMemoryPluginManager({ providers = [] } = {}) {
  const registry = new Map();
  for (const provider of providers) register(provider);

  function register(provider) {
    if (!provider?.id || typeof provider.search !== "function") {
      throw new Error("Memory provider requires an id and search function.");
    }
    registry.set(provider.id, provider);
    return provider.id;
  }

  function unregister(id) { return registry.delete(id); }
  function list() { return [...registry.values()].map(({ id, version = "1.0.0", capabilities = [] }) => ({ id, version, capabilities })); }

  async function search(query, context = {}, options = {}) {
    const selected = options.providers || [...registry.keys()];
    const results = [];
    for (const id of selected) {
      const provider = registry.get(id);
      if (!provider || provider.enabled?.(context) === false) continue;
      const items = await provider.search(query, context, options) || [];
      results.push(...items.map((item) => ({ ...item, providerId: id })));
    }
    return results;
  }

  async function close() {
    await Promise.all([...registry.values()].map((provider) => provider.close?.()));
  }

  return { register, unregister, list, search, close };
}
