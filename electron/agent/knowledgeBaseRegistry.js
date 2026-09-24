import { createKnowledgeBaseRepository } from "../db/repositories/knowledgeBaseRepository.js";

/**
 * 知识库模板。纯数据，不属于持久层：它描述"这类知识库有哪些分类"，
 * 用户建出来的知识库清单存在数据库表 knowledge_bases 里。
 */
const templates = {
  "general-knowledge": { version: 1, categories: ["concept", "source"] },
  astrology: { version: 1, categories: ["concept", "interpretation", "source"], sensitiveFields: ["birthTime", "birthPlace"] },
  "career-planning": { version: 1, categories: ["skill", "industry", "role", "source"] },
};

export function createKnowledgeBaseRegistry({ connection, accountId, now = () => new Date() } = {}) {
  const repository = createKnowledgeBaseRepository({ connection, accountId });

  function create(templateId, knowledgeBaseId = `${templateId}-${Date.now()}`) {
    const template = templates[templateId];
    if (!template) throw new Error("Unknown knowledge base template.");
    if (repository.get(knowledgeBaseId)) throw new Error("Knowledge base already exists.");
    const manifest = repository.create({
      knowledgeBaseId,
      templateId,
      definition: template,
      createdAt: now().toISOString(),
    });
    return { knowledgeBaseId: manifest.knowledgeBaseId, templateId: manifest.templateId };
  }

  function list() {
    return repository.list();
  }

  return { create, list, templates: () => ({ ...templates }) };
}
