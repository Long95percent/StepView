import { describe, expect, it } from "vitest";
import { createLogger } from "../electron/logging.js";

function collector(level = "info") {
  const lines = [];
  const stream = {
    write(chunk) {
      lines.push(JSON.parse(chunk));
    },
  };
  const logger = createLogger({ level, stream, now: () => new Date("2026-01-02T03:04:05.000Z") });
  return { lines, logger };
}

describe("结构化日志", () => {
  it("一行一条 JSON，带时间、级别和事件名", () => {
    const { lines, logger } = collector();
    logger.info("gateway_listening", { port: 3210 });
    expect(lines).toEqual([
      { ts: "2026-01-02T03:04:05.000Z", level: "info", event: "gateway_listening", port: 3210 },
    ]);
  });

  it("按级别过滤，silent 一行都不写", () => {
    const quiet = collector("warn");
    quiet.logger.info("hidden");
    quiet.logger.warn("shown");
    expect(quiet.lines.map((line) => line.event)).toEqual(["shown"]);

    const silent = collector("silent");
    silent.logger.error("hidden");
    expect(silent.lines).toEqual([]);
  });

  it("child 把固定字段挂在每一行上", () => {
    const { lines, logger } = collector();
    logger.child({ requestId: "req-1" }).info("http_request", { status: 200 });
    logger.info("http_request", { status: 200 });
    expect(lines[0]).toMatchObject({ event: "http_request", requestId: "req-1", status: 200 });
    expect(lines[1].requestId).toBeUndefined();
  });

  it("Error 会被压成可序列化的字段，而不是变成空对象", () => {
    const { lines, logger } = collector();
    const error = Object.assign(new Error("拒绝连接"), { code: "ECONNREFUSED" });
    logger.error("redis_failed", error);
    expect(lines[0].error).toMatchObject({ message: "拒绝连接", code: "ECONNREFUSED" });
    expect(lines[0].error.stack).toContain("拒绝连接");
  });

  it("日志流写失败不会把应用带崩", () => {
    const logger = createLogger({
      stream: {
        write() {
          throw new Error("EPIPE");
        },
      },
    });
    expect(() => logger.info("still_alive")).not.toThrow();
  });
});
