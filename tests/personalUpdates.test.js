import { describe, expect, it, vi } from "vitest";
import { checkPersonalUpdate, compareVersions, isTrustedReleaseUrl, selectLatestPersonalRelease } from "../electron/personalUpdates.js";

function release(tag, assets, overrides = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/Long95percent/StepView/releases/tag/${tag}`,
    published_at: "2026-10-25T00:00:00Z",
    assets: assets.map((name) => ({ name, browser_download_url: `https://github.com/Long95percent/StepView/releases/download/${tag}/${name}` })),
    ...overrides,
  };
}

describe("personal update checks", () => {
  it("compares semantic versions numerically", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("v1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(-1);
  });

  it("ignores releases that do not contain a personal macOS artifact", () => {
    const selected = selectLatestPersonalRelease([
      release("v2.0.0", ["StepView-Family-arm64.dmg"]),
      release("v1.4.0", ["StepView-Personal-1.4.0-arm64.dmg"]),
      release("v1.3.0", ["StepView-Personal-1.3.0-arm64.zip"]),
    ]);
    expect(selected.version).toBe("1.4.0");
  });

  it("returns the DMG download for a newer personal release", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [release("v1.2.0", ["StepView-Personal-1.2.0-arm64.zip", "StepView-Personal-1.2.0-arm64.dmg"])],
    }));
    await expect(checkPersonalUpdate({ currentVersion: "1.1.0", fetchImpl })).resolves.toMatchObject({
      status: "available",
      currentVersion: "1.1.0",
      latestVersion: "1.2.0",
      downloadUrl: "https://github.com/Long95percent/StepView/releases/download/v1.2.0/StepView-Personal-1.2.0-arm64.dmg",
    });
  });

  it("reports when no personal release exists", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
    await expect(checkPersonalUpdate({ currentVersion: "1.1.0", fetchImpl })).resolves.toMatchObject({ status: "no-release" });
  });

  it("only trusts HTTPS GitHub release URLs for this repository", () => {
    expect(isTrustedReleaseUrl("https://github.com/Long95percent/StepView/releases/download/v1.2.0/app.dmg")).toBe(true);
    expect(isTrustedReleaseUrl("http://github.com/Long95percent/StepView/releases/download/v1.2.0/app.dmg")).toBe(false);
    expect(isTrustedReleaseUrl("https://github.com/other/repo/releases/download/v1.2.0/app.dmg")).toBe(false);
    expect(isTrustedReleaseUrl("file:///tmp/app.dmg")).toBe(false);
  });
});
