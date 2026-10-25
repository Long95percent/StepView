import { describe, expect, it } from "vitest";
import { resolveProduct } from "../electron/product.js";

describe("product profiles", () => {
  it("keeps the personal product account-free and on the existing data directory", () => {
    expect(resolveProduct("personal")).toMatchObject({
      id: "personal",
      displayName: "StepView Personal",
      dataDirectoryName: "StepView",
      capabilities: { accounts: false, manualUpdates: true },
    });
  });

  it("keeps account features in the family product", () => {
    expect(resolveProduct("family").capabilities).toMatchObject({ accounts: true });
  });
});
