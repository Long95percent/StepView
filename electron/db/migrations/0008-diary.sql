-- 日记：条目、与画布节点的关联、标签、变更日志与全文索引。
--
-- 日记是行式、无界增长的数据，要按天、按标签、按节点查询，所以必须建表而不是塞进画布文档。
-- 关联表故意不写外键指向画布：画布是一整块 JSON 文档，节点不是数据库里的行。
-- 节点被删掉时关联不会消失，而是打上 orphaned_at，让日记还能说清"当时关联的是哪条记录"。

CREATE TABLE IF NOT EXISTS diary_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  occurred_at TEXT NOT NULL,
  occurred_day TEXT NOT NULL,
  timezone TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',   -- active | archived | trashed
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_diary_day ON diary_entries(account_id, occurred_day DESC);
CREATE INDEX IF NOT EXISTS idx_diary_recent ON diary_entries(account_id, status, occurred_at DESC);

CREATE TABLE IF NOT EXISTS diary_links (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  diary_id TEXT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,     -- node | branch | task
  target_id TEXT NOT NULL,
  task_id TEXT,
  role TEXT NOT NULL DEFAULT 'context',    -- primary | context | evidence
  created_by TEXT NOT NULL DEFAULT 'user',
  orphaned_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (diary_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_diary_links_target ON diary_links(account_id, target_type, target_id);

CREATE TABLE IF NOT EXISTS diary_tags (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (account_id, name)
);

CREATE TABLE IF NOT EXISTS diary_entry_tags (
  diary_id TEXT NOT NULL REFERENCES diary_entries(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES diary_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (diary_id, tag_id)
);

CREATE TABLE IF NOT EXISTS diary_revisions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  diary_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_diary_revisions_entry ON diary_revisions(account_id, diary_id, rev DESC);

-- 中文全文检索。
--
-- 实测：FTS5 默认的 unicode61 分词器会把整段中文当成一个词，两字查询完全搜不到；
-- trigram 分词器三字及以上正常，两字仍然返回空。所以检索会走混合策略：
-- 三个字以上（且每个词都够长）走这里，少于三字由 diaryRepository 回退到 LIKE 模糊匹配。
CREATE VIRTUAL TABLE IF NOT EXISTS diary_fts USING fts5(
  diary_id UNINDEXED,
  account_id UNINDEXED,
  title,
  content,
  tokenize = 'trigram'
);
