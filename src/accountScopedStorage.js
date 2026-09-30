/**
 * 按账号隔离的浏览器备份。
 *
 * localStorage 是**整个浏览器共用的**：同一个浏览器里换一个账号，上一个账号写下的东西
 * 还在原地。所以任何跟账号有关的本地副本都必须只对产生它的那个账号可见。
 *
 * 之前这里没有隔离，于是有一条真实的数据越界通路：
 *   账号 A 登录 → 看板被写进 localStorage → 退出 → 注册账号 B
 *   → B 的服务端看板还是空的 → 客户端用"服务端是空的就拿本地备份"的规则读到了 A 的看板
 *   → 界面显示 A 的数据，紧接着又被写回服务端，A 的数据就永久住进了 B 的账号。
 *
 * 隔离用两把锁：
 *   1. 键按账号分开（`<base>:<accountId>`），别人的备份根本不在查找路径上；
 *   2. 内容里再存一份 `ownerId`，读的时候必须对得上——防止键被手工改过、
 *      或者以后重构时把两份数据写串了。
 *
 * 这些副本都只是**缓存**：事实源是服务端的库（见 electron/boardStorage.js）。
 * 所以宁可读不到（回落到空看板），也绝不猜归属。
 */

const OWNER_FIELD = "ownerId";

function normalizeOwner(accountId) {
  return String(accountId ?? "").trim();
}

/** 备份键。没有归属时返回 baseKey 本身，但读取一律会拒绝这种调用。 */
export function accountStorageKey(baseKey, accountId) {
  const owner = normalizeOwner(accountId);
  return owner ? `${baseKey}:${owner}` : baseKey;
}

/**
 * 读回某个账号自己的备份。
 *
 * 没有归属、读不到、内容坏了、归属对不上——一律返回 null。
 * 这里**不允许**"退回读无归属的那个键"这种兜底：那正是越界的来源。
 */
export function readAccountScoped(storage, baseKey, accountId) {
  const owner = normalizeOwner(accountId);
  if (!owner || !storage?.getItem) return null;
  try {
    const raw = storage.getItem(accountStorageKey(baseKey, owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed[OWNER_FIELD] !== owner) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写入某个账号自己的备份。写不进去（配额满、隐私模式）只返回 false，不抛。 */
export function writeAccountScoped(storage, baseKey, accountId, value, { now = () => new Date().toISOString() } = {}) {
  const owner = normalizeOwner(accountId);
  if (!owner || !storage?.setItem) return false;
  try {
    storage.setItem(
      accountStorageKey(baseKey, owner),
      JSON.stringify({ [OWNER_FIELD]: owner, savedAt: now(), value }),
    );
    return true;
  } catch {
    return false;
  }
}

/** 删掉某个账号自己的备份。 */
export function removeAccountScoped(storage, baseKey, accountId) {
  const owner = normalizeOwner(accountId);
  if (!owner || !storage?.removeItem) return false;
  try {
    storage.removeItem(accountStorageKey(baseKey, owner));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清掉旧版本留下的无归属备份。
 *
 * 老键（`stepview-board-v1` / `stepview-settings-v1`）里没有任何归属信息，
 * 无法判断是谁写的——**不能猜**，猜错就是一次数据越界。它是缓存不是事实源，
 * 所以直接删掉，代价只是损失一份冗余副本。
 *
 * 只在"确实已经登录了一个账号"之后调用：登录前删掉没有意义，而且会误伤
 * 还没进入任何账号的浏览器模式。
 */
export function clearLegacyUnscoped(storage, baseKey) {
  if (!storage?.removeItem) return false;
  try {
    storage.removeItem(baseKey);
    return true;
  } catch {
    return false;
  }
}
