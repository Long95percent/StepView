import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { openGlobalDatabase } from "../db/index.js";
import { createDatabaseMaintenance } from "../db/maintenance.js";
import { createAccountRepository } from "../db/repositories/accountRepository.js";
import { GLOBAL_RETENTION_RULES } from "../db/retention.js";

function nowIso() {
  return new Date().toISOString();
}

function normalizeUsername(username) {
  const value = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value)) throw new Error("Username must be 3-64 characters.");
  return value;
}

function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 8) throw new Error("Password must be at least 8 characters.");
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${scryptSync(value, salt, 64).toString("hex")}`;
}

function verifyPassword(password, encoded) {
  const [, saltHex, hashHex] = String(encoded || "").split(":");
  if (!saltHex || !hashHex) return false;
  const actual = scryptSync(String(password || ""), Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * 账号存储。
 *
 * 表结构与 SQL 全部在数据库层：这里只做密码哈希、用户名规范化和会话生命周期判断。
 * 数据库文件仍然是 dataDir/gateway.sqlite（家庭模式）——路径没变，老用户不需要迁移文件。
 */
export function createAccountStore({ dataDir, dbPath, sessionTtlHours = 168 } = {}) {
  const database = openGlobalDatabase({ dataDir, dbPath });
  const repository = createAccountRepository({ connection: database });
  // 全局库的过期清理：启动时跑一次，之后每天一次。目前只有过期登录会话。
  const maintenance = createDatabaseMaintenance({ connection: database, rules: GLOBAL_RETENTION_RULES });
  maintenance.start();

  function startSession(account) {
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + Number(sessionTtlHours) * 60 * 60 * 1000).toISOString();
    const sessionId = `session-${randomUUID()}`;
    repository.createSession({ sessionId, accountId: account.accountId, createdAt, expiresAt });
    return { sessionId, account, expiresAt };
  }

  function registerAccount({ username, password, displayName = username }) {
    const normalizedUsername = normalizeUsername(username);
    const timestamp = nowIso();
    const role = repository.countAccounts() === 0 ? "owner" : "member";
    return repository.insertAccount({
      accountId: `account-${randomUUID()}`,
      username: normalizedUsername,
      displayName: String(displayName || normalizedUsername).trim() || normalizedUsername,
      passwordHash: hashPassword(password),
      role,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function login({ username, password }) {
    const account = repository.getAccountRowByUsername(normalizeUsername(username));
    if (!account || account.status !== "active" || !verifyPassword(password, account.passwordHash)) {
      throw new Error("Invalid username or password.");
    }
    const { passwordHash, ...publicAccount } = account;
    return startSession(publicAccount);
  }

  function createSession(accountId) {
    const account = repository.getActiveAccountById(accountId);
    if (!account) throw new Error("Account not found.");
    return startSession(account);
  }

  function getAccountForSession(sessionId) {
    if (!sessionId) return null;
    const found = repository.findBySessionId(sessionId);
    if (!found || found.expiresAt <= nowIso() || found.account.status !== "active") {
      if (found) repository.removeSession(sessionId);
      return null;
    }
    repository.touchSession(sessionId, nowIso());
    return found.account;
  }

  function logout(sessionId) {
    if (sessionId) repository.removeSession(sessionId);
  }

  function listAccounts() {
    return repository.listActiveAccounts();
  }

  function getSetting(key) {
    return repository.getSetting(key);
  }

  function setSetting(key, value) {
    return repository.setSetting(key, value, nowIso());
  }

  function close() {
    maintenance.stop();
    database.close();
  }

  return {
    dbPath: database.dbPath,
    registerAccount,
    login,
    createSession,
    getAccountForSession,
    logout,
    listAccounts,
    getSetting,
    setSetting,
    close,
  };
}
