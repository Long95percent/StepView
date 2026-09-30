/**
 * 用户画像仓储。
 *
 * 查询逻辑与重构前的 user-profile.sqlite 模块逐字一致，只是不再自己打开数据库文件。
 */
export function createUserProfileRepository({ connection, accountId } = {}) {
  if (!connection?.db) throw new Error("User profile repository requires a database connection.");
  if (!accountId) throw new Error("User profile repository requires an accountId.");
  const db = connection.db;
  const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
  function set(category, key, value, sensitivity = "normal") { const t = new Date().toISOString(); const itemId = `${category}:${key}`; db.prepare("INSERT INTO profile_items VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,sensitivity=excluded.sensitivity,updated_at=excluded.updated_at").run(itemId, accountId, category, key, JSON.stringify(value), sensitivity, t, t); return get(category, key); }
  function get(category, key) { const row = db.prepare("SELECT * FROM profile_items WHERE id=? AND account_id=?").get(`${category}:${key}`, accountId); return row ? { id: row.id, category: row.category, key: row.key, value: parse(row.value_json), sensitivity: row.sensitivity, updatedAt: row.updated_at } : null; }
  function list(category) { return db.prepare("SELECT * FROM profile_items WHERE account_id=? AND (? IS NULL OR category=?) ORDER BY updated_at DESC").all(accountId, category || null, category || null).map((r) => ({ id: r.id, category: r.category, key: r.key, value: parse(r.value_json), sensitivity: r.sensitivity, updatedAt: r.updated_at })); }
  return { set, get, list };
}
