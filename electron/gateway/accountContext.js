import path from "node:path";
import { createMem0Client } from "../agentMem0Client.js";
import { createRedisAgentCache } from "../agentRedisClient.js";
import { createAgentService } from "../agentService.js";
import { createAgentSqliteStore } from "../agentSqliteStore.js";
import { createBoardStorage } from "../boardStorage.js";
import { createAgentMemorySqliteStore } from "../agentMemorySqliteStore.js";
import { createMemoryPluginManager } from "../agent/memoryPluginManager.js";
import { createMemoryExtractor } from "../agent/memoryExtractor.js";
import { createMemoryWriter } from "../agent/memoryWriter.js";
import { createContextOrchestrator } from "../agent/contextOrchestrator.js";
import { createToolRegistry } from "../agent/toolRegistry.js";
import { createToolRuntime } from "../agent/toolRuntime.js";
import { registerBuiltInTools } from "../agent/builtInTools.js";
import { createApprovalManager } from "../agent/approvalManager.js";

export function createAccountContext({
  account,
  accountsDir,
  boardStorageFactory = createBoardStorage,
  agentSqliteStoreFactory = createAgentSqliteStore,
  redisCacheFactory = createRedisAgentCache,
  mem0ClientFactory = createMem0Client,
  agentServiceFactory = createAgentService,
} = {}) {
  if (!account?.accountId) throw new Error("Account is required.");
  const dataDir = path.join(accountsDir, account.accountId);
  const boardStorage = boardStorageFactory({ dataDir });
  const agentSqliteStore = agentSqliteStoreFactory({ dataDir });
  const memoryRepository = createAgentMemorySqliteStore({ dataDir, accountId: account.accountId });
  const memoryPlugins = createMemoryPluginManager();
  const memoryExtractor = createMemoryExtractor({ repository: memoryRepository });
  const memoryWriter = createMemoryWriter({ repository: memoryRepository });
  const contextOrchestrator = createContextOrchestrator({ repository: memoryRepository, memoryPlugins });
  const memoryExtractorWithPolicy = createMemoryExtractor({ repository: memoryRepository, writer: memoryWriter });
  const toolRegistry = createToolRegistry();
  registerBuiltInTools({ registry: toolRegistry });
  const toolRuntime = createToolRuntime({ registry: toolRegistry });
  const approvalManager = createApprovalManager();
  const redisCache = redisCacheFactory({ namespace: `stepview:${account.accountId}:agent` });
  const mem0Client = mem0ClientFactory({ userId: account.accountId });
  const agentService = agentServiceFactory({ sqliteStore: agentSqliteStore, redisCache, mem0Client, memoryExtractor: memoryExtractorWithPolicy, contextOrchestrator });

  return {
    mode: "family",
    accountId: account.accountId,
    account,
    dataDir,
    boardStorage,
    agentSqliteStore,
    memoryRepository,
    memoryPlugins,
    memoryExtractor,
    memoryWriter,
    contextOrchestrator,
    toolRegistry,
    toolRuntime,
    approvalManager,
    redisCache,
    mem0Client,
    agentService,
    async close() {
      await boardStorage.flushWrites();
      await redisCache?.close?.();
      agentSqliteStore.close();
      memoryPlugins.close();
      memoryRepository.close();
    },
  };
}
