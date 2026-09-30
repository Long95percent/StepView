/**
 * 浏览器模式的本地账号。
 *
 * 这是"根本没有服务端"时的降级方案：账号、画布、设置全都躺在 localStorage 里。
 * 它不提供真正的安全边界——同源的脚本本来就能读到画布内容——但绝不能把用户的
 * 明文密码留在浏览器里：那是一份会被复用到别处的口令。
 *
 * 所以这里只保存 PBKDF2 派生值（不可逆），并且负责把历史遗留下来的明文密码擦掉。
 */

export const BROWSER_ACCOUNTS_KEY = "stepview-browser-accounts-v1";
export const BROWSER_CURRENT_ACCOUNT_KEY = "stepview-browser-current-account-v1";

export const PBKDF2_ITERATIONS = 120000;
const SALT_BYTES = 16;

function createBrowserAccountId(cryptoApi) {
  if (typeof cryptoApi?.randomUUID === "function") return `browser-${cryptoApi.randomUUID()}`;
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(SALT_BYTES);
    cryptoApi.getRandomValues(bytes);
    return `browser-${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  return `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex) {
  const clean = String(hex || "");
  const bytes = new Uint8Array(Math.floor(clean.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

/** 恒定时间比较，避免用比较耗时泄露信息。 */
function equalHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/** 派生出可存进 localStorage 的校验值；浏览器没有 WebCrypto（非安全上下文）时返回 null。 */
async function deriveVerifier(password, salt, iterations, cryptoApi) {
  const subtle = cryptoApi?.subtle;
  if (!subtle) return null;
  const key = await subtle.importKey("raw", new TextEncoder().encode(String(password ?? "")), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
  return toHex(new Uint8Array(bits));
}

function publicAccount(account) {
  return { accountId: account.accountId, username: account.username, displayName: account.displayName };
}

export function createBrowserAccountStore({ storage = globalThis.localStorage, cryptoApi = globalThis.crypto, iterations = PBKDF2_ITERATIONS } = {}) {
  function readAccounts() {
    try {
      const parsed = JSON.parse(storage?.getItem(BROWSER_ACCOUNTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeAccounts(accounts) {
    storage?.setItem(BROWSER_ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  function normalizeUsername(username) {
    return String(username || "").trim().toLowerCase();
  }

  async function buildVerifier(password, salt, cryptoApiOverride = cryptoApi) {
    const derived = await deriveVerifier(password, salt, iterations, cryptoApiOverride);
    return derived ? { algorithm: "pbkdf2-sha256", iterations, salt: toHex(salt), hash: derived } : null;
  }

  async function registerAccount({ username, password, displayName }) {
    const normalizedUsername = normalizeUsername(username);
    const accounts = readAccounts();
    if (accounts.some((account) => account.username === normalizedUsername)) throw new Error("Username is already registered.");

    const salt = new Uint8Array(SALT_BYTES);
    cryptoApi?.getRandomValues?.(salt);
    const account = {
      accountId: createBrowserAccountId(cryptoApi),
      username: normalizedUsername,
      displayName: String(displayName || "").trim() || normalizedUsername,
      verifier: await buildVerifier(password, salt),
    };
    writeAccounts([...accounts, account]);
    storage?.setItem(BROWSER_CURRENT_ACCOUNT_KEY, JSON.stringify(publicAccount(account)));
    return publicAccount(account);
  }

  async function login({ username, password }) {
    const normalizedUsername = normalizeUsername(username);
    const account = readAccounts().find((candidate) => candidate.username === normalizedUsername);
    if (!account) throw new Error("Invalid username or password.");

    if (account.verifier) {
      const derived = await deriveVerifier(password, fromHex(account.verifier.salt), account.verifier.iterations || iterations, cryptoApi);
      if (!derived || !equalHex(derived, account.verifier.hash)) throw new Error("Invalid username or password.");
    }
    // 没有 verifier 说明注册时浏览器不支持 WebCrypto。本地模式没有真正的安全边界，
    // 与其退回"保存明文密码"，不如不校验：至少不会把用户的可复用口令留在浏览器里。

    const safeAccount = publicAccount(account);
    storage?.setItem(BROWSER_CURRENT_ACCOUNT_KEY, JSON.stringify(safeAccount));
    return safeAccount;
  }

  function logout() {
    storage?.removeItem(BROWSER_CURRENT_ACCOUNT_KEY);
  }

  function currentAccount() {
    try {
      return JSON.parse(storage?.getItem(BROWSER_CURRENT_ACCOUNT_KEY) || "null");
    } catch {
      return null;
    }
  }

  /**
   * 清理历史遗留的明文密码。
   *
   * 老版本把整条含 password 字段的记录写进了 localStorage。这里把它删掉，并趁着还能读到
   * 明文，派生出等价的校验值——用户仍然用原来的密码登录，但密码本身不再留在磁盘上。
   * 找到明文记录时会强制退出当前会话（清掉 current account），让用户重新登录一次。
   */
  async function migratePlaintextPasswords() {
    const accounts = readAccounts();
    const withPlaintext = accounts.filter((account) => typeof account?.password === "string");
    if (withPlaintext.length === 0) return { migrated: 0, forcedLogout: false };

    const next = [];
    for (const account of accounts) {
      if (typeof account?.password !== "string") {
        next.push(account);
        continue;
      }
      const salt = new Uint8Array(SALT_BYTES);
      cryptoApi?.getRandomValues?.(salt);
      const verifier = await buildVerifier(account.password, salt);
      const { password, ...rest } = account;
      next.push(verifier ? { ...rest, verifier } : rest);
    }
    writeAccounts(next);
    storage?.removeItem(BROWSER_CURRENT_ACCOUNT_KEY);
    return { migrated: withPlaintext.length, forcedLogout: true };
  }

  return { registerAccount, login, logout, currentAccount, migratePlaintextPasswords };
}

/**
 * 默认实例。
 *
 * 懒创建：模块被 import 时不该去碰 localStorage（测试环境和 SSR 都没有它）。
 */
let defaultStore = null;
export function getBrowserAccountStore() {
  if (!defaultStore) defaultStore = createBrowserAccountStore();
  return defaultStore;
}
