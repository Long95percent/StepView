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
      },
      envFilePath: "/missing/.env.local",
    });
    expect(config).toMatchObject({ mode: "family", allowRegistration: false, sessionTtlHours: 24, httpPort: 4321 });
  });

  it("rejects invalid mode and numeric settings", () => {
    expect(() => loadConfig({ env: { STEPVIEW_MODE: "shared" }, envFilePath: "/missing/.env.local" })).toThrow("STEPVIEW_MODE");
    expect(() => loadConfig({ env: { STEPVIEW_SESSION_TTL_HOURS: "0" }, envFilePath: "/missing/.env.local" })).toThrow("STEPVIEW_SESSION_TTL_HOURS");
  });
});
