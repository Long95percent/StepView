import net from "node:net";

function isLoopback(host) { return host === "localhost" || host === "127.0.0.1" || host === "::1"; }
export function validateNetworkPolicy({ mode = "personal", host = "127.0.0.1", allowLan = false, enableUpnp = false, containerized = false } = {}) {
  if (enableUpnp) throw new Error("UPnP and port mapping are disabled.");
  if (containerized && mode === "family" && host === "0.0.0.0") return { mode, host, allowLan: Boolean(allowLan), enableUpnp: false, containerized: true };
  if (mode === "personal" && !isLoopback(host)) throw new Error("Personal mode requires loopback binding.");
  if (mode === "family" && !allowLan && !isLoopback(host)) throw new Error("Family mode without LAN sharing requires loopback binding.");
  if (mode === "family" && allowLan && (!net.isIP(host) || isLoopback(host) || host === "0.0.0.0")) throw new Error("Family LAN sharing requires an approved LAN IP.");
  return { mode, host, allowLan: Boolean(allowLan), enableUpnp: false, containerized: false };
}
