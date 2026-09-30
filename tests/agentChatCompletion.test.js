import { describe, expect, it, vi } from "vitest";
import { completeChatWithTools } from "../electron/agentChatCompletion.js";

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("tool-aware chat completion", () => {
  it("returns the assistant text when the model calls no tools", async () => {
    const fetchApi = vi.fn().mockResolvedValue(jsonResponse({ choices: [{ message: { content: "  你好  " } }] }));
    const result = await completeChatWithTools({ apiKey: "k", messages: [{ role: "user", content: "hi" }], fetchApi });
    expect(result).toEqual({ text: "你好", model: "gpt-5.1" });
    const body = JSON.parse(fetchApi.mock.calls[0][1].body);
    expect(body.tools).toBeUndefined();
    expect(body.stream).toBeUndefined();
  });

  it("runs tool calls and feeds results back before answering", async () => {
    const fetchApi = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "", tool_calls: [{ id: "call-1", function: { name: "board.propose_change", arguments: '{"operation":"sticker.add","emoji":"🌱"}' } }] } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "已经准备好修改。" } }] }));
    const runTool = vi.fn(async () => ({ type: "board_change", proposalId: "proposal-1" }));

    const result = await completeChatWithTools({ apiKey: "k", messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "board.propose_change" } }], runTool, fetchApi });

    expect(runTool).toHaveBeenCalledWith("board.propose_change", { operation: "sticker.add", emoji: "🌱" });
    expect(result.text).toBe("已经准备好修改。");
    const secondBody = JSON.parse(fetchApi.mock.calls[1][1].body);
    expect(secondBody.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call-1" });
  });

  it("turns tool failures into a tool result instead of aborting the turn", async () => {
    const fetchApi = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { tool_calls: [{ id: "call-1", function: { name: "board.propose_change", arguments: "{}" } }] } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "失败了。" } }] }));
    const runTool = vi.fn(async () => { throw new Error("Unknown task: x"); });

    const result = await completeChatWithTools({ apiKey: "k", messages: [], tools: [{}], runTool, fetchApi });
    expect(result.text).toBe("失败了。");
    expect(JSON.parse(JSON.parse(fetchApi.mock.calls[1][1].body).messages.at(-1).content)).toEqual({ error: "Unknown task: x" });
  });

  it("rejects a missing api key and surfaces provider errors", async () => {
    await expect(completeChatWithTools({ apiKey: "  ", messages: [] })).rejects.toThrow("Missing OpenAI API key.");
    const fetchApi = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 }));
    await expect(completeChatWithTools({ apiKey: "k", messages: [], fetchApi })).rejects.toThrow("quota exceeded");
  });

  it("stops after the maximum number of tool rounds", async () => {
    const fetchApi = vi.fn().mockImplementation(async () => jsonResponse({ choices: [{ message: { tool_calls: [{ id: "c", function: { name: "board.search", arguments: "{}" } }] } }] }));
    await expect(completeChatWithTools({ apiKey: "k", messages: [], tools: [{}], runTool: async () => ({}), fetchApi, maxToolRounds: 2 })).rejects.toThrow("exceeded maximum rounds");
    expect(fetchApi).toHaveBeenCalledTimes(2);
  });
});
