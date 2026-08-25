import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFamilyHttpServer } from "../electron/gateway/familyHttpServer.js";
import { createAccountContext } from "../electron/gateway/accountContext.js";
import { buildTask } from "../src/progressCore.js";

describe("family HTTP gateway", () => {
  let tempDir;
  let gateway;

  afterEach(async () => {
    await gateway?.close();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("authenticates browser sessions and isolates concurrent account boards", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stepview-family-http-"));
    gateway = createFamilyHttpServer({
      config: { mode: "family", bindHost: "127.0.0.1", httpPort: 0, allowRegistration: true, sessionTtlHours: 1 },
      dataDir: tempDir,
      accountContextFactory: (options) => createAccountContext({
        ...options,
        redisCacheFactory: () => ({
          savePromptState: async () => {},
          saveWindowState: async () => {},
          loadPromptState: async () => null,
          loadWindowState: async () => null,
          close: async () => {},
        }),
      }),
      openAiStream: async ({ onDelta }) => {
        onDelta("你好");
        onDelta("，一起继续。");
        return { text: "你好，一起继续。", model: "test-model" };
      },
    });
    const address = await gateway.listen();
    const baseUrl = `http://127.0.0.1:${address.port}/api`;

    async function register(username) {
      const response = await fetch(`${baseUrl}/accounts/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: "password-1" }),
      });
      expect(response.status).toBe(201);
      return response.json();
    }

    const alice = await register("alice");
    const bob = await register("bob");
    const aliceHeaders = { Authorization: `Bearer ${alice.sessionId}`, "Content-Type": "application/json" };
    const bobHeaders = { Authorization: `Bearer ${bob.sessionId}`, "Content-Type": "application/json" };

    await fetch(`${baseUrl}/board`, { method: "PUT", headers: aliceHeaders, body: JSON.stringify({ tasks: [{ id: "alice-task" }] }) });
    await fetch(`${baseUrl}/board`, { method: "PUT", headers: bobHeaders, body: JSON.stringify({ tasks: [{ id: "bob-task" }] }) });

    await expect(fetch(`${baseUrl}/board`, { headers: aliceHeaders }).then((response) => response.json())).resolves.toMatchObject({ tasks: [{ id: "alice-task" }] });
    await expect(fetch(`${baseUrl}/board`, { headers: bobHeaders }).then((response) => response.json())).resolves.toMatchObject({ tasks: [{ id: "bob-task" }] });
    expect((await fetch(`${baseUrl}/board`)).status).toBe(401);

    const task = buildTask("家庭计划", { x: 500, y: 300 });
    await fetch(`${baseUrl}/board`, { method: "PUT", headers: aliceHeaders, body: JSON.stringify({ tasks: [task] }) });
    const streamResponse = await fetch(`${baseUrl}/agent/chat/stream`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ sessionId: `task:${task.id}`, userText: "下一步做什么？", apiKey: "test-key" }),
    });
    const events = await streamResponse.text();
    expect(streamResponse.status, events).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    expect(events).toContain('"type":"delta","delta":"你好"');
    expect(events).toContain('"type":"complete"');
    expect(events).toContain('"text":"你好，一起继续。"');
  });
});
