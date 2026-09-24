-- 用户画像。表结构逐字沿用重构前的 user-profile.sqlite，列顺序不能改：
-- 旧代码用的是不带列名的 INSERT VALUES (?...)，列顺序变了数据就会错位。
CREATE TABLE IF NOT EXISTS profile_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_key ON profile_items(account_id, category, key);
