import { describe, expect, it } from "vitest";
import { createContextOrchestrator } from "../electron/agent/contextOrchestrator.js";

describe("context orchestrator", () => {
  it("returns scoped evidence-aware context packs", async () => {
    const orchestrator = createContextOrchestrator({
      repository: { search: () => [{ id: "m1", statement: "偏好简短回复", category: "preference", confidence: 0.9, status: "active", scopeType: "user", evidenceSummary: "turn-1" }] },
    });
    const result = await orchestrator.retrieve("简短", { tokenBudget: 100 });
    expect(result.items[0]).toMatchObject({ memoryId: "m1", evidence: ["turn-1"], origin: "local" });
    expect(result.items[0].whyRetrieved).toContain("简短");
  });
});
