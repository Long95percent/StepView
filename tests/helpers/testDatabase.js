import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openAccountDatabase } from "../../electron/db/index.js";
import { createApprovalRepository } from "../../electron/db/repositories/approvalRepository.js";

export const TEST_ACCOUNT_ID = "account-a";

/** 建一个真实的账号库（临时目录 + 跑完迁移），测试里尽量别再自己拼 SQL。 */
export async function createTestDatabase(prefix = "stepview-db-") {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  const database = openAccountDatabase({ dataDir });
  return { dataDir, database, repository: createApprovalRepository({ connection: database }) };
}
