import { loadConfig, resolveDataDir } from "./config.js";
import { createFamilyHttpServer } from "./gateway/familyHttpServer.js";
import { createLogger } from "./logging.js";

const logger = createLogger();

try {
  const config = loadConfig();
  const dataDir = resolveDataDir({ mode: config.mode, dataDir: config.dataDir });
  const gateway = createFamilyHttpServer({ config, dataDir, logger });
  const address = await gateway.listen();
  logger.info("gateway_listening", { url: `http://${address.address}:${address.port}`, dataDir, mode: config.mode, registration: config.allowRegistration });

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info("gateway_stopping", { signal });
    try {
      await gateway.close();
    } catch (error) {
      logger.error("gateway_shutdown_failed", error);
      process.exit(1);
      return;
    }
    logger.info("gateway_stopped", { signal });
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
} catch (error) {
  // 起不来（端口被占、数据目录不可写……）要说清楚原因再退出，而不是甩一段堆栈。
  logger.error("gateway_start_failed", error);
  process.exit(1);
}
