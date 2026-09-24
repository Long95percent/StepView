/**
 * 日记界面的共用纯函数。
 *
 * 没有 React、没有 DOM、没有网络。分组、排序、日期文案这些最容易出错、
 * 又最难靠肉眼在界面上发现的地方放在这里，用单元测试钉住。
 */

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
/** 没有可用日期的条目归到这里，永远排在最后。 */
export const UNKNOWN_DAY = "未知日期";

/** "YYYY-MM-DD" 是不是一个合法的日期键。 */
export function isDayKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

/**
 * 一天内的排序：晚写的在上面。
 *
 * occurredAt 相同时用 id 兜底——同一天写多条很常见，没有兜底的话每次刷新
 * 顺序都可能变，用户会以为日记被调换了。
 */
export function sortEntriesNewestFirst(entries = []) {
  return [...entries].sort((left, right) => {
    const byTime = String(right?.occurredAt ?? "").localeCompare(String(left?.occurredAt ?? ""));
    if (byTime !== 0) return byTime;
    return String(right?.diaryId ?? "").localeCompare(String(left?.diaryId ?? ""));
  });
}

/**
 * 按天分组，天的顺序也是倒序（最近的在前）。
 *
 * 同一天**不做合并**：一天写多条是正常用法，合并会让人以为日记被吞了。
 * 分组只负责摆位置，条目本身原样返回。
 */
export function groupEntriesByDay(entries = []) {
  const buckets = new Map();
  for (const entry of entries) {
    const day = isDayKey(entry?.occurredDay) ? entry.occurredDay : UNKNOWN_DAY;
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day).push(entry);
  }
  return [...buckets.entries()]
    .map(([day, items]) => ({ day, count: items.length, entries: sortEntriesNewestFirst(items) }))
    .sort((left, right) => {
      // 没有日期的条目固定排最后。不能只按字符串倒序：中文的码位比数字大，
      // 那样"未知日期"会顶到列表最上面，看起来像是重要内容。
      if (left.day === UNKNOWN_DAY) return 1;
      if (right.day === UNKNOWN_DAY) return -1;
      return String(right.day).localeCompare(String(left.day));
    });
}

/** 某个瞬间在指定时区属于哪一天。 */
function dayKeyInZone(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** 日期键往前一天。按日历减，不按 24 小时减——夏令时那天按 24 小时减会算错。 */
function previousDayKey(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  const pad = (value) => String(value).padStart(2, "0");
  return `${previous.getUTCFullYear()}-${pad(previous.getUTCMonth() + 1)}-${pad(previous.getUTCDate())}`;
}

/**
 * 日期标题：今天 / 昨天 / 2026年9月19日 星期六。
 *
 * "今天"必须按用户时区算：晚上 11 点写的日记在 UTC 下会算成第二天，标题就错位了。
 * now 与 timezone 都可注入，所以能直接单测。
 */
export function formatDayHeading(day, { now = new Date(), timezone = "UTC" } = {}) {
  if (!isDayKey(day)) return String(day ?? "");
  const today = dayKeyInZone(now, timezone);
  if (day === today) return "今天";
  if (day === previousDayKey(today)) return "昨天";

  const [year, month, date] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  return `${year}年${month}月${date}日 星期${weekday}`;
}

/** 列表里那一行的时间，只到分钟。 */
export function formatEntryTime(occurredAt) {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * 从画布收集"可以关联的节点"，喂给编辑器里的节点多选。
 *
 * 没有 id 的节点要跳过：关联要指向真实的节点，不能凭空造一个 "undefined"。
 */
export function collectNodeOptions(board) {
  const options = [];
  for (const task of board?.tasks ?? []) {
    for (const node of task?.nodes ?? []) {
      if (!node?.id) continue;
      const label = [task?.title, node?.title].filter(Boolean).join(" · ");
      options.push({ id: String(node.id), label: label || String(node.id) });
    }
  }
  return options;
}

/** 标签之外还要能按关联节点筛选，这里给出节点的显示名。 */
export function nodeLabelById(nodeOptions = []) {
  return new Map(nodeOptions.map((option) => [option.id, option.label]));
}
