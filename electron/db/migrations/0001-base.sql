-- 数据库层基础表。迁移只能新增文件，不能修改已经发布过的迁移。

-- 通用键值存储：承接原先散落在 Redis 和内存里的状态。
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 保留策略的执行记录，用于回答“我的数据为什么不见了”。
CREATE TABLE IF NOT EXISTS retention_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  removed_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_retention_runs_started ON retention_runs(started_at DESC);
