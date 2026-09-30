import { defineTool } from "./defineTool.js";
import { requireToolContext } from "./context.js";

const LINK_TYPES = ["node", "branch", "task"];

function linksFromInput(input) {
  const links = Array.isArray(input.links) ? [...input.links] : [];
  for (const nodeId of Array.isArray(input.nodeIds) ? input.nodeIds : []) {
    links.push({ targetType: "node", targetId: nodeId, role: "primary" });
  }
  return links;
}

export const diaryTools = [
  defineTool({
    id: "diary.recent",
    title: "Read recent diary entries",
    description:
      "Read a short timeline of the user's recent diary entries: day, title, summary, tags and kind. "
      + "kind is \"daily\" for the day-based entries the user reads in the diary board, and \"node\" for the ones attached to a canvas node.",
    category: "diary",
    risk: "read",
    scopes: ["diary:read"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
    },
    execute: async ({ limit = 20 } = {}, context) => {
      requireToolContext(context, ["diaryService"], "diary.recent");
      return context.diaryService.timeline({ limit });
    },
  }),

  defineTool({
    id: "diary.propose_entry",
    title: "Propose a diary entry",
    description:
      "Propose a new diary entry, or an edit to an existing one. This does NOT write anything: the entry is staged for the user to review and confirm, then applied on approval. Give at least a title or content. "
      + "Set kind to \"node\" only for an entry about a specific canvas node, and always pass that node's id in nodeIds, otherwise the proposal is rejected.",
    category: "diary",
    risk: "propose",
    scopes: ["diary:propose"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        operation: { type: "string", enum: ["create", "update"], description: "Create a new entry (default) or edit an existing one." },
        diaryId: { type: "string", maxLength: 120, description: "Required when operation is \"update\"." },
        kind: {
          type: "string",
          enum: ["daily", "node"],
          description:
            "\"daily\" (default) is a day-based entry that shows up in the diary board under its date. "
            + "\"node\" is an entry attached to a canvas node and shows up in that node's native diary list; it requires at least one node in nodeIds.",
        },
        title: { type: "string", maxLength: 120 },
        content: { type: "string", minLength: 1, maxLength: 20000 },
        occurredAt: { type: "string", maxLength: 40 },
        timezone: { type: "string", maxLength: 60 },
        tags: { type: "array", maxItems: 24, items: { type: "string", maxLength: 32 } },
        nodeIds: { type: "array", maxItems: 24, items: { type: "string", maxLength: 120 }, description: "Canvas nodes this entry is about." },
        links: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["targetType", "targetId"],
            properties: {
              targetType: { type: "string", enum: LINK_TYPES },
              targetId: { type: "string", maxLength: 120 },
              role: { type: "string", enum: ["primary", "context", "evidence"] },
              taskId: { type: "string", maxLength: 120 },
            },
          },
        },
        reason: { type: "string", maxLength: 500, description: "Why this entry is worth keeping. Shown in the review dialog." },
      },
    },
    execute: async (input, context) => {
      requireToolContext(context, ["diaryService", "approvalManager", "accountId"], "diary.propose_entry");
      const proposal = context.diaryService.planChange(
        { ...input, links: linksFromInput(input) },
        { operation: input.operation || "create" },
      );
      const staged = context.approvalManager.submit(proposal, { accountId: context.accountId, sessionId: context.sessionId || null });
      return { ...proposal, approvalId: staged.approvalId, requiresApproval: true };
    },
  }),
];
