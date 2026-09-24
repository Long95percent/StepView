const DEFAULT_MAX_CONTEXTS = 8;
const DEFAULT_IDLE_MS = 30 * 60 * 1000;

/**
 * 账号上下文缓存。
 *
 * 以前是 `new Map()` 只增不减：家庭模式下每访问过一个账号，就永久拖着一个 SQLite 连接和各种缓存，
 * 人越多内存越高，永远不释放。这里改成有容量上限和空闲淘汰的 LRU，淘汰时关闭上下文。
 *
 * 上下文是纯派生缓存：丢了可以随时从数据库重建，所以淘汰是安全的。
 */
export function createContextCache({
  maxContexts = DEFAULT_MAX_CONTEXTS,
  idleMs = DEFAULT_IDLE_MS,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!Number.isInteger(maxContexts) || maxContexts <= 0) throw new Error("maxContexts must be a positive integer.");
  if (!Number.isInteger(idleMs) || idleMs < 0) throw new Error("idleMs must be a non-negative integer.");

  const entries = new Map();

  function closeQuietly(accountId, context) {
    Promise.resolve()
      .then(() => context?.close?.())
      .catch((error) => logger.warn?.(`关闭账号上下文失败：${accountId}`, error));
  }

  function drop(accountId) {
    const entry = entries.get(accountId);
    if (!entry) return false;
    entries.delete(accountId);
    closeQuietly(accountId, entry.context);
    return true;
  }

  function get(accountId) {
    const entry = entries.get(accountId);
    if (!entry) return undefined;
    entry.lastUsedAt = now();
    entries.delete(accountId);
    entries.set(accountId, entry);
    return entry.context;
  }

  function set(accountId, context) {
    if (entries.has(accountId)) entries.delete(accountId);
    entries.set(accountId, { context, createdAt: now(), lastUsedAt: now() });
    while (entries.size > maxContexts) {
      const oldest = entries.keys().next().value;
      if (oldest === accountId) break;
      drop(oldest);
    }
    return context;
  }

  function sweep() {
    const deadline = now() - idleMs;
    const evicted = [];
    for (const [accountId, entry] of [...entries]) {
      if (accountId === [...entries.keys()].at(-1)) continue;
      if (entry.lastUsedAt <= deadline) {
        drop(accountId);
        evicted.push(accountId);
      }
    }
    return evicted;
  }

  async function closeAll() {
    const closing = [...entries.entries()];
    entries.clear();
    await Promise.allSettled(closing.map(([, entry]) => entry.context?.close?.()));
  }

  return { get, set, drop, sweep, closeAll, size: () => entries.size, maxContexts, idleMs };
}
