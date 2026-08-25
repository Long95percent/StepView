const VERSION = "rules-1";

function candidate({ subjectKey, statement, value, sourceRef, category = "preference", sensitivity = "normal", confidence = 0.82 }) {
  return { category, scopeType: "user", subjectKey, statement, normalizedValue: value, sourceType: "explicit", sourceRef, evidenceSummary: statement, confidence, sensitivity, extractionVersion: VERSION, status: "candidate" };
}

/** Extracts only explicit, high-signal user language. LLM enrichment belongs in a later async stage. */
export function extractMemoryCandidates(text, { sourceRef = "unknown" } = {}) {
  const value = String(text || "").trim();
  if (!value) return [];
  const result = [];
  const preference = value.match(/(?:我|以后|请|希望)(?:比较|更)?(?:喜欢|偏好|习惯|希望)(?:我)?(.{1,80})/);
  if (preference) result.push(candidate({ subjectKey: "response_preference", statement: `用户偏好${preference[1].replace(/[。.!！]$/, "")}`, value: { text: preference[1].trim() }, sourceRef }));
  const forbidden = value.match(/(?:不要|别|请勿|不希望)(.{1,80})/);
  if (forbidden) result.push(candidate({ subjectKey: "user_forbidden", statement: `用户不希望${forbidden[1].replace(/[。.!！]$/, "")}`, value: { text: forbidden[1].trim() }, sourceRef, category: "constraint", sensitivity: "sensitive", confidence: 0.9 }));
  const goal = value.match(/(?:我的目标是|我想要|我希望在[^，。]*?完成)(.{1,100})/);
  if (goal) result.push(candidate({ subjectKey: "current_goal", statement: `用户目标：${goal[1].replace(/[。.!！]$/, "")}`, value: { text: goal[1].trim() }, sourceRef, category: "goal", sensitivity: "normal", confidence: 0.86 }));
  return result;
}

export function createMemoryExtractor({ repository, writer } = {}) {
  if (!repository) throw new Error("Memory repository is required.");
  async function extractAndStore(text, options = {}) {
    const candidates = extractMemoryCandidates(text, options);
    const stored = [];
    for (const item of candidates) {
      const memory = writer ? writer.writeCandidate(item).memory : repository.upsert(item);
      repository.addEvidence(memory.id, { sourceType: item.sourceType, sourceRef: item.sourceRef, quoteOrPayload: text, confidence: item.confidence });
      stored.push(memory);
    }
    return stored;
  }
  return { extractAndStore };
}
