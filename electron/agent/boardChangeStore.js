import defaultFs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { normalizeBoard } from "../../src/progressCore.js";

const PROPOSAL_ID_PATTERN = /^proposal-[A-Za-z0-9-]{6,120}$/;
export const DEFAULT_MAX_PROPOSALS = 20;
export const DEFAULT_MAX_SNAPSHOTS = 20;
export const DEFAULT_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function boardHash(board) {
  return createHash("sha256").update(canonicalJson(normalizeBoard(board))).digest("hex");
}

export function isProposalId(value) {
  return PROPOSAL_ID_PATTERN.test(String(value || ""));
}

export function createBoardChangeStore({
  dataDir,
  fsApi = defaultFs,
  maxProposals = DEFAULT_MAX_PROPOSALS,
  maxSnapshots = DEFAULT_MAX_SNAPSHOTS,
  ttlMs = DEFAULT_PROPOSAL_TTL_MS,
  logger = console,
} = {}) {
  if (!dataDir) throw new Error("Board change store requires a dataDir.");

  const proposalsDir = () => path.join(dataDir, "proposals");
  const historyDir = () => path.join(dataDir, "history");

  function proposalPath(proposalId) {
    const id = String(proposalId || "");
    if (!PROPOSAL_ID_PATTERN.test(id)) throw new Error(`Invalid proposal id: ${proposalId}`);
    return path.join(proposalsDir(), `${id}.json`);
  }

  async function writeJsonAtomic(filePath, payload) {
    const tempPath = `${filePath}.tmp`;
    await fsApi.mkdir(path.dirname(filePath), { recursive: true });
    await fsApi.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await fsApi.rename(tempPath, filePath);
  }

  async function readJson(filePath) {
    try {
      return JSON.parse(await fsApi.readFile(filePath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      logger.warn?.(`Skipping unreadable proposal file ${filePath}`, error);
      return null;
    }
  }

  async function listIds(directory, suffix = ".json") {
    try {
      const entries = await fsApi.readdir(directory);
      return entries.filter((entry) => entry.endsWith(suffix) && !entry.endsWith(".tmp")).sort();
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  function stripPayload(record) {
    if (!record) return null;
    const { before, after, ...rest } = record;
    return rest;
  }

  async function stage({ proposalId, accountId, sessionId = null, operation, reason = "", summary, diff, before, after }) {
    if (!accountId) throw new Error("A proposal requires an accountId.");
    const record = {
      proposalId,
      accountId,
      sessionId,
      operation,
      reason: String(reason || "").slice(0, 500),
      summary: String(summary || ""),
      diff: diff || { changes: [], lines: [], counts: { added: 0, removed: 0, modified: 0 } },
      baseHash: boardHash(before),
      status: "pending",
      createdAt: new Date().toISOString(),
      decidedAt: null,
      before: normalizeBoard(before),
      after: normalizeBoard(after),
    };
    await writeJsonAtomic(proposalPath(proposalId), record);
    await prune();
    return stripPayload(record);
  }

  async function get(proposalId, { includePayload = true } = {}) {
    const record = await readJson(proposalPath(proposalId));
    if (!record) return null;
    return includePayload ? record : stripPayload(record);
  }

  async function list({ status, accountId, includePayload = false } = {}) {
    const ids = (await listIds(proposalsDir())).map((name) => name.slice(0, -".json".length));
    const records = [];
    for (const id of ids) {
      const record = await readJson(path.join(proposalsDir(), `${id}.json`));
      if (!record) continue;
      if (status && record.status !== status) continue;
      if (accountId && record.accountId !== accountId) continue;
      records.push(includePayload ? record : stripPayload(record));
    }
    return records.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function decide(proposalId, decision) {
    if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid proposal decision.");
    const record = await get(proposalId);
    if (!record) throw new Error("Proposal not found.");
    if (record.status !== "pending") throw new Error(`Proposal already ${record.status}.`);
    const decided = { ...record, status: decision, decidedAt: new Date().toISOString() };
    await writeJsonAtomic(proposalPath(proposalId), decided);
    return stripPayload(decided);
  }

  async function remove(proposalId) {
    try {
      await fsApi.unlink(proposalPath(proposalId));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async function prune({ now = Date.now() } = {}) {
    const proposals = await list({ includePayload: false });
    const expired = proposals.filter((record) => record.status !== "pending" || now - new Date(record.createdAt).getTime() > ttlMs);
    const pending = proposals.filter((record) => !expired.includes(record));
    const overflow = pending.slice(0, Math.max(0, pending.length - maxProposals));
    for (const record of [...expired, ...overflow]) {
      await remove(record.proposalId).catch(() => undefined);
    }
    return { removed: expired.length + overflow.length, kept: proposals.length - expired.length - overflow.length };
  }

  async function snapshotBoard(board, { label = "before-change", now = new Date() } = {}) {
    const safeLabel = String(label).replace(/[^A-Za-z0-9-]/g, "-").slice(0, 60) || "snapshot";
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const fileName = `board-${stamp}-${safeLabel}.json`;
    const filePath = path.join(historyDir(), fileName);
    await writeJsonAtomic(filePath, normalizeBoard(board));
    const files = await listIds(historyDir());
    const stale = files.slice(0, Math.max(0, files.length - maxSnapshots));
    for (const name of stale) await fsApi.unlink(path.join(historyDir(), name)).catch(() => undefined);
    return filePath;
  }

  return { stage, get, list, decide, remove, prune, snapshotBoard, proposalsDir, historyDir };
}
