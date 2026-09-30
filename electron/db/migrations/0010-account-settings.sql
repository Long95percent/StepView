-- 账号级设置。
--
-- 重构前 agentModel / openaiApiKey / openaiBaseUrl 写在全局库的 gateway_settings 里，
-- 而那张表只有 key、没有 account_id：所有账号共用一份，任何登录账号 GET /api/settings
-- 都能读到别人填的 OpenAI Key（明文）。设置属于账号数据，所以搬进账号库，
-- 边界和画布、日记、记忆完全一致——库文件本身就是那堵墙。
--
-- value 一律存字符串。openaiApiKey 落库前由 electron/secretBox.js 加密
-- （v1:<iv>:<tag>:<密文>）；数据库层不做任何解释，原样存取。

CREATE TABLE IF NOT EXISTS account_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
