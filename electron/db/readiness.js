import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * 就绪探针（readyz 用的那几项检查）。
 *
 * 放在 db 层是因为它要真的写一下数据目录、摸一下 SQLite 连接——这两件事按边界约定
 * 只能在 electron/db/ 里做。上层（网关）只拿结论，不自己判断"什么算就绪"。
 */

// 低于这个剩余空间就算不健康。SQLite 写满会把 WAL 撑爆，宁可提前在探针上报警。
export const DEFAULT_MIN_FREE_BYTES = 512 * 1024 * 1024;

const PROBE_FILE_PREFIX = ".readiness-probe-";

/**
 * 数据目录能不能写、还剩多少空间。
 *
 * 只读挂载（容器里最常见的部署事故）在这里会立刻暴露，而不是等用户写日记时才炸。
 */
export function checkDataDir({ dataDir, fsApi = fs, minFreeBytes = DEFAULT_MIN_FREE_BYTES } = {}) {
  const result = { ok: false, dir: dataDir || "", writable: false, freeBytes: null, minFreeBytes, error: null };
  if (!dataDir) {
    result.error = "数据目录未配置。";
    return result;
  }
  const probePath = path.join(dataDir, `${PROBE_FILE_PREFIX}${randomUUID()}`);
  let probeCreated = false;
  try {
    fsApi.mkdirSync(dataDir, { recursive: true });
    fsApi.writeFileSync(probePath, String(Date.now()), { flag: "wx" });
    probeCreated = true;
    fsApi.unlinkSync(probePath);
    probeCreated = false;
    result.writable = true;
  } catch (error) {
    if (probeCreated) {
      try {
        fsApi.unlinkSync(probePath);
      } catch {
        // 探针清理失败不覆盖原始写入错误。
      }
    }
    result.error = error.message;
    return result;
  }
  try {
    const stats = fsApi.statfsSync(dataDir);
    result.freeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch (error) {
    // 探测空间失败不算致命：能不能写才是硬指标，空间这一项退化成"未知"。
    result.error = error.message;
  }
  result.ok = result.freeBytes === null || result.freeBytes >= minFreeBytes;
  return result;
}

/** 连接还活着吗。读不出来就是不可用——不用搞清楚是哪一种坏。 */
export function checkDatabase({ connection } = {}) {
  if (!connection?.db) return { ok: false, error: "数据库连接不存在。" };
  try {
    connection.db.prepare("SELECT 1 AS ok").get();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * 把三项检查汇总成 readyz 的响应体。
 *
 * 只有数据目录和数据库算"硬要求"，Redis 挂了只是降级：它只缓存提示词和窗口，
 * 丢了能重建（见 contextCache 的说明）。所以 redis 失败会进 degraded，但不会让 ok 变 false。
 */
export function summarizeReadiness({ dataDir, database, redis = null, startedAt = null, now = () => Date.now() } = {}) {
  const degraded = [];
  if (redis && redis.ok === false) degraded.push("redis");
  return {
    ok: Boolean(dataDir?.ok && database?.ok),
    degraded,
    uptimeSeconds: startedAt === null ? null : Math.max(0, Math.round((now() - startedAt) / 1000)),
    checks: { dataDir, database, redis },
  };
}
