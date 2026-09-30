import { createRedisClient } from "../agentRedisClient.js";

/**
 * Redis 健康探测。
 *
 * Redis 只是缓存（提示词状态、会话窗口），挂了应用照常跑，所以它不参与"就绪/不就绪"的判断，
 * 只在 readyz 里报一个降级。探测本身要够便宜：结果缓存几秒，别让探针把 Redis 打爆，
 * 也不能因为 Redis 卡住把 readyz 拖住——所以每条路径都有超时。
 */
export function createRedisProbe({
  url,
  timeoutMs = 1000,
  closeTimeoutMs = 300,
  cacheMs = 5000,
  now = () => Date.now(),
  clientFactory = createRedisClient,
} = {}) {
  let cached = null;

  function withTimeout(promise, ms, message) {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
        timer.unref?.();
      }),
    ]).finally(() => clearTimeout(timer));
  }

  async function run() {
    const startedAt = now();
    let client = null;
    try {
      client = clientFactory({ url });
      const reply = await withTimeout(client.command("PING"), timeoutMs, "Redis PING 超时。");
      return { ok: String(reply).toUpperCase() === "PONG", latencyMs: now() - startedAt, error: null };
    } catch (error) {
      return { ok: false, latencyMs: now() - startedAt, error: error?.message || String(error) };
    } finally {
      // close() 会先发 QUIT，Redis 不通时它自己也可能卡住，所以这里也加超时。
      if (client) await withTimeout(client.close(), closeTimeoutMs, "Redis 关闭超时。").catch(() => {});
    }
  }

  return {
    async check() {
      if (cached && now() - cached.at < cacheMs) return cached.result;
      const result = await run();
      cached = { at: now(), result };
      return result;
    },
    /** 测试和"刚改过配置"的场景用得上。 */
    reset() {
      cached = null;
    },
  };
}
