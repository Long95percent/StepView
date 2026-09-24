-- 统一审批队列与变更快照。
-- 取代原先的“记忆审批放内存 Map”和“画布提案一个文件一条记录”两套机制。

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- board_change | memory_upsert | diary_change
  status TEXT NOT NULL,             -- pending | approved | rejected | expired
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  operation TEXT,
  session_id TEXT,
  payload_json TEXT NOT NULL,
  diff_json TEXT,
  base_hash TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_kind ON approvals(account_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- board | diary
  label TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_recent ON snapshots(account_id, kind, created_at DESC);
