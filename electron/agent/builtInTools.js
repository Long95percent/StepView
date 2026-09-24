import { createBuiltInToolset } from "./tools/index.js";

export function registerBuiltInTools({ registry }) {
  return registry.registerAll(createBuiltInToolset());
}
