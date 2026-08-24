import { createLocalGateway } from "./localGateway.js";

export function createGateway(options) {
  const gatewayName = options?.config?.gateway || "local";
  if (gatewayName !== "local") throw new Error(`Unsupported gateway: ${gatewayName}`);
  return createLocalGateway(options);
}