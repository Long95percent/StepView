import path from "node:path";
import { createMem0Client } from "../agentMem0Client.js";
import { createRedisAgentCache } from "../agentRedisClient.js";
import { createAgentService } from "../agentService.js";
import { createAgentSessionRepository } from "../db/repositories/agentSessionRepository.js";
import { createBoardStorage } from "../boardStorage.js";
import { createBoardRepository } from "../db/repositories/boardRepository.js";
import { createAgentMemoryRepository } from "../db/repositories/agentMemoryRepository.js";
import { createDiaryRepository } from "../db/repositories/diaryRepository.js";
import { createDiaryService } from "../diaryService.js";
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
import { createDatabaseMaintenance } from "../db/maintenance.js";
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
  // 账号库的过期清理：启动时跑一次，之后每天一次（规则见 db/retention.js）。
  const maintenance = createDatabaseMaintenance({ connection: database });
  maintenance.start();
  // 画布和审批、记忆共用同一个账号库连接，避免同一进程里对同一个文件开两个写入连接。
  const boardStorage = boardStorageFactory({ dataDir, repository: createBoardRepository({ connection: database }) });
  const agentSqliteStore = agentSessionRepositoryFactory({ connection: database });
  const memoryRepository = createAgentMemoryRepository({ connection: database, accountId: account.accountId });
  const diaryRepository = createDiaryRepository({ connection: database, accountId: account.accountId });
  const diaryService = createDiaryService({ repository: diaryRepository, accountId: account.accountId });
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
  const approvalService = createApprovalService({ approvalManager, boardChangeStore, boardChangeExecutor, memoryRepository, diaryService });
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
    diaryRepository,
    diaryService,
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
    maintenance,
    redisCache,
    mem0Client,
    agentService,
    async close() {
      maintenance.stop();
      await boardStorage.flushWrites();
      boardStorage.close?.();
      await redisCache?.close?.();
      memoryPlugins.close();
      database.close();
    },
  };
}
