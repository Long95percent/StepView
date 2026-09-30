import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountStore } from "../electron/gateway/accountStore.js";

describe("account store", () => {
  let tempDir;
  let store;

  afterEach(async () => {
    store?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("registers hashed accounts and creates expiring sessions", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-accounts-"));
    store = createAccountStore({ dataDir: tempDir, sessionTtlHours: 1 });
    const account = store.registerAccount({ username: "Alice", password: "correct horse", displayName: "Alice" });
    expect(account).toMatchObject({ username: "alice", role: "owner" });
    const session = store.login({ username: "ALICE", password: "correct horse" });
    expect(store.getAccountForSession(session.sessionId)).toMatchObject({ accountId: account.accountId });
    expect(() => store.login({ username: "alice", password: "wrong password" })).toThrow("Invalid username or password");
  });

  it("assigns later accounts the member role", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-accounts-"));
    store = createAccountStore({ dataDir: tempDir });
    store.registerAccount({ username: "owner", password: "password-1" });
    expect(store.registerAccount({ username: "member", password: "password-2" })).toMatchObject({ role: "member" });
  });

  it("keeps existing accounts when upgrading a gateway file created before the database layer", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-accounts-legacy-"));
    const dbPath = path.join(tempDir, "gateway.sqlite");
    // 复刻重构前 accountStore 手写建表的结果：没有 schema_migrations，user_version 还是 0。
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE sessions (session_id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT NOT NULL);
      CREATE TABLE gateway_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    legacy.prepare("INSERT INTO accounts (id, username, display_name, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "account-legacy", "alice", "Alice", "scrypt:00112233445566778899aabbccddeeff:deadbeef", "owner", "active", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z",
    );
    legacy.prepare("INSERT INTO gateway_settings (key, value, updated_at) VALUES (?, ?, ?)").run("agentModel", "gpt-5.1", "2026-01-01T00:00:00.000Z");
    legacy.close();

    store = createAccountStore({ dataDir: tempDir });
    expect(store.listAccounts()).toEqual([expect.objectContaining({ accountId: "account-legacy", username: "alice", role: "owner" })]);
    expect(store.getSetting("agentModel")).toBe("gpt-5.1");
    expect(store.registerAccount({ username: "member", password: "password-2" })).toMatchObject({ role: "member" });
  });
});
