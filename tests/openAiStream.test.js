import { describe, expect, it, vi } from "vitest";
import { streamOpenAIChat } from "../electron/openAiStream.js";

describe("OpenAI stream parser", () => {
  it("emits deltas across arbitrary response chunks", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n' + 'data: {"choices":[{"delta":{"content":"好'));
        controller.enqueue(encoder.encode('！"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const onDelta = vi.fn();
    const result = await streamOpenAIChat({
      apiKey: "test-key",
      messages: [],
      onDelta,
      fetchApi: vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    });
    expect(onDelta.mock.calls.flat()).toEqual(["你", "好！"]);
    expect(result.text).toBe("你好！");
  });

  it("reports the target host and underlying fetch failure", async () => {
    const failure = new TypeError("fetch failed", { cause: Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }) });
    await expect(streamOpenAIChat({
      apiKey: "test-key",
      baseUrl: "https://relay.example/v1",
      messages: [],
      fetchApi: async () => { throw failure; },
    })).rejects.toThrow("无法连接模型服务 relay.example：ECONNREFUSED");
  });
});
