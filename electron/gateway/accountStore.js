import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { openGlobalDatabase } from "../db/index.js";
import { createDatabaseMaintenance } from "../db/maintenance.js";
import { createAccountRepository } from "../db/repositories/accountRepository.js";
import { GLOBAL_RETENTION_RULES } from "../db/retention.js";

function nowIso() {
  return new Date().toISOString();
}

/**
 * 账号相关的错误。
 *
 * 带上 statusCode / code，是因为两个传输层（HTTP 与 Electron IPC）要给出同一组字段：
 * 界面靠 code 区分"密码错了"和"服务器炸了"，只给一句 message 就只能去比对中文字符串。
 */
function accountError(message, { statusCode, code }) {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalizeUsername(username) {
  const value = String(username || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(value)) {
    throw accountError("Username must be 3-64 characters.", { statusCode: 400, code: "INVALID_USERNAME" });
  }
  return value;
}

function hashPassword(password) {
  const value = String(password || "");
  if (value.length < 8) throw accountError("Password must be at least 8 characters.", { statusCode: 400, code: "WEAK_PASSWORD" });
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
    // 先算密码哈希再插行：密码不合格时不该留下半条账号记录。
    const passwordHash = hashPassword(password);
    try {
      return repository.insertAccount({
        accountId: `account-${randomUUID()}`,
        username: normalizedUsername,
        displayName: String(displayName || normalizedUsername).trim() || normalizedUsername,
        passwordHash,
        role,
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      // 用户名唯一约束：这是"你要的名字被占了"，不是服务器错误。
      if (/UNIQUE|PRIMARY KEY/i.test(String(error.message))) {
        throw accountError("That username is already taken.", { statusCode: 409, code: "USERNAME_TAKEN" });
      }
      throw error;
    }
  }

  function login({ username, password }) {
    const account = repository.getAccountRowByUsername(normalizeUsername(username));
    if (!account || account.status !== "active" || !verifyPassword(password, account.passwordHash)) {
      // 401 而不是 500：这是"你给的凭据不对"，不是"服务器出错了"。
      // 文案保持模糊，不区分"用户不存在"和"密码错"。
      throw accountError("Invalid username or password.", { statusCode: 401, code: "INVALID_CREDENTIALS" });
    }
    const { passwordHash, ...publicAccount } = account;
    return startSession(publicAccount);
  }

  function createSession(accountId) {
    const account = repository.getActiveAccountById(accountId);
    if (!account) throw accountError("Account not found.", { statusCode: 404, code: "ACCOUNT_NOT_FOUND" });
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
