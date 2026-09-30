import { defineTool } from "./defineTool.js";

export const agentTools = [
  defineTool({
    id: "agent.get_current_context",
    title: "Get agent context",
    description: "Read the identifiers of the current account, agent, workspace and session.",
    category: "agent",
    risk: "read",
    scopes: ["agent:read"],
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
    execute: async (_input, context) => ({
      accountId: context.accountId || null,
      agentId: context.agentId || "user",
      workspaceId: context.workspaceId || null,
      sessionId: context.sessionId || null,
    }),
  }),
];
