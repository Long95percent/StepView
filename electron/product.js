const PRODUCTS = {
  personal: Object.freeze({
    id: "personal",
    displayName: "StepView Personal",
    windowTitle: "StepView Personal",
    // Keep the existing directory: renaming it would make an upgraded app lose
    // sight of the board and diary data that the current desktop build writes.
    dataDirectoryName: "StepView",
    capabilities: Object.freeze({ accounts: false, manualUpdates: true }),
  }),
  family: Object.freeze({
    id: "family",
    displayName: "StepView",
    windowTitle: "StepView",
    dataDirectoryName: "StepView",
    capabilities: Object.freeze({ accounts: true, manualUpdates: false }),
  }),
};

export function resolveProduct(mode = "personal") {
  const product = PRODUCTS[mode];
  if (!product) throw new Error(`Unsupported product mode: ${mode}`);
  return product;
}
