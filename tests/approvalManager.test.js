import { describe, expect, it } from "vitest";
import { createApprovalManager } from "../electron/agent/approvalManager.js";

describe("approval manager", () => {
  it("isolates and decides proposals by account", () => {
    const manager = createApprovalManager(); const item = manager.submit({ type: "board_change" }, { accountId: "a" });
    expect(manager.list("b")).toEqual([]); expect(() => manager.decide(item.approvalId, "b", "approved")).toThrow();
    expect(manager.decide(item.approvalId, "a", "approved").status).toBe("approved");
  });
});
