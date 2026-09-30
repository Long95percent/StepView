-- 画布文档。
--
-- 故意不拆成 tasks / nodes / edges 多张表：审批流程依赖整块内容的指纹（boardHash）判断
-- “提案生成后画布有没有被别人改过”。拆表会把指纹逻辑和 diff 逻辑一起推翻，风险远大于收益。
--
-- backup_json 承接重构前的 stepview-board.backup.json：主副本读不出来时回退到它。
CREATE TABLE IF NOT EXISTS board_documents (
  doc_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  backup_json TEXT,
  hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
