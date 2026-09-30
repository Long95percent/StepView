import { defineTool } from "./defineTool.js";
import { requireToolContext } from "./context.js";

export const memoryTools = [
  defineTool({
    id: "memory.search",
    title: "Search user memory",
    description: "Search the user's long-term memory for facts relevant to a query.",
    category: "memory",
    risk: "read",
    scopes: ["memory:read"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: { query: { type: "string", minLength: 1, maxLength: 500 }, limit: { type: "integer", minimum: 1, maximum: 50 } },
    },
    execute: async ({ query, limit = 10 }, context) => {
      requireToolContext(context, ["memoryRepository"], "memory.search");
      return context.memoryRepository.search(query, { limit, status: "active" });
    },
  }),

  defineTool({
    id: "memory.get",
    title: "Get a memory",
    description: "Read a single long-term memory entry by id.",
    category: "memory",
    risk: "read",
    scopes: ["memory:read"],
    inputSchema: { type: "object", additionalProperties: false, required: ["memoryId"], properties: { memoryId: { type: "string", minLength: 1, maxLength: 120 } } },
    execute: async ({ memoryId }, context) => {
      requireToolContext(context, ["memoryRepository"], "memory.get");
      return context.memoryRepository.get(memoryId);
    },
  }),

  defineTool({
    id: "memory.propose_upsert",
    title: "Propose a memory",
    description: "Propose a long-term memory entry. The user confirms before it is stored.",
    category: "memory",
    risk: "propose",
    scopes: ["memory:propose"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["category", "subjectKey", "statement"],
      properties: {
        category: { type: "string", minLength: 1, maxLength: 60 },
        subjectKey: { type: "string", minLength: 1, maxLength: 120 },
        statement: { type: "string", minLength: 1, maxLength: 500 },
        normalizedValue: { type: "string", maxLength: 500 },
      },
    },
    execute: async (input, context) => ({
      type: "memory_upsert",
      proposalId: `proposal-${Date.now()}`,
      accountId: context.accountId,
      agentId: context.agentId || "user",
      memory: {
        category: input.category,
        subjectKey: input.subjectKey,
        statement: input.statement,
        normalizedValue: input.normalizedValue || null,
        status: "candidate",
        sourceType: "tool",
      },
    }),
  }),
];
