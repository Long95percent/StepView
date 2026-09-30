import { describe, expect, it } from "vitest";
import {
  accountStorageKey,
  clearLegacyUnscoped,
  readAccountScoped,
  removeAccountScoped,
  writeAccountScoped,
} from "../src/accountScopedStorage.js";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  };
}

const KEY = "stepview-board-v1";
const BOARD_A = { tasks: [{ id: "task-a", title: "A 的看板", nodes: [] }] };
const BOARD_B = { tasks: [{ id: "task-b", title: "B 的看板", nodes: [] }] };

describe("account scoped storage", () => {
  it("keys each account separately", () => {
    expect(accountStorageKey(KEY, "account-a")).toBe("stepview-board-v1:account-a");
    expect(accountStorageKey(KEY, "account-b")).toBe("stepview-board-v1:account-b");
    // 没有归属就不是"某个键"，调用方一律读不到东西。
    expect(accountStorageKey(KEY, "")).toBe(KEY);
  });

  it("never hands one account's backup to another", () => {
    // 这次串号事故的最小复现：同一个浏览器里 A 先登录、B 后登录。
    const storage = memoryStorage();
    writeAccountScoped(storage, KEY, "account-a", BOARD_A);

    expect(readAccountScoped(storage, KEY, "account-a").value).toEqual(BOARD_A);
    // B 是全新账号，服务端还是空的——以前就是在这里读到 A 的看板，还被写回了 B 的账号。
    expect(readAccountScoped(storage, KEY, "account-b")).toBe(null);
  });

  it("refuses a backup whose owner field does not match the key", () => {
    const storage = memoryStorage();
    writeAccountScoped(storage, KEY, "account-a", BOARD_A);
    // 键被搬到了 B 名下（手工改、或者以后重构写串了），内容里的归属仍然写着 A。
    storage.setItem(accountStorageKey(KEY, "account-b"), storage.getItem(accountStorageKey(KEY, "account-a")));

    expect(readAccountScoped(storage, KEY, "account-b")).toBe(null);
  });

  it("never reads a backup when there is no account", () => {
    const storage = memoryStorage();
    writeAccountScoped(storage, KEY, "account-a", BOARD_A);
    expect(readAccountScoped(storage, KEY, "")).toBe(null);
    expect(readAccountScoped(storage, KEY, null)).toBe(null);
    expect(readAccountScoped(storage, KEY, undefined)).toBe(null);
  });

  it("does not write a backup when there is no account", () => {
    const storage = memoryStorage();
    // 匿名状态下的看板不能变成"下一个登录者自己的备份"。
    expect(writeAccountScoped(storage, KEY, "", BOARD_A)).toBe(false);
    expect(storage.keys()).toEqual([]);
  });

  it("survives storage that throws and content that is not json", () => {
    const hostile = {
      getItem: () => "{ not json",
      setItem: () => { throw new Error("QuotaExceededError"); },
      removeItem: () => { throw new Error("nope"); },
    };
    expect(readAccountScoped(hostile, KEY, "account-a")).toBe(null);
    expect(writeAccountScoped(hostile, KEY, "account-a", BOARD_A)).toBe(false);
    expect(removeAccountScoped(hostile, KEY, "account-a")).toBe(false);
    expect(clearLegacyUnscoped(hostile, KEY)).toBe(false);
  });

  it("round-trips a backup and deletes only its own account's copy", () => {
    const storage = memoryStorage();
    writeAccountScoped(storage, KEY, "account-a", BOARD_A);
    writeAccountScoped(storage, KEY, "account-b", BOARD_B);

    expect(readAccountScoped(storage, KEY, "account-b").value).toEqual(BOARD_B);
    expect(removeAccountScoped(storage, KEY, "account-a")).toBe(true);
    expect(readAccountScoped(storage, KEY, "account-a")).toBe(null);
    expect(readAccountScoped(storage, KEY, "account-b").value).toEqual(BOARD_B);
  });

  it("drops the legacy unattributable key instead of guessing whose it is", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify(BOARD_A) });
    // 老键没有归属，猜错就是一次越界——所以只能删，不能读。
    expect(readAccountScoped(storage, KEY, "account-a")).toBe(null);
    expect(clearLegacyUnscoped(storage, KEY)).toBe(true);
    expect(storage.getItem(KEY)).toBe(null);
  });

  it("stamps who wrote the backup and when", () => {
    const storage = memoryStorage();
    writeAccountScoped(storage, KEY, "account-a", BOARD_A, { now: () => "2026-09-30T00:00:00.000Z" });
    const saved = readAccountScoped(storage, KEY, "account-a");
    expect(saved).toMatchObject({ ownerId: "account-a", savedAt: "2026-09-30T00:00:00.000Z" });
  });
});
