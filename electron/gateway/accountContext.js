import path from "node:path";
import { createMem0Client } from "../agentMem0Client.js";
import { createRedisAgentCache } from "../agentRedisClient.js";
import { createAgentService } from "../agentService.js";
import { createAgentSessionRepository } from "../db/repositories/agentSessionRepository.js";
import { createBoardStorage } from "../boardStorage.js";
import { createAgentMemoryRepository } from "../db/repositories/agentMemoryRepository.js";
import { createMemoryPluginManager } from "../agent/memoryPluginManager.js";
import { createMemoryExtractor } from "../agent/memoryExtractor.js";
import { createMemoryWriter } from "../agent/memoryWriter.js";
import { createContextOrchestrator } from "../agent/contextOrchestrator.js";
import { createToolRegistry } from "../agent/toolRegistry.js";
import { createToolRuntime } from "../agent/toolRuntime.js";
import { registerBuiltInTools } from "../agent/builtInTools.js";
import { createApprovalManager } from "../agent/approvalManager.js";
import { createBoardChangeStore } from "../agent/boardChangeStore.js";
import { createBoardChangeExecutor } from "../agent/boardChangeExecutor.js";
import { createApprovalService } from "../agent/approvalService.js";
import { openAccountDatabase } from "../db/index.js";
import { createApprovalRepository } from "../db/repositories/approvalRepository.js";

export function createAccountContext({
  account,
  accountsDir,
  dataDir: explicitDataDir,
  mode = "family",
  boardStorageFactory = createBoardStorage,
  agentSessionRepositoryFactory = createAgentSessionRepository,
  redisCacheFactory = createRedisAgentCache,
  mem0ClientFactory = createMem0Client,
  agentServiceFactory = createAgentService,
  databaseFactory = openAccountDatabase,
} = {}) {
  if (!account?.accountId) throw new Error("Account is required.");
  const dataDir = explicitDataDir ? path.resolve(explicitDataDir) : path.join(accountsDir, account.accountId);
  const database = databaseFactory({ dataDir });
  const approvalRepository = createApprovalRepository({ connection: database });
  const boardStorage = boardStorageFactory({ dataDir });
  const agentSqliteStore = agentSessionRepositoryFactory({ connection: database });
  const memoryRepository = createAgentMemoryRepository({ connection: database, accountId: account.accountId });
  const memoryPlugins = createMemoryPluginManager();
  const memoryExtractor = createMemoryExtractor({ repository: memoryRepository });
  const memoryWriter = createMemoryWriter({ repository: memoryRepository });
  const contextOrchestrator = createContextOrchestrator({ repository: memoryRepository, memoryPlugins });
  const memoryExtractorWithPolicy = createMemoryExtractor({ repository: memoryRepository, writer: memoryWriter });
  const toolRegistry = createToolRegistry();
  registerBuiltInTools({ registry: toolRegistry });
  const toolRuntime = createToolRuntime({ registry: toolRegistry });
  const approvalManager = createApprovalManager({ repository: approvalRepository });
  const boardChangeStore = createBoardChangeStore({ connection: database, accountId: account.accountId });
  const boardChangeExecutor = createBoardChangeExecutor({ boardStorage, changeStore: boardChangeStore });
  const approvalService = createApprovalService({ approvalManager, boardChangeStore, boardChangeExecutor, memoryRepository });
  const redisCache = redisCacheFactory({ namespace: `stepview:${account.accountId}:agent` });
  const mem0Client = mem0ClientFactory({ userId: account.accountId });
  const agentService = agentServiceFactory({ sqliteStore: agentSqliteStore, redisCache, mem0Client, memoryExtractor: memoryExtractorWithPolicy, contextOrchestrator });

  return {
    mode,
    accountId: account.accountId,
    account,
    dataDir,
    database,
    approvalRepository,
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
    boardChangeStore,
    boardChangeExecutor,
    approvalService,
    redisCache,
    mem0Client,
    agentService,
    async close() {
      await boardStorage.flushWrites();
      await redisCache?.close?.();
      memoryPlugins.close();
      database.close();
    },
  };
}
