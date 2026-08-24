import path from "node:path";
import fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { buildAgentMemory } from "../../src/agentMemory.js";
import { createAccountContext } from "./accountContext.js";
import { createAccountStore } from "./accountStore.js";

const PERSONAL_ACCOUNT_ID = "local-personal";

export function createLocalGateway({
  config,
  appDataDir,
  accountStoreFactory = createAccountStore,
  accountContextFactory = createAccountContext,
} = {}) {
  if (!config) throw new Error("Gateway config is required.");
  if (!appDataDir) throw new Error("Gateway appDataDir is required.");
  let context;
  let accountStore;
  let sessionId;
  let generation = 0;
  let initialized = false;

  function getDataDir() {
    return config.dataDir ? path.resolve(config.dataDir) : appDataDir;
  }

  function getCurrentAccount() {
    return config.mode === "personal" ? { id: PERSONAL_ACCOUNT_ID, accountId: PERSONAL_ACCOUNT_ID } : context?.account || null;
  }

  function requireContext() {
    if (!context) throw new Error("No active gateway account.");
    return context;
  }

  async function initialize() {
    if (initialized) return;
    const dataDir = getDataDir();
    if (config.mode === "family") {
      accountStore = accountStoreFactory({ dataDir, sessionTtlHours: config.sessionTtlHours });
    } else {
      const { createBoardStorage } = await import("../boardStorage.js");
      const { createAgentSqliteStore } = await import("../agentSqliteStore.js");
      const { createRedisAgentCache } = await import("../agentRedisClient.js");
      const { createMem0Client } = await import("../agentMem0Client.js");
      const { createAgentService } = await import("../agentService.js");
      const boardStorage = createBoardStorage({ dataDir });
      const agentSqliteStore = createAgentSqliteStore({ dataDir });
      const redisCache = createRedisAgentCache();
      const mem0Client = createMem0Client();
      const agentService = createAgentService({ sqliteStore: agentSqliteStore, redisCache, mem0Client });
      context = { mode: config.mode, accountId: PERSONAL_ACCOUNT_ID, dataDir, boardStorage, agentSqliteStore, redisCache, mem0Client, agentService, close: async () => { await boardStorage.flushWrites(); await redisCache?.close?.(); agentSqliteStore.close(); } };
    }
    initialized = true;
    return context;
  }

  async function loadBoard() {
    return requireContext().boardStorage.readBoard();
  }

  async function saveBoard(board) {
    return requireContext().boardStorage.writeBoard(board);
  }

  async function loadAgentJournal() {
    const activeContext = requireContext();
    await activeContext.boardStorage.flushWrites();
    const memory = buildAgentMemory(await activeContext.boardStorage.readBoard());
    activeContext.agentService.syncSessionsFromBoardMemory(memory);
    return activeContext.agentService.listSessionViews();
  }

  async function close() {
    generation += 1;
    await context?.close?.();
    accountStore?.close?.();
    context = undefined;
    accountStore = undefined;
    sessionId = undefined;
    initialized = false;
  }

  async function activateAccount(account, nextSessionId) {
    await context?.close?.();
    generation += 1;
    context = accountContextFactory({ account, accountsDir: path.join(getDataDir(), "accounts") });
    sessionId = nextSessionId;
    return account;
  }

  async function registerAccount(input) {
    if (config.mode !== "family" || !config.allowRegistration) throw new Error("Registration is disabled.");
    const account = accountStore.registerAccount(input);
    return login({ username: input.username, password: input.password });
  }

  async function login(input) {
    if (config.mode !== "family") throw new Error("Account login is unavailable in personal mode.");
    const result = accountStore.login(input);
    return activateAccount(result.account, result.sessionId);
  }

  async function logout() {
    if (config.mode !== "family") return null;
    accountStore.logout(sessionId);
    await context?.close?.();
    context = undefined;
    sessionId = undefined;
    return null;
  }

  async function switchAccount({ accountId }) {
    if (config.mode !== "family") throw new Error("Account switching is unavailable in personal mode.");
    const result = accountStore.createSession(accountId);
    return activateAccount(result.account, result.sessionId);
  }

  async function importPersonalData({ confirm = false } = {}) {
    if (config.mode !== "family") throw new Error("Personal data import is unavailable in personal mode.");
    const activeContext = requireContext();
    const targetDir = activeContext.dataDir;
    const sourceDir = getDataDir();
    const files = ["stepview-board.json", "stepview-board.backup.json", "stepview-agent.sqlite"];
    const existing = [];
    for (const file of files) {
      try {
        const filePath = path.join(targetDir, file);
        await fs.access(filePath);
        if (file !== "stepview-agent.sqlite") {
          existing.push(file);
        } else {
          const targetDb = new DatabaseSync(filePath);
          const count = targetDb.prepare(`SELECT (SELECT COUNT(*) FROM agent_sessions) + (SELECT COUNT(*) FROM agent_turns) AS count`).get().count;
          targetDb.close();
          if (count > 0) existing.push(file);
        }
      } catch {}
    }
    if (existing.length && !confirm) throw new Error("Target account already has data; explicit confirmation is required.");
    const backupDir = path.join(targetDir, `.import-backup-${Date.now()}`);
    await activeContext.close();
    try {
      if (existing.length) {
        await fs.mkdir(backupDir, { recursive: true });
        for (const file of existing) await fs.copyFile(path.join(targetDir, file), path.join(backupDir, file));
      }
      for (const file of files) {
        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(targetDir, file);
        try {
          await fs.access(sourcePath);
          await fs.copyFile(sourcePath, targetPath);
          if (file === "stepview-agent.sqlite") {
            const importedDb = new DatabaseSync(targetPath);
            importedDb.close();
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      context = accountContextFactory({ account: activeContext.account, accountsDir: path.join(sourceDir, "accounts") });
      return { ok: true, accountId: activeContext.accountId, backupDir: existing.length ? backupDir : null };
    } catch (error) {
      for (const file of existing) await fs.copyFile(path.join(backupDir, file), path.join(targetDir, file));
      context = accountContextFactory({ account: activeContext.account, accountsDir: path.join(sourceDir, "accounts") });
      throw error;
    }
  }

  return {
    initialize,
    close,
    getMode: () => config.mode,
    getCurrentAccount,
    getContextGeneration: () => generation,
    isCurrentContext: (candidate, candidateGeneration) => candidate === context && candidateGeneration === generation,
    getContext: requireContext,
    loadBoard,
    saveBoard,
    loadAgentJournal,
    registerAccount,
    login,
    logout,
    listAccounts: () => accountStore?.listAccounts?.() || [],
    switchAccount,
    importPersonalData,
  };
}