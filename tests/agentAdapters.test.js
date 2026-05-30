import { describe, expect, it } from "vitest";
import { createMem0Client } from "../electron/agentMem0Client.js";
import { encodeRedisCommand, parseRedisReply } from "../electron/agentRedisClient.js";

describe("agent redis adapter helpers", () => {
  it("encodes commands as RESP arrays and parses common replies", () => {
    expect(encodeRedisCommand(["HSET", "key", "json", "{\"ok\":true}"]).toString()).toBe(
      "*4\r\n$4\r\nHSET\r\n$3\r\nkey\r\n$4\r\njson\r\n$11\r\n{\"ok\":true}\r\n",
    );

    expect(parseRedisReply(Buffer.from("+OK\r\n"))).toEqual({ value: "OK", next: 5 });
    expect(parseRedisReply(Buffer.from(":12\r\n"))).toEqual({ value: 12, next: 5 });
    expect(parseRedisReply(Buffer.from("$6\r\n你好\r\n"))).toEqual({ value: "你好", next: 12 });
    expect(parseRedisReply(Buffer.from("*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n"))).toEqual({
      value: ["foo", "bar"],
      next: 22,
    });
  });
});

describe("agent mem0 adapter", () => {
  it("posts session-scoped memories with metadata", async () => {
    const calls = [];
    const client = createMem0Client({
      apiKey: "mem0-key",
      baseUrl: "https://mem0.example/v1/",
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({ id: "mem-1" }),
        };
      },
    });

    const result = await client.addMessages({
      sessionId: "task:task-1",
      taskLineId: "task-1",
      turnId: "turn-1",
      messages: [
        { role: "user", content: "我喜欢低压力推进" },
        { role: "assistant", content: "我会给你一个很小的下一步。" },
      ],
      metadata: { category: "working_style" },
    });

    expect(result).toEqual({ id: "mem-1" });
    expect(calls[0].url).toBe("https://mem0.example/v1/memories");
    expect(calls[0].options.headers.Authorization).toBe("Token mem0-key");
    expect(JSON.parse(calls[0].options.body)).toMatchObject({
      run_id: "task:task-1",
      metadata: {
        sessionId: "task:task-1",
        taskLineId: "task-1",
        turnId: "turn-1",
        category: "working_style",
      },
    });
  });

  it("returns an empty result without calling Mem0 when api key is missing", async () => {
    let called = false;
    const client = createMem0Client({
      apiKey: "",
      fetchImpl: async () => {
        called = true;
      },
    });

    await expect(client.searchMemories({ sessionId: "task:task-1", taskLineId: "task-1", query: "x" })).resolves.toEqual([]);
    await expect(client.addMessages({ sessionId: "task:task-1", taskLineId: "task-1", messages: [] })).resolves.toEqual({
      skipped: true,
      reason: "missing-api-key",
    });
    expect(called).toBe(false);
  });
});

