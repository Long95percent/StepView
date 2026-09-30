import crypto from "node:crypto";

/**
 * 敏感设置的加解密。
 *
 * OpenAI Key 不是"用户的个人数据"，而是"能花钱的凭证"：数据库文件一旦被复制走
 * （分享排查、备份上传、误提交），明文就等于泄露。
 *
 * 方案是 AES-256-GCM。密钥来源按顺序取：
 *   1. `STEPVIEW_SECRET_KEY`（推荐，生产环境用这个）——密钥不进数据目录，
 *      于是"单独一份数据库文件"或"单独一份数据目录备份"都解不开；
 *   2. 数据目录下的 `secret.key`（0600，首次需要时自动生成，见 db/secretKeyStore.js）
 *      ——让桌面版和本地开发不必先配环境变量才能用。
 *
 * 三条刻意的设计：
 *   1. 永远不写明文。没有可用密钥就现生成一个；密钥写不出来就报错，
 *      而不是"那就先存明文吧"。静默降级是安全里最贵的错误。
 *   2. 解密时认不出前缀的旧值按**明文**返回。老版本就是这么存的，读得出来才叫升级；
 *      它会在下次保存时被加密覆盖。
 *   3. 前缀带版本号。以后换算法只要写 v2 分支，不用猜库里这串是什么。
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const MIN_SECRET_LENGTH = 16;

export class SecretBoxError extends Error {
  constructor(message, { code = "SECRET_BOX_FAILED", statusCode = 500 } = {}) {
    super(message);
    this.name = "SecretBoxError";
    this.code = code;
    // 传输层直接拿它当 HTTP 状态码：配置类问题给 400，别再包成"服务器挂了"。
    this.statusCode = statusCode;
  }
}

/** 密钥串 → 32 字节。用 sha256 归一化，省得每处都去管"够不够 32 字节"。 */
function deriveKey(secret) {
  return crypto.createHash("sha256").update(String(secret), "utf8").digest();
}

export function isEncryptedSecret(value) {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

/**
 * @param {object} options
 * @param {string} [options.secret]    STEPVIEW_SECRET_KEY 的值，优先使用。
 * @param {object} [options.keyStore]  没有环境变量时用来读写 secret.key（见 db/secretKeyStore.js）。
 */
export function createSecretBox({ secret = "", keyStore = null } = {}) {
  const explicitSecret = String(secret || "").trim();
  if (explicitSecret && explicitSecret.length < MIN_SECRET_LENGTH) {
    throw new SecretBoxError(`STEPVIEW_SECRET_KEY must be at least ${MIN_SECRET_LENGTH} characters.`, { code: "SECRET_KEY_TOO_SHORT", statusCode: 400 });
  }
  let cachedKey = null;

  /** create=false 时只查不建（`configured` 用它回答"现在到底有没有密钥"）。 */
  function resolveKey({ create = false } = {}) {
    if (cachedKey) return cachedKey;
    if (explicitSecret) {
      cachedKey = deriveKey(explicitSecret);
      return cachedKey;
    }
    if (!keyStore) return null;
    const stored = create ? keyStore.ensure() : keyStore.read();
    if (!stored) return null;
    cachedKey = deriveKey(stored);
    return cachedKey;
  }

  return {
    /** 密钥是否来自环境变量。数据目录自带密钥时它是 false，部署文档据此提醒。 */
    get fromEnv() {
      return Boolean(explicitSecret);
    },

    /** 现在就有可用的密钥（环境变量或已存在的密钥文件），不需要现场生成。 */
    get configured() {
      return Boolean(resolveKey({ create: false }));
    },

    /** 加密。没有密钥文件时自动生成一把；写不出来才抛错。 */
    encrypt(plain) {
      let key;
      try {
        key = resolveKey({ create: true });
      } catch (error) {
        throw new SecretBoxError(`无法在数据目录写入密钥文件：${error.message}`, { code: "SECRET_KEY_UNWRITABLE" });
      }
      if (!key) throw new SecretBoxError("没有可用的加密密钥，无法安全保存 API Key。", { code: "SECRET_KEY_MISSING", statusCode: 400 });
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(String(plain ?? ""), "utf8"), cipher.final()]);
      return [VERSION, iv.toString("hex"), cipher.getAuthTag().toString("hex"), ciphertext.toString("hex")].join(":");
    },

    /**
     * 解密。认不出前缀的值原样返回（老版本的明文）；
     * 认得出前缀但解不开（换过密钥、数据被改过）则抛错——静默返回空串会让人以为"Key 没丢"。
     */
    decrypt(stored) {
      const value = String(stored ?? "");
      if (!value) return "";
      if (!isEncryptedSecret(value)) return value;
      const key = resolveKey({ create: false });
      if (!key) throw new SecretBoxError("找不到解密用的密钥（STEPVIEW_SECRET_KEY 或数据目录里的 secret.key）。", { code: "SECRET_KEY_MISSING", statusCode: 400 });
      const [, ivHex, tagHex, dataHex] = value.split(":");
      try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
        decipher.setAuthTag(Buffer.from(tagHex, "hex"));
        return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
      } catch {
        throw new SecretBoxError("存下来的 API Key 用当前密钥解不开（换过 STEPVIEW_SECRET_KEY？）。", { code: "SECRET_DECRYPT_FAILED" });
      }
    },
  };
}

/** 给界面看的脱敏尾巴。空值返回空串，别给它编一个像 Key 的东西出来。 */
export function secretHint(value, tail = 4) {
  const text = String(value ?? "");
  if (!text) return "";
  return text.length <= tail ? text : `…${text.slice(-tail)}`;
}
