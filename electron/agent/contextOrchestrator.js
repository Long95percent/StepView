function estimateTokens(text) { return Math.ceil(String(text || "").length / 2); }

export function createContextOrchestrator({ repository, memoryPlugins } = {}) {
  if (!repository) throw new Error("Memory repository is required.");
  async function retrieve(query, options = {}) {
    const limit = options.limit || 12;
    const local = repository.search(query, { scopeType: options.scopeType, status: options.status || "active", limit });
    const external = memoryPlugins ? await memoryPlugins.search(query, options.context || {}, options).catch(() => []) : [];
    const seen = new Set();
    const candidates = [...local.map((item) => ({ ...item, origin: "local" })), ...external.map((item) => ({ ...item, origin: "plugin" }))]
      .filter((item) => { if (seen.has(item.id || `${item.providerId}:${item.statement}`)) return false; seen.add(item.id || `${item.providerId}:${item.statement}`); return true; })
      .filter((item) => item.status !== "deleted" && item.status !== "expired")
      .sort((a, b) => (b.importance || 0) + (b.confidence || 0) - (a.importance || 0) - (a.confidence || 0));
    const result = [];
    let budget = options.tokenBudget || 1200;
    for (const item of candidates) {
      const pack = { memoryId: item.id || null, category: item.category || "semantic", statement: item.statement, confidence: item.confidence ?? 0, status: item.status || "active", scope: item.scopeType || "user", evidence: item.evidenceSummary ? [item.evidenceSummary] : [], whyRetrieved: `与当前请求中的“${query}”相关`, origin: item.origin };
      const cost = estimateTokens(pack.statement);
      if (cost > budget) continue;
      budget -= cost; result.push(pack);
    }
    return { query, items: result, tokenBudget: options.tokenBudget || 1200, remainingTokens: budget };
  }
  return { retrieve };
}
