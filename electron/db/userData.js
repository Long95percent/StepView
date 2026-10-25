import fs from "node:fs";

export function ensureUserDataDir(dataDir, { fsApi = fs } = {}) {
  if (!dataDir) throw new Error("ensureUserDataDir requires a dataDir.");
  fsApi.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}
