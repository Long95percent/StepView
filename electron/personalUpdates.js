const DEFAULT_REPOSITORY = "Long95percent/StepView";
const PERSONAL_ASSET_PATTERN = /^StepView-Personal-.+-arm64\.(dmg|zip)$/i;

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] || "" };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("Version must use semantic versioning, for example 1.2.3.");
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function personalAssets(release) {
  return (release.assets || []).filter((asset) => PERSONAL_ASSET_PATTERN.test(String(asset.name || "")));
}

export function selectLatestPersonalRelease(releases = []) {
  const candidates = releases
    .filter((release) => release && !release.draft && !release.prerelease)
    .map((release) => {
      const version = String(release.tag_name || "").replace(/^v/, "");
      const assets = personalAssets(release);
      return { release, version, assets };
    })
    .filter(({ version, assets }) => parseVersion(version) && assets.length > 0)
    .sort((left, right) => compareVersions(right.version, left.version));
  return candidates[0] || null;
}

export function isTrustedReleaseUrl(value, repository = DEFAULT_REPOSITORY) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && url.pathname.startsWith(`/${repository}/releases`);
  } catch {
    return false;
  }
}

export async function checkPersonalUpdate({
  currentVersion,
  repository = DEFAULT_REPOSITORY,
  fetchImpl = globalThis.fetch,
  githubToken = "",
} = {}) {
  if (!parseVersion(currentVersion)) throw new Error("Current app version is invalid.");
  if (typeof fetchImpl !== "function") throw new Error("Update checking is unavailable.");

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "StepView-Personal",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  // A manual check should fail visibly instead of leaving the button spinning.
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10_000) : undefined;
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=30`, { headers, signal });
  if (!response.ok) throw new Error(`GitHub release request failed (${response.status}).`);
  const releases = await response.json();
  const latest = selectLatestPersonalRelease(Array.isArray(releases) ? releases : []);
  const releasesUrl = `https://github.com/${repository}/releases`;
  if (!latest) return { status: "no-release", currentVersion, releasesUrl };

  const dmg = latest.assets.find((asset) => /\.dmg$/i.test(asset.name));
  const zip = latest.assets.find((asset) => /\.zip$/i.test(asset.name));
  const downloadUrl = dmg?.browser_download_url || zip?.browser_download_url || latest.release.html_url || releasesUrl;
  const releaseUrl = latest.release.html_url || releasesUrl;
  return {
    status: isNewer(latest.version, currentVersion) ? "available" : "up-to-date",
    currentVersion,
    latestVersion: latest.version,
    downloadUrl,
    releaseUrl,
    publishedAt: latest.release.published_at || null,
  };
}
