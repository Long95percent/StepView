import { boardTools } from "./boardTools.js";
import { diaryTools } from "./diaryTools.js";
import { memoryTools } from "./memoryTools.js";
import { agentTools } from "./agentTools.js";

export const TOOL_GROUPS = Object.freeze([
  { category: "board", description: "Read and propose changes to the user's board.", tools: boardTools },
  { category: "diary", description: "Read the user's diary and propose new entries for review.", tools: diaryTools },
  { category: "memory", description: "Read and propose the user's long-term memory.", tools: memoryTools },
  { category: "agent", description: "Agent self-inspection.", tools: agentTools },
]);

export function createBuiltInToolset() {
  return TOOL_GROUPS.flatMap((group) => group.tools);
}
