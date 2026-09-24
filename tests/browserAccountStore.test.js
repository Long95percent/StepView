import { describe, expect, it } from "vitest";
import {
  BROWSER_ACCOUNTS_KEY,
  BROWSER_CURRENT_ACCOUNT_KEY,
  createBrowserAccountStore,
} from "../src/browserAccountStore.js";

function createStorage(seed = {}) {
  const entries = new Map(Object.entries(seed));
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
    raw: entries,
  };
}

function makeStore({ seed, cryptoApi } = {}) {
  const storage = createStorage(seed);
  return { storage, store: createBrowserAccountStore({ storage, cryptoApi, iterations: 1000 }) };
}

function savedAccounts(storage) {
  return JSON.parse(storage.getItem(BROWSER_ACCOUNTS_KEY) || "[]");
}

describe("browser account store", () => {
  it("keeps a verifier instead of the password and still checks it at login", async () => {
    const { storage, store } = makeStore();

    const account = await store.registerAccount({ username: "Alice", password: "correct horse", displayName: "Alice" });

    expect(account).toMatchObject({ username: "alice", displayName: "Alice" });
    const raw = storage.getItem(BROWSER_ACCOUNTS_KEY);
    expect(raw).not.toContain("correct horse");
    expect(raw).not.toContain("password");
    expect(savedAccounts(storage)[0].verifier).toMatchObject({ algorithm: "pbkdf2-sha256", iterations: 1000 });

    await expect(store.login({ username: "ALICE", password: "correct horse" })).resolves.toMatchObject({ accountId: account.accountId });
    await expect(store.login({ username: "alice", password: "wrong password" })).rejects.toThrow("Invalid username or password");
    await expect(store.login({ username: "nobody", password: "correct horse" })).rejects.toThrow("Invalid username or password");
    await expect(store.registerAccount({ username: "alice", password: "another one" })).rejects.toThrow("already registered");
  });

  it("clears plaintext passwords left by older versions and forces a re-login", async () => {
    const legacy = [
      { accountId: "browser-1", username: "alice", displayName: "Alice", password: "correct horse" },
      { accountId: "browser-2", username: "bob", displayName: "Bob", password: "hunter two" },
    ];
    const { storage, store } = makeStore({
      seed: {
        [BROWSER_ACCOUNTS_KEY]: JSON.stringify(legacy),
        [BROWSER_CURRENT_ACCOUNT_KEY]: JSON.stringify({ accountId: "browser-1", username: "alice" }),
      },
    });

    const report = await store.migratePlaintextPasswords();

    expect(report).toEqual({ migrated: 2, forcedLogout: true });
    expect(storage.getItem(BROWSER_ACCOUNTS_KEY)).not.toContain("correct horse");
    expect(storage.getItem(BROWSER_ACCOUNTS_KEY)).not.toContain("hunter two");
    expect(storage.getItem(BROWSER_CURRENT_ACCOUNT_KEY)).toBe(null);
    expect(store.currentAccount()).toBe(null);
    // 迁移是等价的：用户还是用原来的密码登录。
    await expect(store.login({ username: "alice", password: "correct horse" })).resolves.toMatchObject({ accountId: "browser-1" });

    // 再跑一次什么都不做，也不会把已经迁移过的账号弄坏。
    await expect(store.migratePlaintextPasswords()).resolves.toEqual({ migrated: 0, forcedLogout: false });
    await expect(store.login({ username: "bob", password: "hunter two" })).resolves.toMatchObject({ accountId: "browser-2" });
  });

  it("never stores the password even without WebCrypto", async () => {
    const { storage, store } = makeStore({ cryptoApi: null });

    await store.registerAccount({ username: "carol", password: "correct horse" });

    const records = savedAccounts(storage);
    expect(records[0].verifier).toBeNull();
    expect(storage.getItem(BROWSER_ACCOUNTS_KEY)).not.toContain("correct horse");
    // 没有 WebCrypto 就没法校验，本地模式选择放行而不是把密码存下来。
    await expect(store.login({ username: "carol", password: "anything at all" })).resolves.toMatchObject({ username: "carol" });
  });
});
