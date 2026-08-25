import path from "node:path";
import { loadConfig } from "./config.js";
import { createFamilyHttpServer } from "./gateway/familyHttpServer.js";

const config = loadConfig();
const dataDir = config.dataDir ? path.resolve(config.dataDir) : path.resolve(process.cwd(), ".stepview-family-data");
const gateway = createFamilyHttpServer({ config, dataDir });
const address = await gateway.listen();
console.log(`StepView family gateway listening on http://${address.address}:${address.port}`);

async function shutdown() {
  await gateway.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
