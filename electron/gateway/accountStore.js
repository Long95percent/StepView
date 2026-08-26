import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

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

export function createAccountStore({ dataDir, dbPath = path.join(dataDir, "gateway.sqlite"), sessionTtlHours = 168 } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gateway_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  function registerAccount({ username, password, displayName = username }) {
    const normalizedUsername = normalizeUsername(username);
    const timestamp = nowIso();
    const role = db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count === 0 ? "owner" : "member";
    const account = {
      id: `account-${randomUUID()}`,
      username: normalizedUsername,
      displayName: String(displayName || normalizedUsername).trim() || normalizedUsername,
      passwordHash: hashPassword(password),
      role,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      db.prepare(`INSERT INTO accounts (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(account.id, account.username, account.displayName, account.passwordHash, account.role, account.status, account.createdAt, account.updatedAt);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) throw new Error("Username is already registered.");
      throw error;
    }
    return accountFromRow(db.prepare("SELECT * FROM accounts WHERE id = ?").get(account.id));
  }

  function login({ username, password }) {
    const row = db.prepare("SELECT * FROM accounts WHERE username = ?").get(normalizeUsername(username));
    if (!row || row.status !== "active" || !verifyPassword(password, row.password_hash)) throw new Error("Invalid username or password.");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + Number(sessionTtlHours) * 60 * 60 * 1000).toISOString();
    const sessionId = `session-${randomUUID()}`;
    db.prepare("INSERT INTO sessions (session_id, account_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, row.id, createdAt, expiresAt, createdAt);
    return { sessionId, account: accountFromRow(row), expiresAt };
  }

  function createSession(accountId) {
    const row = db.prepare("SELECT * FROM accounts WHERE id = ? AND status = 'active'").get(accountId);
    if (!row) throw new Error("Account not found.");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + Number(sessionTtlHours) * 60 * 60 * 1000).toISOString();
    const sessionId = `session-${randomUUID()}`;
    db.prepare("INSERT INTO sessions (session_id, account_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .run(sessionId, row.id, createdAt, expiresAt, createdAt);
    return { sessionId, account: accountFromRow(row), expiresAt };
  }

  function getAccountForSession(sessionId) {
    if (!sessionId) return null;
    const row = db.prepare(`SELECT a.*, s.expires_at FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.session_id = ?`).get(sessionId);
    if (!row || row.expires_at <= nowIso() || row.status !== "active") {
      if (row) db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
      return null;
    }
    db.prepare("UPDATE sessions SET last_used_at = ? WHERE session_id = ?").run(nowIso(), sessionId);
    return accountFromRow(row);
  }

  function logout(sessionId) {
    if (sessionId) db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
  }

  function listAccounts() {
    return db.prepare("SELECT * FROM accounts WHERE status = 'active' ORDER BY created_at ASC").all().map(accountFromRow);
  }

  function getSetting(key) {
    return db.prepare("SELECT value FROM gateway_settings WHERE key = ?").get(String(key))?.value || "";
  }

  function setSetting(key, value) {
    db.prepare("INSERT INTO gateway_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(String(key), String(value ?? ""), nowIso());
    return String(value ?? "");
  }

  function close() {
    db.close();
  }

  return { dbPath, registerAccount, login, createSession, getAccountForSession, logout, listAccounts, getSetting, setSetting, close };
}
