export function createAgentAuditStore({ sqliteStore, logger = console } = {}) {
  function record(event = {}) { if (!event.sessionId || !sqliteStore?.recordSignal) return null; try { return sqliteStore.recordSignal({ sessionId: event.sessionId, turnId: event.turnId || null, kind: event.kind || "audit", payload: event }); } catch (error) { logger.warn?.("Audit write failed", error); return null; } }
  return { record };
}
