import { createHash } from "node:crypto";
import { normalizeBoard } from "../../src/progressCore.js";

/** 稳定序列化：同样的内容无论键顺序如何都得到同一个字符串。 */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

/**
 * 画布内容指纹。
 *
 * 审批流程靠它判断"提案生成之后画布有没有被别人改过"，所以它必须对整个画布取哈希，
 * 而不是对某几行取。这也是画布保持"一整块文档"而不是拆成表的原因。
 */
export function boardHash(board) {
  return createHash("sha256").update(canonicalJson(normalizeBoard(board))).digest("hex");
}
