import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SECRET_KEY_FILE = "secret.key";
const KEY_BYTES = 32;

/**
 * 数据目录里的加密密钥文件。
 *
 * 放在数据库层，是因为它和数据库一样都属于"数据怎么落盘"这件事——
 * 整个项目只有 electron/db/ 允许直接写文件（见 tests/dbBoundary.test.js），
 * 业务层（secretBox）只应该拿到"一把密钥"，不该知道它从哪来。
 *
 * 它存在的前提是"没配 STEPVIEW_SECRET_KEY，但又需要加密"：
 * 桌面版和本地开发不该为了存一个 API Key 先配环境变量。
 * 代价是密钥会跟着数据目录的备份一起走，所以生产环境应当显式配环境变量。
 */
export function createSecretKeyStore({ dataDir = "", fsApi = fs } = {}) {
  const filePath = dataDir ? path.join(dataDir, SECRET_KEY_FILE) : "";

  return {
    filePath,

    /** 已有的密钥；没有（或没配数据目录）返回空串。 */
    read() {
      if (!filePath) return "";
      try {
        return String(fsApi.readFileSync(filePath, "utf8")).trim();
      } catch (error) {
        if (error.code === "ENOENT") return "";
        throw error;
      }
    },

    /** 取密钥，没有就现生成一个。0600：同机器上的其他用户读不到。 */
    ensure() {
      const existing = this.read();
      if (existing) return existing;
      if (!filePath) throw new Error("Secret key store requires a dataDir.");
      const generated = crypto.randomBytes(KEY_BYTES).toString("hex");
      fsApi.mkdirSync(dataDir, { recursive: true });
      fsApi.writeFileSync(filePath, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
      return generated;
    },
  };
}
