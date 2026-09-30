import path from "node:path";
import { buildAgentMemory } from "../../src/agentMemory.js";
import { boardHasContent, readBoardSnapshot, stageLegacyDatabaseFiles } from "../db/transfer.js";
import { ACCOUNT_DB_FILE, GLOBAL_DB_FILE } from "../db/index.js";
import { createAccountContext } from "./accountContext.js";
import { createAccountStore } from "./accountStore.js";
import { validateNetworkPolicy } from "./networkPolicy.js";

const PERSONAL_ACCOUNT_ID = "local-personal";

export function createLocalGateway({
  config,
  appDataDir,
  accountStoreFactory = createAccountStore,
  accountContextFactory = createAccountContext,
} = {}) {
  if (!config) throw new Error("Gateway config is required.");
  if (!appDataDir) throw new Error("Gateway appDataDir is required.");
  validateNetworkPolicy({ mode: config.mode, host: config.bindHost || "127.0.0.1", allowLan: config.allowLan, enableUpnp: config.enableUpnp, containerized: config.containerized });
  let context;
  let accountStore;
  let sessionId;
  let generation = 0;
  let initialized = false;

  function getDataDir() {
    return config.dataDir ? path.resolve(config.dataDir) : appDataDir;
  }

  /**
   * 当前生效的两个数据库文件。备份与恢复都从这里取路径，避免各写一份"数据存在哪"的知识。
   * 家庭模式下每个账号一个库，所以账号库的路径取决于当前登录的是谁。
   */
  function getDatabasePaths() {
    const dataDir = getDataDir();
    const accountId = context?.account?.accountId;
    const accountDir = config.mode === "personal" || !accountId ? dataDir : path.join(dataDir, "accounts", accountId);
    return {
      global: path.join(dataDir, GLOBAL_DB_FILE),
      account: accountId ? path.join(accountDir, ACCOUNT_DB_FILE) : null,
    };
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
      // 个人模式的数据目录就是 dataDir 本身（家庭模式才是 accountsDir/<accountId>），
      // 这一点必须保持，否则升级后用户会找不到自己原来的画布。
      context = accountContextFactory({
        account: { id: PERSONAL_ACCOUNT_ID, accountId: PERSONAL_ACCOUNT_ID },
        dataDir,
        mode: config.mode,
      });
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

  /**
   * 把个人模式的数据导入当前家庭账号。
   *
   * 全程走仓储：画布从账号库/旧 JSON 读出来再写进目标账号，旧的独立数据库文件由
   * 数据库层复制并交给迁移器导入。源目录只读，不删不改。
   */
  async function importPersonalData({ confirm = false } = {}) {
    if (config.mode !== "family") throw new Error("Personal data import is unavailable in personal mode.");
    const activeContext = requireContext();
    const account = activeContext.account;
    const sourceDir = getDataDir();
    const accountsDir = path.join(sourceDir, "accounts");

    const sourceBoard = await readBoardSnapshot({ dataDir: sourceDir });
    const targetBoard = await activeContext.boardStorage.readBoard();
    const hasExistingData = boardHasContent(targetBoard) || activeContext.agentSqliteStore.listSessions().length > 0;
    if (hasExistingData && !confirm) throw new Error("Target account already has data; explicit confirmation is required.");

    // 要覆盖已有数据时先做一次一致性备份（VACUUM INTO），比"复制文件再复制回来"可靠。
    const backupPath = hasExistingData
      ? activeContext.database.backups.createBackup({ connection: activeContext.database, label: "before-personal-import" }).path
      : null;

    if (sourceBoard) await activeContext.boardStorage.writeBoard(sourceBoard);

    // 先关掉目标账号的连接，再复制旧库文件，最后重建上下文触发迁移导入。
    await activeContext.close();
    try {
      const staged = stageLegacyDatabaseFiles({ sourceDir, targetDir: activeContext.dataDir });
      context = accountContextFactory({ account, accountsDir });
      return { ok: true, accountId: account.accountId, backupPath, staged };
    } catch (error) {
      // 重建上下文保证账号还能打开；备份路径写进错误信息，方便人工恢复。
      context = accountContextFactory({ account, accountsDir });
      if (backupPath) error.message = `${error.message}（导入前的备份：${backupPath}）`;
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
    getDataDir,
    getDatabasePaths,
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
