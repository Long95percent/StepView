import { describe, expect, it } from "vitest";
import { loadConfig } from "../electron/config.js";

describe("gateway config", () => {
  it("defaults to the personal local gateway", () => {
    expect(loadConfig({ env: {}, envFilePath: "/missing/.env.local" })).toMatchObject({
      mode: "personal",
      gateway: "local",
      openAiModel: "gpt-5.1",
    });
  });

  it("loads and validates environment overrides", () => {
    const config = loadConfig({
      env: {
        STEPVIEW_MODE: "family",
        STEPVIEW_ALLOW_REGISTRATION: "false",
        STEPVIEW_SESSION_TTL_HOURS: "24",
        STEPVIEW_HTTP_PORT: "4321",
        REDIS_URL: "redis://cache.local:6380/1",
      },
      envFilePath: "/missing/.env.local",
    });
    expect(config).toMatchObject({ mode: "family", allowRegistration: false, sessionTtlHours: 24, httpPort: 4321, redisUrl: "redis://cache.local:6380/1" });
  });

  it("parses the CORS allowlist and defaults to empty", () => {
    // 默认空 = 不发任何 CORS 头。同源部署下浏览器不发跨域请求，这是正常状态。
    expect(loadConfig({ env: {}, envFilePath: "/missing/.env.local" }).allowedOrigins).toEqual([]);
    expect(
      loadConfig({ env: { STEPVIEW_ALLOWED_ORIGINS: " https://a.example , https://b.example/ ," }, envFilePath: "/missing/.env.local" }).allowedOrigins,
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("rejects invalid mode and numeric settings", () => {
    expect(() => loadConfig({ env: { STEPVIEW_MODE: "shared" }, envFilePath: "/missing/.env.local" })).toThrow("STEPVIEW_MODE");
    expect(() => loadConfig({ env: { STEPVIEW_SESSION_TTL_HOURS: "0" }, envFilePath: "/missing/.env.local" })).toThrow("STEPVIEW_SESSION_TTL_HOURS");
  });
});
