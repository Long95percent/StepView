import { describe, expect, it, vi } from "vitest";
import { createContextCache } from "../electron/gateway/contextCache.js";

function makeContext() {
  return { id: Math.random().toString(16), closed: 0, async close() { this.closed += 1; } };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("account context cache", () => {
  it("rejects nonsensical limits", () => {
    expect(() => createContextCache({ maxContexts: 0 })).toThrow(/positive integer/);
    expect(() => createContextCache({ idleMs: -1 })).toThrow(/non-negative/);
  });

  it("evicts the least recently used context and closes it", async () => {
    let clock = 0;
    const cache = createContextCache({ maxContexts: 2, now: () => clock });
    const first = makeContext();
    const second = makeContext();
    const third = makeContext();

    cache.set("a", first);
    cache.set("b", second);
    clock += 1;
    expect(cache.get("a")).toBe(first);

    clock += 1;
    cache.set("c", third);
    await flush();

    expect(cache.size()).toBe(2);
    expect(first.closed).toBe(0);
    expect(second.closed).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  it("sweeps contexts that have been idle longer than the limit", async () => {
    let clock = 0;
    const cache = createContextCache({ maxContexts: 5, idleMs: 100, now: () => clock });
    const idle = makeContext();
    const active = makeContext();
    cache.set("idle", idle);
    cache.set("active", active);

    clock += 200;
    expect(cache.get("active")).toBe(active);
    expect(cache.sweep()).toEqual(["idle"]);
    await flush();
    expect(idle.closed).toBe(1);
    expect(active.closed).toBe(0);
  });

  it("never evicts the context that was just used", async () => {
    let clock = 0;
    const cache = createContextCache({ maxContexts: 5, idleMs: 100, now: () => clock });
    const context = makeContext();
    cache.set("a", context);
    clock += 100;
    expect(cache.get("a")).toBe(context);
    expect(cache.sweep()).toEqual([]);
    await flush();
    expect(context.closed).toBe(0);
  });

  it("closes everything on shutdown and survives a failing close", async () => {
    const cache = createContextCache({ maxContexts: 5 });
    const failing = { close: vi.fn(() => Promise.reject(new Error("boom"))) };
    const healthy = makeContext();
    const logger = { warn: vi.fn() };
    const cacheWithLogger = createContextCache({ maxContexts: 5, logger });
    cache.set("ok", healthy);
    cacheWithLogger.set("bad", failing);

    await cache.closeAll();
    await cacheWithLogger.closeAll();

    expect(cache.size()).toBe(0);
    expect(healthy.closed).toBe(1);
    expect(failing.close).toHaveBeenCalled();
  });
});
