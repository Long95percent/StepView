import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentMemorySqliteStore } from "../electron/agentMemorySqliteStore.js";
import { createMemoryPluginManager } from "../electron/agent/memoryPluginManager.js";

describe("agent memory repository", () => {
  it("keeps account scope and deletion tombstones", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "stepview-memory-"));
    const store = createAgentMemorySqliteStore({ dataDir, accountId: "a" });
    const item = store.upsert({ subjectKey: "style", statement: "concise", category: "preference" });
    expect(store.list()).toHaveLength(1);
    store.addEvidence(item.id, { sourceRef: "turn-1", quoteOrPayload: "concise please" });
    expect(store.listEvidence(item.id)).toHaveLength(1);
    expect(store.search("concise")).toHaveLength(1);
    expect(store.feedback(item.id, "confirm").status).toBe("active");
    expect(() => store.upsert({ accountId: "b", statement: "x" })).toThrow(/scope mismatch/);
    store.remove(item.id);
    expect(store.get(item.id).status).toBe("deleted");
    store.close();
  });
});

describe("memory plugin manager", () => {
  it("supports independent provider registration", async () => {
    const manager = createMemoryPluginManager({ providers: [{ id: "local", search: async () => [{ statement: "x" }] }] });
    expect(await manager.search("q", { accountId: "a" })).toEqual([{ statement: "x", providerId: "local" }]);
    expect(manager.unregister("local")).toBe(true);
    expect(await manager.search("q")).toEqual([]);
  });
});
