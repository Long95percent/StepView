/**
 * 结构化日志。
 *
 * 一行一条 JSON，直接喂给容器日志收集器（docker logs / journald / Loki）就能按字段查询，
 * 不用正则去啃中文字符串。以前这里散着一堆 console.log，上服务器之后"谁在什么时候
 * 用哪个账号做了什么"完全查不出来。
 *
 * 只写 stdout/stderr，不写文件：容器里日志该由 Docker 收集，写文件反而会撑爆数据盘，
 * 也绕不过"只有 db 层能写文件"这条边界。
 */

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
// 静默是给测试和脚本用的：调成 silent 之后一行都不输出，也不需要 mock stdout。
const SILENT = Number.POSITIVE_INFINITY;

function normalizeLevel(level) {
  const value = String(level || "").toLowerCase();
  if (value === "silent" || value === "off") return SILENT;
  return LEVELS[value] ?? LEVELS.info;
}

/** 把 Error 压成可序列化的形状；顺带保住 code/statusCode 这些排查时要用的字段。 */
function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  return {
    message: error.message,
    name: error.name,
    code: error.code ?? null,
    statusCode: error.statusCode ?? null,
    stack: error.stack ? String(error.stack).split("\n").slice(0, 6).join("\n") : null,
  };
}

function toFields(value) {
  if (value === undefined || value === null) return {};
  if (value instanceof Error) return { error: serializeError(value) };
  if (typeof value !== "object") return { detail: String(value) };
  const fields = {};
  for (const [key, item] of Object.entries(value)) {
    fields[key] = item instanceof Error ? serializeError(item) : item;
  }
  return fields;
}

export function createLogger({
  level = process.env.STEPVIEW_LOG_LEVEL || "info",
  stream = process.stdout,
  now = () => new Date(),
  fields: baseFields = {},
} = {}) {
  const threshold = normalizeLevel(level);

  function write(entryLevel, event, value) {
    if (LEVELS[entryLevel] < threshold) return null;
    const entry = {
      ts: now().toISOString(),
      level: entryLevel,
      event: event instanceof Error ? event.message : String(event),
      ...baseFields,
      ...toFields(value),
    };
    try {
      stream.write(`${JSON.stringify(entry)}\n`);
    } catch {
      // 日志写失败不能反过来把应用打死（比如管道被关掉）。
    }
    return entry;
  }

  return {
    level,
    debug: (event, value) => write("debug", event, value),
    info: (event, value) => write("info", event, value),
    warn: (event, value) => write("warn", event, value),
    error: (event, value) => write("error", event, value),
    /** 固定字段的派生 logger，用来带上 accountId / requestId 这类上下文。 */
    child(extra) {
      return createLogger({ level, stream, now, fields: { ...baseFields, ...toFields(extra) } });
    },
  };
}
