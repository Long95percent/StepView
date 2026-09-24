import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAccountDatabase } from "../electron/db/index.js";
import { createApprovalRepository } from "../electron/db/repositories/approvalRepository.js";
import { createDiaryRepository } from "../electron/db/repositories/diaryRepository.js";
import { createDiaryService } from "../electron/diaryService.js";
import { createApprovalManager } from "../electron/agent/approvalManager.js";
import { createApprovalService } from "../electron/agent/approvalService.js";
import { createToolRegistry } from "../electron/agent/toolRegistry.js";
import { createToolRuntime } from "../electron/agent/toolRuntime.js";
import { createToolContext } from "../electron/agent/toolBridge.js";
import { registerBuiltInTools } from "../electron/agent/builtInTools.js";

const NOW = new Date("2026-09-24T10:00:00.000Z");

describe("diary approvals", () => {
  let tempDir;
  let database;
  let diaryService;
  let approvalManager;
  let approvalService;
  let toolRuntime;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-diary-approval-"));
    database = openAccountDatabase({ dataDir: tempDir });
    diaryService = createDiaryService({
      repository: createDiaryRepository({ connection: database, accountId: "account-a" }),
      accountId: "account-a",
      now: () => NOW,
    });
    approvalManager = createApprovalManager({ repository: createApprovalRepository({ connection: database }), now: () => NOW.toISOString() });
    approvalService = createApprovalService({ approvalManager, diaryService });

    const registry = createToolRegistry();
    registerBuiltInTools({ registry });
    toolRuntime = createToolRuntime({ registry });
  });

  afterEach(async () => {
    database?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  function toolContext() {
    return createToolContext({ accountId: "account-a", diaryService, approvalManager }, "task:session-1");
  }

  it("stages an agent diary entry for review instead of writing it", async () => {
    const { result } = await toolRuntime.run(
      "diary.propose_entry",
      { content: "今天聊到了数据库重构", title: "和 Agent 的对话", tags: ["重构"], nodeIds: ["node-1"], reason: "这条记录之后要回看" },
      toolContext(),
    );

    expect(result).toMatchObject({ type: "diary_change", operation: "diary.create", requiresApproval: true });
    expect(result.entry).toMatchObject({ title: "和 Agent 的对话", source: "agent" });
    expect(diaryService.list({ status: "all" })).toHaveLength(0);

    const pending = await approvalService.list("account-a");
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: "diary_change", status: "pending", operation: "diary.create", reason: "这条记录之后要回看", summary: "新增日记「和 Agent 的对话」" });
    expect(pending[0].diff.lines.length).toBeGreaterThan(0);
  });

  it("writes the entry only after the user approves it", async () => {
    const { result } = await toolRuntime.run("diary.propose_entry", { content: "批准之后才落库" }, toolContext());

    const decided = await approvalService.decide(result.approvalId, "account-a", "approved");
    expect(decided.approval).toMatchObject({ type: "diary_change", status: "approved" });
    expect(decided.appliedDiary).toMatchObject({ content: "批准之后才落库", source: "agent" });

    const entries = diaryService.list({ status: "all" });
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("");
  });

  it("drops the entry when the user rejects it", async () => {
    const { result } = await toolRuntime.run("diary.propose_entry", { title: "不要这条" }, toolContext());

    const decided = await approvalService.decide(result.approvalId, "account-a", "rejected");
    expect(decided.approval.status).toBe("rejected");
    expect(diaryService.list({ status: "all" })).toHaveLength(0);
  });

  it("applies an approved edit and refuses one that a newer revision already replaced", async () => {
    const existing = diaryService.create({ content: "原始正文" });
    const { result } = await toolRuntime.run(
      "diary.propose_entry",
      { operation: "update", diaryId: existing.diaryId, content: "Agent 想改成的正文", reason: "补充细节" },
      toolContext(),
    );
    expect(result).toMatchObject({ operation: "diary.update", rev: 1, diaryId: existing.diaryId });

    const applied = await approvalService.decide(result.approvalId, "account-a", "approved");
    expect(applied.appliedDiary).toMatchObject({ rev: 2, content: "Agent 想改成的正文" });

    // 用户先在界面上改过这条日记，再批准一个基于旧版本的提案：必须报冲突，且提案状态不能变成已批准。
    const { result: stale } = await toolRuntime.run(
      "diary.propose_entry",
      { operation: "update", diaryId: existing.diaryId, content: "基于旧版本的修改" },
      toolContext(),
    );
    diaryService.update(existing.diaryId, { content: "用户自己的修改" }, { expectedRev: 2 });

    await expect(approvalService.decide(stale.approvalId, "account-a", "approved")).rejects.toThrowError(
      expect.objectContaining({ code: "DIARY_REVISION_CONFLICT" }),
    );
    expect(approvalManager.find(stale.approvalId, "account-a")).toMatchObject({ status: "pending" });
    expect(diaryService.get(existing.diaryId)).toMatchObject({ content: "用户自己的修改" });
  });

  it("keeps a propose tool from being reachable without the diary service", async () => {
    await expect(toolRuntime.run("diary.propose_entry", { content: "没有服务层" }, { accountId: "account-a" })).rejects.toThrowError(
      /missing required context/,
    );
  });
});
