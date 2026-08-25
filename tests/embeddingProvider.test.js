import { describe, expect, it } from "vitest";
import { createEmbeddingManager } from "../electron/agent/embeddingProvider.js";
describe("embedding manager", () => { it("uses replaceable providers", async () => { const manager = createEmbeddingManager({ providers: [{ id: "test", embed: async () => [1, 2] }] }); expect(await manager.embed("x")).toEqual([1, 2]); }); });
