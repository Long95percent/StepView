import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { openAccountDatabase } from "../electron/db/index.js";
import { createAccountSettingsRepository } from "../electron/db/repositories/accountSettingsRepository.js";
import { createSettingsService, SETTINGS_DEFAULTS } from "../electron/settingsService.js";
import { createSecretBox } from "../electron/secretBox.js";
import { createSecretKeyStore } from "../electron/db/secretKeyStore.js";

const SECRET = "test-secret-key-0123456789";

async function openAccount(prefix) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const database = openAccountDatabase({ dataDir });
  const secretBox = createSecretBox({ secret: SECRET, keyStore: createSecretKeyStore({ dataDir }) });
  return {
    dataDir,
    database,
    service: createSettingsService({ repository: createAccountSettingsRepository({ connection: database }), secretBox }),
  };
}

describe("account settings", () => {
  let accounts = [];

  afterEach(async () => {
    for (const account of accounts) {
      account.database.close();
      await rm(account.dataDir, { recursive: true, force: true });
    }
    accounts = [];
  });

  async function account(prefix) {
    const opened = await openAccount(prefix);
    accounts.push(opened);
    return opened;
  }

  it("keeps one account's API key out of another account's reach", async () => {
    // 这就是这次要修的那个洞：设置以前放在全局表里，没有 account_id，
    // 于是任何登录账号 GET /api/settings 都能拿到别人填的明文 Key。
    const alice = await account("stepview-settings-alice-");
    const bob = await account("stepview-settings-bob-");

    alice.service.save({ openaiApiKey: "sk-alice-secret" });

    expect(alice.service.readApiKey()).toBe("sk-alice-secret");
    expect(bob.service.readApiKey()).toBe("");
    expect(bob.service.readForClient().hasOpenAiKey).toBe(false);
    // B 自己的设置里不该出现 A 的任何痕迹。
    expect(JSON.stringify(bob.service.readForClient())).not.toContain("alice");
  });

  it("stores the key encrypted and only reports a hint", async () => {
    const alice = await account("stepview-settings-enc-");
    alice.service.save({ openaiApiKey: "sk-live-abcdefghijkl" });

    const raw = alice.database.db.prepare("SELECT value FROM account_settings WHERE key = 'openaiApiKey'").get().value;
    expect(raw).not.toContain("sk-live");
    expect(raw.startsWith("v1:")).toBe(true);

    const view = alice.service.readForClient();
    expect(view.hasOpenAiKey).toBe(true);
    expect(view.openaiApiKeyHint).toBe("…ijkl");
    // 给界面的形状里绝不允许出现明文。
    expect(JSON.stringify(view)).not.toContain("sk-live");
  });

  it("leaves the key alone when the field is empty or absent", async () => {
    const alice = await account("stepview-settings-keep-");
    alice.service.save({ openaiApiKey: "sk-keep-me" });

    // 界面看不到已存的 Key，输入框空着只代表"没打算改它"。
    alice.service.save({ agentModel: "gpt-5.2", openaiApiKey: "" });
    expect(alice.service.readApiKey()).toBe("sk-keep-me");

    alice.service.save({ openaiBaseUrl: "https://example.test/v1" });
    expect(alice.service.readApiKey()).toBe("sk-keep-me");
    expect(alice.service.readForClient()).toMatchObject({
      agentModel: "gpt-5.2",
      openaiBaseUrl: "https://example.test/v1",
      hasOpenAiKey: true,
    });
  });

  it("clears the key only when asked explicitly", async () => {
    const alice = await account("stepview-settings-clear-");
    alice.service.save({ openaiApiKey: "sk-clear-me" });
    const cleared = alice.service.save({ openaiApiKey: null });

    expect(cleared.hasOpenAiKey).toBe(false);
    expect(cleared.openaiApiKeyHint).toBe("");
    expect(alice.service.readApiKey()).toBe("");
  });

  it("falls back to defaults without writing anything", async () => {
    const alice = await account("stepview-settings-default-");
    expect(alice.service.readForClient()).toMatchObject({
      ...SETTINGS_DEFAULTS,
      hasOpenAiKey: false,
      secretKeyFromEnv: true,
    });
    expect(alice.database.db.prepare("SELECT COUNT(*) AS n FROM account_settings").get().n).toBe(0);
  });
});
