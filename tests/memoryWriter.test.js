import { describe, expect, it } from "vitest";
import { createMemoryWriter } from "../electron/agent/memoryWriter.js";

describe("memory writer", () => {
  it("merges duplicate candidates and relates conflicts", () => {
    const items = [];
    const relations = [];
    const repository = {
      list: () => items,
      upsert: (item) => { const value = { id: `m${items.length + 1}`, ...item }; items.push(value); return value; },
      get: (id) => items.find((item) => item.id === id),
      addEvidence: () => {},
      relate: (...args) => relations.push(args),
    };
    const writer = createMemoryWriter({ repository });
    expect(writer.writeCandidate({ subjectKey: "style", statement: "short" }).action).toBe("created");
    expect(writer.writeCandidate({ subjectKey: "style", statement: "short" }).action).toBe("merged");
    expect(writer.writeCandidate({ subjectKey: "style", statement: "detailed" }).action).toBe("disputed");
    expect(relations).toHaveLength(1);
  });
});
