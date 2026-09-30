-- 知识库清单。
--
-- 重构前每个知识库是 knowledge-bases/<id>/manifest.json 一份手写 JSON，列表要全扫目录。
-- 现在只有清单，没有正文：真正的知识条目（blobs）等有了写入方再单独建表，避免先建一张没人用的表。

CREATE TABLE IF NOT EXISTS knowledge_bases (
  knowledge_base_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_bases_account ON knowledge_bases(account_id, created_at DESC);
