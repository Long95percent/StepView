-- 全局库（gateway.sqlite）的表结构。
--
-- 全局库只放"不属于任何单个账号"的东西：账号、登录会话、网关设置，以及本库自己的清理记录。
-- 账号数据（画布、审批、记忆、画像）都在各自的账号库 stepview.sqlite 里。
--
-- 这三张表原先由 electron/gateway/accountStore.js 手写建表，这里逐字搬过来并用
-- IF NOT EXISTS 保证老库能平滑升级：老库执行完这条迁移后只是补上了 schema_migrations 记录。

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

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS gateway_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 清理记录：会话的过期清理跑在全局库上，执行记录就写在这里。
CREATE TABLE IF NOT EXISTS retention_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  removed_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_retention_runs_started ON retention_runs(started_at DESC);
