import { DIARY_CONTENT_MAX_LENGTH, DIARY_TITLE_MAX_LENGTH, DiaryInputError, normalizeDiaryInput, summarizeDiaryEntry } from "../src/diaryCore.js";

export class DiaryNotFoundError extends Error {
  constructor(message, { diaryId = null } = {}) {
    super(message);
    this.name = "DiaryNotFoundError";
    this.code = "DIARY_NOT_FOUND";
    this.statusCode = 404;
    this.diaryId = diaryId;
  }
}

function withStatus(statusCode, error) {
  error.statusCode = statusCode;
  return error;
}

function normalize(input) {
  try {
    return normalizeDiaryInput(input);
  } catch (error) {
    if (error instanceof DiaryInputError) throw withStatus(400, error);
    throw error;
  }
}

function noteTimestamp(node, task, fallback) {
  for (const candidate of [node?.timestamp, node?.updatedAt, task?.createdAt, task?.updatedAt]) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback.toISOString();
}

/**
 * 日记业务层。
 *
 * 只做三件事：校验输入、保证账号隔离、把仓储的原始能力组装成上层要用的动作。
 * 表结构、事务、检索细节都在仓储里，这里不写 SQL。
 */
export function createDiaryService({ repository, accountId, now = () => new Date() } = {}) {
  if (!repository) throw new Error("Diary service requires a diary repository.");
  if (!accountId) throw new Error("Diary service requires an accountId.");

  function requireEntry(diaryId, entry) {
    if (!entry) throw new DiaryNotFoundError("这条日记不存在或不属于当前账号。", { diaryId });
    return entry;
  }

  function create(input) {
    return repository.create(normalize({ ...input, source: input?.source ?? "manual" }), { now: now() });
  }

  /**
   * 把"只带一部分字段的修改"补成一份完整内容：没给的字段沿用原值。
   *
   * 更新和"生成待确认提案"都要做这一步，放一起保证两边算出来的结果一模一样。
   */
  function mergeEntry(diaryId, input = {}) {
    const current = requireEntry(diaryId, repository.get(diaryId));
    const merged = normalize({
      // kind 必须一起带上：漏了它，编辑一条节点日记会把它静默降级成每日日记，
      // 于是这条日记从节点的"原生日记"里消失——正是这一版要防的那类静默数据损坏。
      kind: input.kind ?? current.kind,
      title: input.title ?? current.title,
      content: input.content ?? current.content,
      occurredAt: input.occurredAt ?? current.occurredAt,
      timezone: input.timezone ?? current.timezone,
      status: input.status ?? current.status,
      source: input.source ?? current.source,
      tags: input.tags ?? current.tags,
      links: input.links ?? repository.listLinks(diaryId),
    });
    return { current, merged };
  }

  /**
   * 更新一条日记。
   *
   * input 可以是完整内容，也可以只带要改的字段（例如只改标题）；没给的字段沿用原值。
   * input.rev 是乐观锁：交回读到的版本号，版本对不上会报冲突而不是盖掉别人的修改。
   */
  function update(diaryId, input = {}, { expectedRev = input?.rev, reason = "update" } = {}) {
    const { current, merged } = mergeEntry(diaryId, input);
    return requireEntry(diaryId, repository.update(diaryId, merged, { expectedRev: expectedRev ?? current.rev, reason, now: now() }));
  }

  function entryLabel(entry) {
    return entry.title || summarizeDiaryEntry(entry, { length: 20 }) || "（空）";
  }

  function changeLines(current, next) {
    const lines = [];
    if (current.kind !== next.kind) lines.push(`类型：${current.kind} → ${next.kind}`);
    if (current.title !== next.title) lines.push(`标题「${current.title || "（空）"}」→「${next.title || "（空）"}」`);
    if (current.content !== next.content) {
      lines.push(`正文：${summarizeDiaryEntry(current, { length: 40 }) || "（空）"} → ${summarizeDiaryEntry(next, { length: 40 }) || "（空）"}`);
    }
    const currentTags = current.tags.join("、");
    const nextTags = next.tags.join("、");
    if (currentTags !== nextTags) lines.push(`标签：${currentTags || "（无）"} → ${nextTags || "（无）"}`);
    if (current.occurredDay !== next.occurredDay) lines.push(`日期：${current.occurredDay} → ${next.occurredDay}`);
    return lines;
  }

  /**
   * 生成一条"待确认的日记变更"，**不写任何东西**。
   *
   * Agent 想替用户写日记时只能走到这里：提案先进统一审批队列，用户点了确认才落库。
   * 这样"改用户数据"永远发生在用户眼皮底下。
   */
  function planChange(input = {}, { operation } = {}) {
    const op = String(operation || input.operation || "create").trim();
    const reason = String(input.reason ?? "").trim().slice(0, 500);

    if (op === "create") {
      const entry = normalize({ ...input, source: input.source ?? "agent" });
      return {
        type: "diary_change",
        operation: "diary.create",
        summary: `新增日记「${entryLabel(entry)}」`,
        reason,
        entry,
        diff: { lines: [`新增日记「${entryLabel(entry)}」`, `日期：${entry.occurredDay}`] },
      };
    }

    if (op === "update") {
      const { current, merged } = mergeEntry(input.diaryId, input);
      const lines = changeLines(current, merged);
      if (lines.length === 0) throw withStatus(400, new DiaryInputError("这次修改没有任何变化。", { field: "content" }));
      return {
        type: "diary_change",
        operation: "diary.update",
        diaryId: current.diaryId,
        rev: current.rev,
        summary: `修改日记「${entryLabel(current)}」`,
        reason,
        entry: merged,
        diff: { lines },
      };
    }

    throw withStatus(400, new DiaryInputError(`不支持的日记操作：${op || "(空)"}`, { field: "operation" }));
  }

  /** 用户批准之后才真正落库。update 会带上提案当时的 rev，别人抢先改过就报冲突。 */
  function applyChange(proposal = {}) {
    if (proposal.type !== "diary_change") throw withStatus(400, new DiaryInputError("这不是一条日记变更提案。", { field: "type" }));
    if (proposal.operation === "diary.update") {
      return update(proposal.diaryId, proposal.entry ?? {}, { expectedRev: proposal.rev, reason: "approval" });
    }
    if (proposal.operation === "diary.create") {
      const entry = normalize({ ...(proposal.entry ?? {}), source: proposal.entry?.source ?? "agent" });
      return repository.create(entry, { reason: "approval", now: now() });
    }
    throw withStatus(400, new DiaryInputError(`不支持的日记操作：${proposal.operation || "(空)"}`, { field: "operation" }));
  }

  /** 详情：连关联一起返回。列表也会带关联，但那是批量查的，不是逐条查。 */
  function get(diaryId) {
    const entry = requireEntry(diaryId, repository.get(diaryId));
    return { ...entry, links: repository.listLinks(diaryId) };
  }

  function list(filter = {}) {
    return repository.list(filter);
  }

  function search(options = {}) {
    return repository.search(options);
  }

  function timeline(options = {}) {
    return repository.timeline(options);
  }

  function listTags() {
    return repository.listTags();
  }

  /** 挂在某个画布节点/支线/任务上的日记。默认和 list 一样只看 active，需要连回收站一起看时显式传 status。 */
  function listForTarget(options = {}) {
    return repository.list({ ...options, status: options.status ?? "active" });
  }

  /**
   * 某个节点上的**原生日记**：节点日记，且必须挂在这个节点上。
   *
   * 就是界面上节点展开后上半段那一列表。
   */
  function listNodeEntries(nodeId, options = {}) {
    return repository.list({
      ...options,
      status: options.status ?? "active",
      kind: "node",
      targetType: "node",
      targetId: nodeId,
    });
  }

  /**
   * 某个节点关联到的**每日日记**，按天去重，返回 [{ day, count }]（倒序）。
   *
   * 就是节点上那排"标有日期的按钮"的数据源：一天有多条时靠 count 显示角标。
   */
  function listDailyDaysForNode(nodeId, options = {}) {
    return repository.listDailyDaysForTarget({ ...options, targetType: "node", targetId: nodeId });
  }

  function listRevisions(diaryId, options = {}) {
    requireEntry(diaryId, repository.get(diaryId));
    return repository.listRevisions(diaryId, options);
  }

  /**
   * 画布上的节点被删掉时调用：**不删**日记，也不删关联，只把关联标成"原节点已删除"。
   *
   * 日记是用户写下来的东西，不能因为他在画布上整理结构就跟着消失；
   * 界面靠这个标记提示"原节点已删除"，而不是假装关联还在。
   * 删除路径统一走 boardStorage 的写入口，所以删节点、删任务、清空看板都会走到这里。
   */
  function markNodesOrphaned(nodeIds = [], { now: nowValue = now() } = {}) {
    let changed = 0;
    for (const nodeId of nodeIds) {
      if (!nodeId) continue;
      changed += repository.markLinksOrphaned({ targetType: "node", targetId: String(nodeId), now: nowValue });
    }
    return changed;
  }

  function trash(diaryId) {
    requireEntry(diaryId, repository.get(diaryId));
    return requireEntry(diaryId, repository.setStatus(diaryId, "trashed", { now: now() }));
  }

  function restore(diaryId) {
    requireEntry(diaryId, repository.get(diaryId));
    return requireEntry(diaryId, repository.setStatus(diaryId, "active", { now: now() }));
  }

  function remove(diaryId) {
    if (!repository.remove(diaryId)) throw new DiaryNotFoundError("这条日记不存在或不属于当前账号。", { diaryId });
    return { ok: true, diaryId };
  }

  /** 画布上有备注文字的节点——它们是"导入成日记"的候选。 */
  function collectNodeNotes(board) {
    const tasks = Array.isArray(board?.tasks) ? board.tasks : [];
    const collected = [];
    for (const task of tasks) {
      for (const node of Array.isArray(task?.nodes) ? task.nodes : []) {
        const content = String(node?.detail ?? "").trim();
        // 没有 id 的节点导不了：关联要指向真实节点，不能凭空造一个 "undefined"。
        if (!content || !node?.id) continue;
        collected.push({
          nodeId: String(node.id),
          taskId: task?.id ? String(task.id) : null,
          nodeTitle: String(node?.title ?? "").trim(),
          taskTitle: String(task?.title ?? "").trim(),
          content: content.slice(0, DIARY_CONTENT_MAX_LENGTH),
          timestamp: noteTimestamp(node, task, now()),
        });
      }
    }
    return collected;
  }

  /**
   * 预览"把节点备注导成日记"。
   *
   * 只读画布、不写任何东西。已经导入过的节点标记出来，让用户知道哪些会被跳过。
   */
  function previewNodeNoteImport(board) {
    const imported = new Set(repository.listImportedNodeIds());
    return collectNodeNotes(board).map((note) => ({
      nodeId: note.nodeId,
      taskId: note.taskId,
      title: (note.nodeTitle || note.taskTitle).slice(0, DIARY_TITLE_MAX_LENGTH),
      content: note.content,
      occurredAt: note.timestamp,
      alreadyImported: imported.has(note.nodeId),
    }));
  }

  /**
   * 把节点备注导成日记条目。
   *
   * 三条硬规则：
   *   1. 必须显式 confirm，否则只回一份预览。
   *   2. 只读画布、只往日记里写，**节点原文一个字都不动**。
   *   3. 幂等：一个节点只导一次。条目后来被改、被归档、被删掉，都不会再导一遍。
   */
  function importNodeNotes(board, { confirm = false, timezone = "UTC" } = {}) {
    const preview = previewNodeNoteImport(board);
    const pending = preview.filter((item) => !item.alreadyImported);
    const skipped = preview.length - pending.length;
    if (!confirm) return { confirmed: false, total: preview.length, created: 0, skipped, pending: pending.length, items: pending };

    let created = 0;
    const importedNodeIds = [];
    for (const item of pending) {
      repository.create(
        normalize({
          title: item.title,
          content: item.content,
          occurredAt: item.occurredAt,
          timezone,
          source: "node-note-import",
          // 导入出来的就是节点日记。必须和 0009 迁移的回填口径一致，
          // 否则"历史导入的是节点日记、新导入的却是每日日记"会当场自相矛盾。
          kind: "node",
          links: [{ targetType: "node", targetId: item.nodeId, taskId: item.taskId, role: "primary", createdBy: "user" }],
        }),
        { reason: "import-node-note", now: now() },
      );
      importedNodeIds.push(item.nodeId);
      created += 1;
    }
    // 标记和条目写在同一个调用里：用户之后删掉条目，这个节点也不会被重新导入。
    if (importedNodeIds.length > 0) repository.markNodeNotesImported(importedNodeIds);
    return { confirmed: true, total: preview.length, created, skipped, pending: 0 };
  }

  return {
    create,
    update,
    planChange,
    applyChange,
    get,
    list,
    search,
    timeline,
    listTags,
    listForTarget,
    listNodeEntries,
    listDailyDaysForNode,
    listRevisions,
    markNodesOrphaned,
    trash,
    restore,
    remove,
    previewNodeNoteImport,
    importNodeNotes,
  };
}
