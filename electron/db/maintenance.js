import { RETENTION_RULES, runRetention } from "./retention.js";

export const DEFAULT_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 保留策略的执行调度。
 *
 * 一个库一个实例：启动时跑一次，之后每 24 小时跑一次。规则本身只写在 retention.js 里，
 * 这里只负责"什么时候跑"和"跑失败不要拖垮应用"。
 *
 * 定时器会 unref，测试和命令行进程不会被它吊住。
 */
export function createDatabaseMaintenance({
  connection,
  rules = RETENTION_RULES,
  intervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,
  now = () => new Date(),
  logger = console,
  setTimer = setInterval,
  clearTimer = clearInterval,
} = {}) {
  if (!connection?.db) throw new Error("createDatabaseMaintenance requires a database connection.");

  let timer = null;

  /** 立即执行一次。失败只记日志：清理失败不该让应用打不开。 */
  function runNow(reason = "manual") {
    try {
      return runRetention({ connection, rules, now: now(), logger });
    } catch (error) {
      logger.warn?.(`保留策略执行失败（${reason}）`, error);
      return null;
    }
  }

  function start({ runImmediately = true } = {}) {
    if (runImmediately) runNow("startup");
    if (!timer) {
      timer = setTimer(() => runNow("daily"), intervalMs);
      timer?.unref?.();
    }
    return timer;
  }

  function stop() {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
    return null;
  }

  return { start, stop, runNow, rules, isRunning: () => timer !== null };
}
