import { describe, expect, it } from "vitest";
import { createSecretBox, isEncryptedSecret, secretHint } from "../electron/secretBox.js";
import { createSecretKeyStore } from "../electron/db/secretKeyStore.js";

/** 内存版文件系统，免得测试真往磁盘上写密钥。 */
function memoryFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    readFileSync: (file) => {
      if (!files.has(file)) {
        const error = new Error(`ENOENT: ${file}`);
        error.code = "ENOENT";
        throw error;
      }
      return files.get(file);
    },
    writeFileSync: (file, contents) => files.set(file, contents),
    mkdirSync: () => {},
    files,
  };
}

function fileBackedBox(secret) {
  const fsApi = memoryFs(secret ? { "/data/account/secret.key": `${secret}\n` } : {});
  return { box: createSecretBox({ keyStore: createSecretKeyStore({ dataDir: "/data/account", fsApi }) }), fsApi };
}

describe("secret box", () => {
  it("round-trips through the environment key", () => {
    const box = createSecretBox({ secret: "s".repeat(32) });
    const encrypted = box.encrypt("sk-live-1234567890");
    expect(encrypted).not.toContain("sk-live");
    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(box.decrypt(encrypted)).toBe("sk-live-1234567890");
    expect(box.fromEnv).toBe(true);
  });

  it("never stores plaintext, even without an environment key", () => {
    // 没配 STEPVIEW_SECRET_KEY 不是"那就存明文吧"，而是现生成一把存到数据目录。
    const { box, fsApi } = fileBackedBox("");
    expect(box.fromEnv).toBe(false);
    expect(box.configured).toBe(false);

    const encrypted = box.encrypt("sk-abc");
    expect(encrypted).not.toContain("sk-abc");
    expect(box.configured).toBe(true);
    expect([...fsApi.files.keys()]).toEqual(["/data/account/secret.key"]);
  });

  it("generates a stable key so later reads still work", () => {
    const { box, fsApi } = fileBackedBox("");
    const encrypted = box.encrypt("sk-abc");
    // 新进程：只有数据目录里的 secret.key，没有环境变量。
    const reopened = createSecretBox({ keyStore: createSecretKeyStore({ dataDir: "/data/account", fsApi }) });
    expect(reopened.decrypt(encrypted)).toBe("sk-abc");
  });

  it("reads old plaintext values so an upgrade does not lose the key", () => {
    const { box } = fileBackedBox("");
    // 上一版就是明文存的。读得出来才叫升级，读不出来就是把用户的 Key 弄丢了。
    expect(box.decrypt("sk-legacy-plain")).toBe("sk-legacy-plain");
  });

  it("fails loudly when the key no longer matches", () => {
    const encrypted = createSecretBox({ secret: "a".repeat(32) }).encrypt("sk-abc");
    const other = createSecretBox({ secret: "b".repeat(32) });
    // 静默返回空串会让人以为"Key 没丢"，所以这里必须抛。
    expect(() => other.decrypt(encrypted)).toThrow(/解不开/);
  });

  it("rejects a too-short environment key up front", () => {
    expect(() => createSecretBox({ secret: "short" })).toThrow(/at least 16/);
  });

  it("masks a hint without leaking more than the tail", () => {
    expect(secretHint("sk-live-1234567890")).toBe("…7890");
    expect(secretHint("")).toBe("");
    expect(secretHint("abc")).toBe("abc");
  });
});
