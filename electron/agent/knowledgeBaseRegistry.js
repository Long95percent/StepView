import fs from "node:fs";
import path from "node:path";
const templates = { "general-knowledge": { version: 1, categories: ["concept", "source"] }, astrology: { version: 1, categories: ["concept", "interpretation", "source"], sensitiveFields: ["birthTime", "birthPlace"] }, "career-planning": { version: 1, categories: ["skill", "industry", "role", "source"] } };
export function createKnowledgeBaseRegistry({ dataDir, accountId }) {
  const root = path.join(dataDir, "knowledge-bases"); fs.mkdirSync(root, { recursive: true });
  function create(templateId, knowledgeBaseId = `${templateId}-${Date.now()}`) { const template = templates[templateId]; if (!template) throw new Error("Unknown knowledge base template."); const dir = path.join(root, knowledgeBaseId); if (fs.existsSync(dir)) throw new Error("Knowledge base already exists."); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ knowledgeBaseId, accountId, templateId, ...template }, null, 2), "utf8"); return { knowledgeBaseId, templateId, dir }; }
  function list() { return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => JSON.parse(fs.readFileSync(path.join(root, e.name, "manifest.json"), "utf8"))); }
  return { create, list, templates: () => ({ ...templates }) };
}
