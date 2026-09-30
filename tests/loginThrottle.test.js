import { describe, expect, it } from "vitest";
import { createLoginThrottle } from "../electron/gateway/loginThrottle.js";

describe("login throttle", () => {
  it("starts letting everyone in", () => {
    const throttle = createLoginThrottle();
    expect(throttle.blockedFor({ ip: "1.2.3.4", username: "bob" })).toBe(0);
  });

  it("locks a credential after the configured number of failures", () => {
    let clock = 0;
    const throttle = createLoginThrottle({ now: () => clock, maxFailures: 3, lockoutMs: 1000 });
    const attempt = { ip: "1.2.3.4", username: "bob" };

    for (let i = 0; i < 3; i += 1) {
      expect(throttle.blockedFor(attempt)).toBe(0);
      throttle.recordFailure(attempt);
    }
    expect(throttle.blockedFor(attempt)).toBeGreaterThan(0);

    clock += 1001;
    expect(throttle.blockedFor(attempt)).toBe(0);
  });

  it("doubles the lockout instead of failing open", () => {
    let clock = 0;
    const throttle = createLoginThrottle({ now: () => clock, maxFailures: 2, lockoutMs: 60000, maxLockoutMs: 600000 });
    const attempt = { ip: "1.2.3.4", username: "bob" };

    throttle.recordFailure(attempt);
    throttle.recordFailure(attempt);
    expect(throttle.blockedFor(attempt)).toBe(60);

    clock += 60001;
    throttle.recordFailure(attempt);
    throttle.recordFailure(attempt);
    expect(throttle.blockedFor(attempt)).toBe(120);
  });

  it("counts one machine separately so usernames cannot be cycled", () => {
    let clock = 0;
    const throttle = createLoginThrottle({ now: () => clock, maxFailures: 2, ipMaxFailures: 4, lockoutMs: 1000 });
    // 每个用户名只试一次：凭据桶不会触发，但机器桶攒够 4 次就会。
    for (const username of ["a1", "a2", "a3", "a4"]) {
      throttle.recordFailure({ ip: "9.9.9.9", username });
    }
    expect(throttle.blockedFor({ ip: "9.9.9.9", username: "a5" })).toBeGreaterThan(0);
    // 换一台机器不受影响。
    expect(throttle.blockedFor({ ip: "8.8.8.8", username: "a5" })).toBe(0);
  });

  it("forgets an account's failures after a success", () => {
    let clock = 0;
    const throttle = createLoginThrottle({ now: () => clock, maxFailures: 3, lockoutMs: 1000 });
    const attempt = { ip: "1.2.3.4", username: "bob" };
    throttle.recordFailure(attempt);
    throttle.recordFailure(attempt);
    throttle.recordSuccess(attempt);
    throttle.recordFailure(attempt);
    throttle.recordFailure(attempt);
    // 只有成功之后的两笔算数，所以还没到 3 次。
    expect(throttle.blockedFor(attempt)).toBe(0);
  });

  it("sweeps idle buckets so memory does not grow forever", () => {
    let clock = 0;
    const throttle = createLoginThrottle({ now: () => clock, maxFailures: 3, windowMs: 1000, lockoutMs: 1000 });
    for (let i = 0; i < 20; i += 1) throttle.recordFailure({ ip: `10.0.0.${i}`, username: "bob" });
    expect(throttle.size).toBe(40);

    clock += 1001;
    throttle.sweep();
    expect(throttle.size).toBe(0);
  });
});
