import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentMemorySqliteStore } from "../electron/agentMemorySqliteStore.js";
import { createMemoryExtractor, extractMemoryCandidates } from "../electron/agent/memoryExtractor.js";

describe("memory extractor", () => {
  it("only extracts explicit high-signal statements", () => {
    expect(extractMemoryCandidates("短一点就好", { sourceRef: "turn-1" })).toEqual([]);
    const items = extractMemoryCandidates("我喜欢简短直接的回复", { sourceRef: "turn-2" });
    expect(items[0]).toMatchObject({ category: "preference", sourceRef: "turn-2", status: "candidate" });
  });
  it("stores evidence with candidates", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stepview-extractor-"));
    const repository = createAgentMemorySqliteStore({ dataDir, accountId: "a" });
    const extractor = createMemoryExtractor({ repository });
    const saved = await extractor.extractAndStore("我希望以后给我短答", { sourceRef: "turn-3" });
    expect(saved).toHaveLength(1);
    expect(repository.listEvidence(saved[0].id)).toHaveLength(1);
    repository.close();
  });
});
