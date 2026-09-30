/**
 * 账号设置仓储。
 *
 * 不需要 accountId：库文件就是这个账号的边界（和画布、日记一样）。
 * 只管存取字符串，加解密是上层 settingsService 的事。
 */
export function createAccountSettingsRepository({ connection } = {}) {
  if (!connection?.db) throw new Error("Account settings repository requires a database connection.");
  const { db } = connection;

  const selectStatement = db.prepare("SELECT value FROM account_settings WHERE key = ?");
  const listStatement = db.prepare("SELECT key, value, updated_at FROM account_settings ORDER BY key");
  const upsertStatement = db.prepare(
    "INSERT INTO account_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const deleteStatement = db.prepare("DELETE FROM account_settings WHERE key = ?");

  return {
    get(key) {
      return selectStatement.get(String(key))?.value ?? null;
    },

    list() {
      return listStatement.all().map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at }));
    },

    set(key, value, updatedAt) {
      upsertStatement.run(String(key), String(value), String(updatedAt));
      return selectStatement.get(String(key))?.value ?? null;
    },

    remove(key) {
      return Number(deleteStatement.run(String(key)).changes || 0);
    },
  };
}
