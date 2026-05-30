import { describe, expect, it } from "vitest";
import { buildAgentTurn, markAgentTurnFallback, markAgentTurnOpenAI } from "../src/agentTurn";

describe("agent turn helpers", () => {
  it("builds a turn with the expected renderer-safe fields", () => {
    const turn = buildAgentTurn({
      id: "turn-1",
      question: "怎么看这条线？",
      scopeId: "task:task-1",
      localResponse: {
        answer: "这条线还在推进中。",
        route: { type: "task_line", taskLineId: "task-1" },
      },
      createdAt: "2026-05-30T11:00:00.000Z",
    });

    expect(turn).toEqual({
      id: "turn-1",
      userText: "怎么看这条线？",
      assistantText: "这条线还在推进中。",
      scopeId: "task:task-1",
      route: { type: "task_line", taskLineId: "task-1" },
      source: "local",
      createdAt: "2026-05-30T11:00:00.000Z",
    });
  });

  it("updates only the same turn after OpenAI succeeds", () => {
    const turn = buildAgentTurn({
      id: "turn-1",
      question: "做一次增强回答",
      scopeId: "global",
      localResponse: {
        answer: "本地回答",
        route: { type: "global" },
      },
      createdAt: "2026-05-30T11:00:00.000Z",
    });

    const updated = markAgentTurnOpenAI(turn, { text: "增强回答", model: "gpt-5.1" });

    expect(updated).toEqual({
      ...turn,
      assistantText: "增强回答",
      source: "openai",
      model: "gpt-5.1",
    });
  });

  it("marks the same turn as local fallback without changing other fields", () => {
    const turn = buildAgentTurn({
      id: "turn-1",
      question: "增强失败怎么办",
      scopeId: "global",
      localResponse: {
        answer: "本地回答",
        route: { type: "global" },
      },
      createdAt: "2026-05-30T11:00:00.000Z",
    });

    const fallback = markAgentTurnFallback(turn);

    expect(fallback).toEqual({
      ...turn,
      source: "local-fallback",
    });
  });
});
