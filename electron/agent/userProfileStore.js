import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
export function createUserProfileStore({ dataDir, accountId }) {
  if (!dataDir || !accountId) throw new Error("dataDir and accountId are required.");
  const db = new DatabaseSync(path.join(dataDir, "user-profile.sqlite"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS profile_items (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, category TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL, sensitivity TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_key ON profile_items(account_id, category, key);");
  const parse = (v) => { try { return JSON.parse(v); } catch { return null; } };
  function set(category, key, value, sensitivity = "normal") { const t = new Date().toISOString(); const itemId = `${category}:${key}`; db.prepare("INSERT INTO profile_items VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,sensitivity=excluded.sensitivity,updated_at=excluded.updated_at").run(itemId, accountId, category, key, JSON.stringify(value), sensitivity, t, t); return get(category, key); }
  function get(category, key) { const row = db.prepare("SELECT * FROM profile_items WHERE id=? AND account_id=?").get(`${category}:${key}`, accountId); return row ? { id: row.id, category: row.category, key: row.key, value: parse(row.value_json), sensitivity: row.sensitivity, updatedAt: row.updated_at } : null; }
  function list(category) { return db.prepare("SELECT * FROM profile_items WHERE account_id=? AND (? IS NULL OR category=?) ORDER BY updated_at DESC").all(accountId, category || null, category || null).map((r) => ({ id: r.id, category: r.category, key: r.key, value: parse(r.value_json), sensitivity: r.sensitivity, updatedAt: r.updated_at })); }
  function close() { db.close(); }
  return { set, get, list, close };
}
