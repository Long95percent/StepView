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
import { createAccountSettingsRepository } from "../db/repositories/accountSettingsRepository.js";
import { createSecretKeyStore } from "../db/secretKeyStore.js";
import { createSecretBox } from "../secretBox.js";
import { createSettingsService } from "../settingsService.js";

export function createAccountContext({
  account,
  accountsDir,
  dataDir: explicitDataDir,
  mode = "family",
  secretKey = "",
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
  // 日记先建出来：画布保存时要拿它给"被删掉的节点"打孤儿标记。
  const diaryRepository = createDiaryRepository({ connection: database, accountId: account.accountId });
  const diaryService = createDiaryService({ repository: diaryRepository, accountId: account.accountId });
  // 设置属于账号数据，所以和画布、日记一样落在账号库里（以前在全局表里，账号之间互相可见）。
  const settingsRepository = createAccountSettingsRepository({ connection: database });
  // 密钥优先取 STEPVIEW_SECRET_KEY；没配就落在本账号目录下的 secret.key（0600），
  // 这样桌面版和本地开发不必先配环境变量。生产环境应当显式设置，理由见 secretBox.js。
  const settingsService = createSettingsService({
    repository: settingsRepository,
    secretBox: createSecretBox({ secret: secretKey, keyStore: createSecretKeyStore({ dataDir }) }),
  });
  const boardStorage = boardStorageFactory({
    dataDir,
    repository: createBoardRepository({ connection: database }),
    onNodesRemoved: (nodeIds) => diaryService.markNodesOrphaned(nodeIds),
  });
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
    settingsRepository,
    settingsService,
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
