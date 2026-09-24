import { boardTools } from "./boardTools.js";
import { memoryTools } from "./memoryTools.js";
import { agentTools } from "./agentTools.js";

export const TOOL_GROUPS = Object.freeze([
  { category: "board", description: "Read and propose changes to the user's board.", tools: boardTools },
  { category: "memory", description: "Read and propose the user's long-term memory.", tools: memoryTools },
  { category: "agent", description: "Agent self-inspection.", tools: agentTools },
]);

export function createBuiltInToolset() {
  return TOOL_GROUPS.flatMap((group) => group.tools);
}
