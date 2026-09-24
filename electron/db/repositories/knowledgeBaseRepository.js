function manifestFromRow(row) {
  if (!row) return null;
  let definition = {};
  try {
    definition = JSON.parse(row.definition_json);
  } catch {
    definition = {};
  }
  return {
    knowledgeBaseId: row.knowledge_base_id,
    accountId: row.account_id,
    templateId: row.template_id,
    ...definition,
  };
}

/**
 * 知识库清单仓储。
 *
 * 取代原先 knowledge-bases/<id>/manifest.json 的手写目录：列表不再需要扫目录读文件，
 * 账号之间也不会因为共用目录而串数据。
 */
export function createKnowledgeBaseRepository({ connection, accountId } = {}) {
  if (!connection?.db) throw new Error("Knowledge base repository requires a database connection.");
  if (!accountId) throw new Error("Knowledge base repository requires an accountId.");
  const { db } = connection;

  const selectStatement = db.prepare("SELECT * FROM knowledge_bases WHERE knowledge_base_id = ? AND account_id = ?");
  const listStatement = db.prepare("SELECT * FROM knowledge_bases WHERE account_id = ? ORDER BY created_at ASC, knowledge_base_id ASC");
  const insertStatement = db.prepare(
    "INSERT INTO knowledge_bases (knowledge_base_id, account_id, template_id, definition_json, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const deleteStatement = db.prepare("DELETE FROM knowledge_bases WHERE knowledge_base_id = ? AND account_id = ?");

  return {
    get(knowledgeBaseId) {
      return manifestFromRow(selectStatement.get(String(knowledgeBaseId), accountId));
    },

    list() {
      return listStatement.all(accountId).map(manifestFromRow);
    },

    /** 新建清单。id 已存在时抛出业务可读的错误，和其它仓储保持一致。 */
    create({ knowledgeBaseId, templateId, definition = {}, createdAt }) {
      try {
        insertStatement.run(String(knowledgeBaseId), accountId, String(templateId), JSON.stringify(definition ?? {}), createdAt);
      } catch (error) {
        if (String(error.message).includes("UNIQUE") || String(error.message).includes("PRIMARY KEY")) {
          throw new Error("Knowledge base already exists.");
        }
        throw error;
      }
      return this.get(knowledgeBaseId);
    },

    remove(knowledgeBaseId) {
      return Number(deleteStatement.run(String(knowledgeBaseId), accountId).changes || 0);
    },
  };
}
