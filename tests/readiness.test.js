import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDataDir, checkDatabase, summarizeReadiness } from "../electron/db/readiness.js";

describe("就绪探针", () => {
  let tempDir;
  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("数据目录可写且空间充足时算就绪", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-readyz-"));
    const result = checkDataDir({ dataDir: tempDir });
    expect(result).toMatchObject({ ok: true, writable: true, error: null });
    expect(result.freeBytes).toBeGreaterThan(0);
  });

  it("写不进去（只读挂载）就不就绪，并且说明原因", () => {
    const fsApi = {
      mkdirSync() {},
      writeFileSync() {
        throw Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" });
      },
      unlinkSync() {},
    };
    const result = checkDataDir({ dataDir: "/data", fsApi });
    expect(result.ok).toBe(false);
    expect(result.writable).toBe(false);
    expect(result.error).toContain("read-only");
  });

  it("空间低于阈值就不就绪，空间探测本身失败不算致命", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-readyz-"));
    expect(checkDataDir({ dataDir: tempDir, minFreeBytes: Number.MAX_SAFE_INTEGER }).ok).toBe(false);

    const fsApi = {
      mkdirSync() {},
      writeFileSync() {},
      unlinkSync() {},
      statfsSync() {
        throw new Error("statfs 不可用");
      },
    };
    const result = checkDataDir({ dataDir: "/data", fsApi });
    expect(result.ok).toBe(true);
    expect(result.freeBytes).toBeNull();
  });

  it("没有数据目录直接判不就绪", () => {
    expect(checkDataDir({ dataDir: "" })).toMatchObject({ ok: false, writable: false });
  });

  it("数据库读不出来就不就绪", () => {
    expect(checkDatabase({})).toMatchObject({ ok: false });
    expect(checkDatabase({ connection: { db: { prepare: () => ({ get: () => ({ ok: 1 }) }) } } })).toMatchObject({ ok: true });
    const broken = {
      db: {
        prepare() {
          throw new Error("database disk image is malformed");
        },
      },
    };
    expect(checkDatabase({ connection: broken })).toMatchObject({ ok: false });
    expect(checkDatabase({ connection: broken }).error).toContain("malformed");
  });

  it("Redis 挂掉只算降级，不改变 ok", () => {
    const healthy = summarizeReadiness({
      dataDir: { ok: true },
      database: { ok: true },
      redis: { ok: true },
      startedAt: 1000,
      now: () => 9000,
    });
    expect(healthy).toMatchObject({ ok: true, degraded: [], uptimeSeconds: 8 });

    const degraded = summarizeReadiness({ dataDir: { ok: true }, database: { ok: true }, redis: { ok: false } });
    expect(degraded.ok).toBe(true);
    expect(degraded.degraded).toEqual(["redis"]);

    const down = summarizeReadiness({ dataDir: { ok: false }, database: { ok: true }, redis: { ok: false } });
    expect(down.ok).toBe(false);
  });
});
