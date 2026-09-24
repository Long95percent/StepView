-- 长期记忆、证据链、反馈、关系与向量索引。
-- 表结构逐字沿用重构前的 agent-memory.sqlite。
CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, agent_id TEXT NOT NULL, workspace_id TEXT,
    scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, category TEXT NOT NULL, subcategory TEXT,
    subject_key TEXT NOT NULL, statement TEXT NOT NULL, normalized_value_json TEXT,
    source_type TEXT NOT NULL, source_ref TEXT, evidence_summary TEXT, confidence REAL NOT NULL DEFAULT 0,
    importance REAL NOT NULL DEFAULT 0, stability REAL NOT NULL DEFAULT 0, sensitivity TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'candidate', valid_from TEXT, valid_until TEXT, last_confirmed_at TEXT,
    last_recalled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, extraction_version TEXT NOT NULL DEFAULT '1'
  ); CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_dedupe ON memory_items(account_id, agent_id, scope_type, scope_id, subject_key, statement);
  CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory_items(account_id, agent_id, scope_type, scope_id, status);
  CREATE TABLE IF NOT EXISTS memory_evidence (id TEXT PRIMARY KEY, memory_id TEXT NOT NULL, account_id TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT, quote_or_payload TEXT, polarity TEXT NOT NULL DEFAULT 'support', confidence REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_feedback (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, memory_id TEXT NOT NULL, action TEXT NOT NULL, previous_value_json TEXT, next_value_json TEXT, reason TEXT, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_relations (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, from_memory_id TEXT NOT NULL, to_memory_id TEXT NOT NULL, relation_type TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_embeddings (memory_id TEXT NOT NULL, account_id TEXT NOT NULL, embedding_provider TEXT NOT NULL, embedding_model TEXT, vector_ref TEXT, content_hash TEXT, index_version TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, PRIMARY KEY(memory_id, embedding_provider));
