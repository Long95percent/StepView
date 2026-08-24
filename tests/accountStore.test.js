import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
});