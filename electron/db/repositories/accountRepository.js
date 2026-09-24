function accountFromRow(row) {
  if (!row) return null;
  return {
    accountId: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * 全局库仓储：账号、登录会话与网关设置。
 *
 * 只负责读写行，不做密码哈希与业务校验（那是 accountStore 的事）。
 * 唯一例外是 UNIQUE 冲突的翻译：用户名重复是持久层约束，放在这里免得业务层去匹配 SQLite 错误文案。
 */
export function createAccountRepository({ connection } = {}) {
  if (!connection?.db) throw new Error("Account repository requires a database connection.");
  const { db } = connection;

  const insertAccountStatement = db.prepare(
    "INSERT INTO accounts (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const selectAccountByIdStatement = db.prepare("SELECT * FROM accounts WHERE id = ?");
  const selectAccountByUsernameStatement = db.prepare("SELECT * FROM accounts WHERE username = ? AND status = 'active'");
  const selectAccountRowByUsernameStatement = db.prepare("SELECT * FROM accounts WHERE username = ?");
  const selectActiveAccountByIdStatement = db.prepare("SELECT * FROM accounts WHERE id = ? AND status = 'active'");
  const countAccountsStatement = db.prepare("SELECT COUNT(*) AS count FROM accounts");
  const listActiveAccountsStatement = db.prepare("SELECT * FROM accounts WHERE status = 'active' ORDER BY created_at ASC");

  const insertSessionStatement = db.prepare(
    "INSERT INTO sessions (session_id, account_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)",
  );
  const selectSessionAccountStatement = db.prepare("SELECT a.*, s.expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.session_id = ?");
  const touchSessionStatement = db.prepare("UPDATE sessions SET last_used_at = ? WHERE session_id = ?");
  const deleteSessionStatement = db.prepare("DELETE FROM sessions WHERE session_id = ?");
  const deleteExpiredSessionsStatement = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");

  const selectSettingStatement = db.prepare("SELECT value FROM gateway_settings WHERE key = ?");
  const upsertSettingStatement = db.prepare(
    "INSERT INTO gateway_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
  );

  return {
    countAccounts() {
      return Number(countAccountsStatement.get().count || 0);
    },

    /** 新增账号。用户名重复时抛出业务可读的错误，而不是 SQLite 的 UNIQUE 文案。 */
    insertAccount(account) {
      try {
        insertAccountStatement.run(
          account.accountId,
          account.username,
          account.displayName,
          account.passwordHash,
          account.role,
          account.status,
          account.createdAt,
          account.updatedAt,
        );
      } catch (error) {
        if (String(error.message).includes("UNIQUE")) throw new Error("Username is already registered.");
        throw error;
      }
      return accountFromRow(selectAccountByIdStatement.get(account.accountId));
    },

    getAccountById(id) {
      return accountFromRow(selectAccountByIdStatement.get(id));
    },

    /** 按用户名取账号（含被禁用的），登录时用来区分"不存在"与"密码错"。 */
    getAccountRowByUsername(username) {
      const row = selectAccountRowByUsernameStatement.get(username);
      if (!row) return null;
      return { ...accountFromRow(row), passwordHash: row.password_hash };
    },

    getActiveAccountByUsername(username) {
      return accountFromRow(selectAccountByUsernameStatement.get(username));
    },

    getActiveAccountById(id) {
      return accountFromRow(selectActiveAccountByIdStatement.get(id));
    },

    listActiveAccounts() {
      return listActiveAccountsStatement.all().map(accountFromRow);
    },

    createSession({ sessionId, accountId, createdAt, expiresAt }) {
      insertSessionStatement.run(sessionId, accountId, createdAt, expiresAt, createdAt);
      return { sessionId, accountId, createdAt, expiresAt };
    },

    /** 按会话取账号和过期时间；返回 null 表示会话不存在。 */
    findBySessionId(sessionId) {
      const row = selectSessionAccountStatement.get(sessionId);
      if (!row) return null;
      return { account: accountFromRow(row), expiresAt: row.expires_at };
    },

    touchSession(sessionId, usedAt) {
      touchSessionStatement.run(usedAt, sessionId);
    },

    removeSession(sessionId) {
      deleteSessionStatement.run(sessionId);
    },

    /** 删除所有已过期的会话，返回删除条数（保留策略用）。 */
    removeExpiredSessions(nowIso) {
      return Number(deleteExpiredSessionsStatement.run(nowIso).changes || 0);
    },

    getSetting(key) {
      return selectSettingStatement.get(String(key))?.value || "";
    },

    setSetting(key, value, updatedAt) {
      const text = String(value ?? "");
      upsertSettingStatement.run(String(key), text, updatedAt);
      return text;
    },
  };
}
