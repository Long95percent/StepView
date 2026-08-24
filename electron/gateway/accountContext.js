import path from "node:path";
import { createMem0Client } from "../agentMem0Client.js";
import { createRedisAgentCache } from "../agentRedisClient.js";
import { createAgentService } from "../agentService.js";
import { createAgentSqliteStore } from "../agentSqliteStore.js";
import { createBoardStorage } from "../boardStorage.js";

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
  const redisCache = redisCacheFactory({ namespace: `stepview:${account.accountId}:agent` });
  const mem0Client = mem0ClientFactory({ userId: account.accountId });
  const agentService = agentServiceFactory({ sqliteStore: agentSqliteStore, redisCache, mem0Client });

  return {
    mode: "family",
    accountId: account.accountId,
    account,
    dataDir,
    boardStorage,
    agentSqliteStore,
    redisCache,
    mem0Client,
    agentService,
    async close() {
      await boardStorage.flushWrites();
      await redisCache?.close?.();
      agentSqliteStore.close();
    },
  };
}