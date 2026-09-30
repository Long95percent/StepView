import { describe, expect, it } from "vitest";
import { validateNetworkPolicy } from "../electron/gateway/networkPolicy.js";

describe("network policy", () => {
  it("keeps personal mode loopback-only", () => {
    expect(() => validateNetworkPolicy({ mode: "personal", host: "0.0.0.0" })).toThrow();
    expect(validateNetworkPolicy({ mode: "personal" }).host).toBe("127.0.0.1");
  });
  it("requires explicit family LAN policy", () => {
    expect(() => validateNetworkPolicy({ mode: "family", host: "192.168.1.5" })).toThrow();
    expect(validateNetworkPolicy({ mode: "family", host: "127.0.0.1" }).allowLan).toBe(false);
    expect(validateNetworkPolicy({ mode: "family", host: "192.168.1.5", allowLan: true }).allowLan).toBe(true);
  });
  it("allows wildcard binding only inside the family container", () => {
    expect(() => validateNetworkPolicy({ mode: "family", host: "0.0.0.0" })).toThrow();
    expect(validateNetworkPolicy({ mode: "family", host: "0.0.0.0", containerized: true })).toMatchObject({ containerized: true });
  });
  it("refuses a wildcard cross-origin allowlist", () => {
    // `*` 等于没有白名单，只是写得更隐蔽。
    expect(() => validateNetworkPolicy({ mode: "family", allowedOrigins: ["*"] })).toThrow();
    expect(() => validateNetworkPolicy({ mode: "family", allowedOrigins: ["https://*.example.com"] })).toThrow();
    expect(validateNetworkPolicy({ mode: "family", allowedOrigins: ["https://a.example"] }).mode).toBe("family");
  });
});
