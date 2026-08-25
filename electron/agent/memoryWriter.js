export function createMemoryWriter({ repository } = {}) {
  if (!repository) throw new Error("Memory repository is required.");
  function writeCandidate(candidate) {
    const existing = repository.list({ scopeType: candidate.scopeType || "user" })
      .filter((item) => item.subjectKey === candidate.subjectKey && item.status !== "deleted");
    const same = existing.find((item) => item.statement === candidate.statement);
    if (same) {
      repository.addEvidence(same.id, { sourceType: candidate.sourceType, sourceRef: candidate.sourceRef, quoteOrPayload: candidate.evidenceSummary, confidence: candidate.confidence });
      return { memory: repository.get(same.id), action: "merged" };
    }
    const memory = repository.upsert(candidate);
    for (const other of existing) repository.relate(memory.id, other.id, "contradicts", Math.min(memory.confidence, other.confidence));
    return { memory, action: existing.length ? "disputed" : "created" };
  }
  return { writeCandidate };
}
