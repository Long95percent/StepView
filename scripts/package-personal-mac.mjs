import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
const releaseDir = path.join(rootDir, "release", "personal");
const appPath = path.join(releaseDir, "mac-arm64", "StepView Personal.app");
const artifactBase = `StepView-Personal-${packageJson.version}-arm64`;
const zipPath = path.join(releaseDir, `${artifactBase}.zip`);
const dmgPath = path.join(releaseDir, `${artifactBase}.dmg`);
const stagingDir = path.join(releaseDir, "dmg-stage");

if (process.platform !== "darwin") throw new Error("Personal macOS packaging must run on macOS.");
if (!fs.existsSync(appPath)) throw new Error(`Built app not found: ${appPath}`);

fs.rmSync(zipPath, { force: true });
fs.rmSync(dmgPath, { force: true });
fs.rmSync(stagingDir, { recursive: true, force: true });

// No Developer ID is available yet, so use an ad-hoc signature that seals the
// bundle after packaging. It keeps the app runnable locally without pretending
// to support Squirrel.Mac's seamless auto-update.
execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });

execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, zipPath], { stdio: "inherit" });

fs.mkdirSync(stagingDir, { recursive: true });
fs.cpSync(appPath, path.join(stagingDir, "StepView Personal.app"), { recursive: true });
fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));
execFileSync("hdiutil", [
  "create",
  "-volname", `StepView Personal ${packageJson.version}`,
  "-srcfolder", stagingDir,
  "-ov",
  "-format", "UDZO",
  dmgPath,
], { stdio: "inherit" });
fs.rmSync(stagingDir, { recursive: true, force: true });

const checksums = [zipPath, dmgPath].map((filePath) => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  return `${hash}  ${path.basename(filePath)}`;
});
fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`, "utf8");

console.log(`\nPersonal macOS artifacts:\n- ${path.relative(rootDir, zipPath)}\n- ${path.relative(rootDir, dmgPath)}`);
