import { describe, expect, it } from "vitest";
import { isManagedRedisUrl, redisServerArguments } from "../electron/redisManager.js";

describe("managed Redis lifecycle", () => {
  it("only manages unauthenticated loopback Redis", () => {
    expect(isManagedRedisUrl("redis://127.0.0.1:6379/0")).toBe(true);
    expect(isManagedRedisUrl("redis://localhost:6379/0")).toBe(true);
    expect(isManagedRedisUrl("redis://user:secret@127.0.0.1:6379/0")).toBe(false);
    expect(isManagedRedisUrl("redis://cache.example:6379/0")).toBe(false);
  });

  it("enables protected local binding and AOF persistence", () => {
    const args = redisServerArguments({ redisUrl: "redis://127.0.0.1:6379/0", dataDir: "/data/stepview" });
    expect(args).toEqual(expect.arrayContaining(["--bind", "127.0.0.1", "--protected-mode", "yes", "--appendonly", "yes", "--appendfsync", "everysec"]));
    expect(args.join(" ")).toContain("/data/stepview/redis");
  });
});
