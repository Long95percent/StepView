/**
 * 登录失败退避。
 *
 * 没有这一层时，登录接口就是一个可以无限次尝试的密码校验器：用户名规则是公开的
 * （3-64 位小写），密码只要求 8 位，scrypt 只让它变慢、不让它变难。上公网之前必须补上。
 *
 * 两个计数桶：
 *   - 一个"凭据"（IP + 用户名）：拦住针对某个账号的猜密码；
 *   - 一台机器（IP）：拦住"换着用户名试"。阈值放宽一些，因为同一出口 IP 后面
 *     可能真有多个正常用户（家庭、公司、NAT）。
 *
 * 超限之后是指数退避而不是永久封禁：正常用户等一会儿就能回来，
 * 而爆破的成本被拉到不现实。状态只在内存里——进程重启就清零，
 * 这个取舍是有意的：把它写进库等于给了攻击者一个"把磁盘写满"的开关。
 */

const DEFAULTS = {
  maxFailures: 5,
  ipMaxFailures: 20,
  windowMs: 15 * 60 * 1000,
  lockoutMs: 15 * 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
  // 桶的绝对上限，防止有人拿随机用户名把内存撑爆。
  maxBuckets: 5000,
};

export function createLoginThrottle({
  now = () => Date.now(),
  maxFailures = DEFAULTS.maxFailures,
  ipMaxFailures = DEFAULTS.ipMaxFailures,
  windowMs = DEFAULTS.windowMs,
  lockoutMs = DEFAULTS.lockoutMs,
  maxLockoutMs = DEFAULTS.maxLockoutMs,
  maxBuckets = DEFAULTS.maxBuckets,
} = {}) {
  const buckets = new Map();

  function read(key) {
    const existing = buckets.get(key);
    if (existing) return existing;
    if (buckets.size >= maxBuckets) buckets.delete(buckets.keys().next().value);
    const created = { failures: [], lockedUntil: 0, lockCount: 0 };
    buckets.set(key, created);
    return created;
  }

  /** 退避时长：超过阈值后每多失败一轮翻倍，封顶 maxLockoutMs。 */
  function lockoutFor(bucket) {
    return Math.min(lockoutMs * 2 ** Math.max(0, bucket.lockCount - 1), maxLockoutMs);
  }

  function blockedSeconds(key) {
    const bucket = buckets.get(key);
    if (!bucket?.lockedUntil) return 0;
    const remaining = bucket.lockedUntil - now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  function recordFailure(key, limit) {
    const bucket = read(key);
    const timestamp = now();
    bucket.failures = bucket.failures.filter((entry) => timestamp - entry < windowMs);
    bucket.failures.push(timestamp);
    if (bucket.failures.length >= limit) {
      bucket.lockCount += 1;
      bucket.lockedUntil = timestamp + lockoutFor(bucket);
      bucket.failures = [];
    }
  }

  function keysFor({ ip = "", username = "" } = {}) {
    const machine = String(ip || "unknown");
    return {
      ip: `ip:${machine}`,
      // 用户名只作为桶名的一部分，不参与授权判断。
      account: `account:${machine}|${String(username || "").toLowerCase().slice(0, 64)}`,
    };
  }

  return {
    /** 现在还能不能试。返回还要等多少秒，0 表示可以。 */
    blockedFor(attempt) {
      const keys = keysFor(attempt);
      return Math.max(blockedSeconds(keys.account), blockedSeconds(keys.ip));
    },

    recordFailure(attempt) {
      const keys = keysFor(attempt);
      recordFailure(keys.account, maxFailures);
      recordFailure(keys.ip, ipMaxFailures);
    },

    /** 成功一次就把这个人（含他这台机器上的账号桶）的失败记录清掉。 */
    recordSuccess(attempt) {
      const keys = keysFor(attempt);
      buckets.delete(keys.account);
    },

    /** 丢掉已经过期的桶，避免内存随历史 IP 无限增长。 */
    sweep() {
      const timestamp = now();
      for (const [key, bucket] of buckets) {
        const expired = bucket.lockedUntil <= timestamp && bucket.failures.every((entry) => timestamp - entry >= windowMs);
        if (expired) buckets.delete(key);
      }
    },

    get size() {
      return buckets.size;
    },
  };
}
