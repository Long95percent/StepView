import { SecretBoxError, createSecretBox, secretHint } from "./secretBox.js";

/**
 * 账号设置。
 *
 * 三项：agentModel / openaiBaseUrl / openaiApiKey。前两项是普通字符串，
 * 第三项是能花钱的凭证，落库前加密（见 secretBox.js）。
 *
 * 这一层的核心约定是**界面永远拿不到明文 Key**：
 *   - `readForClient()` 只回"有没有配"和一个尾四位提示；
 *   - 真正要用 Key 的地方（调模型）走 `readApiKey()`，只在本进程内流转。
 * 上一版是全局表 + 明文回传，任何登录账号都能读到别人的 Key，这不是配置问题，是越权。
 */

export const SETTINGS_DEFAULTS = Object.freeze({
  agentModel: "gpt-5.1",
  openaiBaseUrl: "https://api.openai.com/v1",
});

const AGENT_MODEL_KEY = "agentModel";
const BASE_URL_KEY = "openaiBaseUrl";
const API_KEY_KEY = "openaiApiKey";

export function createSettingsService({ repository, secretBox = createSecretBox(), now = () => new Date().toISOString() } = {}) {
  if (!repository?.get) throw new Error("Settings service requires an account settings repository.");

  function write(key, value) {
    repository.set(key, value, now());
  }

  function readApiKey() {
    const stored = repository.get(API_KEY_KEY);
    if (!stored) return "";
    return secretBox.decrypt(stored);
  }

  /** 给界面看的形状。**不含明文 Key**，也不含任何能还原它的东西。 */
  function readForClient() {
    const stored = repository.get(API_KEY_KEY);
    let hint = "";
    let hasKey = Boolean(stored);
    if (stored) {
      // 解不开也要能进设置页（否则用户连"重新填一次"都做不到），只是不再给提示。
      try {
        hint = secretHint(secretBox.decrypt(stored));
      } catch {
        hint = "";
        hasKey = true;
      }
    }
    return {
      agentModel: repository.get(AGENT_MODEL_KEY) || SETTINGS_DEFAULTS.agentModel,
      openaiBaseUrl: repository.get(BASE_URL_KEY) || SETTINGS_DEFAULTS.openaiBaseUrl,
      hasOpenAiKey: hasKey,
      openaiApiKeyHint: hint,
      // false = 密钥来自数据目录里的 secret.key，会跟着数据目录的备份一起走。
      // 部署时设 STEPVIEW_SECRET_KEY 就能把它变成 true。
      secretKeyFromEnv: Boolean(secretBox.fromEnv),
    };
  }

  /**
   * 保存。
   *
   * openaiApiKey 的三种写法是有意的：
   *   undefined / "" → 保持原样。界面上 Key 输入框本来就是空的（看不到已存的值），
   *                   把"空"当成"清除"会让人一进设置页点保存就把 Key 弄没了。
   *   null           → 明确清除（界面上有一个单独的"清除"动作）。
   *   非空字符串      → 覆盖。
   */
  function save(input = {}) {
    const agentModel = input.agentModel;
    if (agentModel !== undefined) {
      const value = String(agentModel ?? "").trim();
      write(AGENT_MODEL_KEY, value || SETTINGS_DEFAULTS.agentModel);
    }

    const baseUrl = input.openaiBaseUrl;
    if (baseUrl !== undefined) {
      const value = String(baseUrl ?? "").trim();
      write(BASE_URL_KEY, value || SETTINGS_DEFAULTS.openaiBaseUrl);
    }

    const apiKey = input.openaiApiKey;
    if (apiKey === null) {
      repository.remove(API_KEY_KEY);
    } else if (apiKey !== undefined && String(apiKey).trim()) {
      // 没有配 STEPVIEW_SECRET_KEY 时这里会抛 SecretBoxError —— 拒绝保存明文，
      // 而不是"先存着以后再说"。
      write(API_KEY_KEY, secretBox.encrypt(String(apiKey).trim()));
    }

    return readForClient();
  }

  return { readForClient, readApiKey, save };
}

export { SecretBoxError };
