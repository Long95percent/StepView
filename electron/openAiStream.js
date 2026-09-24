const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.1";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TOOL_ROUNDS = 6;

function chatCompletionsUrl(baseUrl) {
  return `${String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")}/chat/completions`;
}

function accumulateToolCalls(toolCalls, deltaToolCalls = []) {
  for (const delta of deltaToolCalls) {
    const index = typeof delta.index === "number" ? delta.index : toolCalls.length;
    if (!toolCalls[index]) toolCalls[index] = { id: "", type: "function", function: { name: "", arguments: "" } };
    const target = toolCalls[index];
    if (delta.id) target.id = delta.id;
    if (delta.function?.name) target.function.name += delta.function.name;
    if (delta.function?.arguments) target.function.arguments += delta.function.arguments;
  }
  return toolCalls;
}

async function streamRound({ normalizedApiKey, requestUrl, selectedModel, messages, tools, onDelta, fetchApi }) {
  let response;
  try {
    response = await fetchApi(requestUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${normalizedApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel, messages, stream: true, ...(tools?.length ? { tools } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const cause = error?.cause;
    const reason = cause?.code || cause?.message || error?.message || "unknown network error";
    const host = new URL(requestUrl).host;
    throw new Error(`无法连接模型服务 ${host}：${reason}`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error?.message || `OpenAI request failed with ${response.status}.`);
  }
  if (!response.body) throw new Error("OpenAI returned an empty stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  const toolCalls = [];
  let buffer = "";
  let text = "";

  function consume(block) {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const payload = JSON.parse(data);
      const delta = payload.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        text += delta.content;
        onDelta(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) accumulateToolCalls(toolCalls, delta.tool_calls);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) consume(block);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);

  return { text, toolCalls: toolCalls.filter(Boolean).filter((call) => call.function.name) };
}

export async function streamOpenAIChat({ apiKey, model, baseUrl, messages, tools, runTool, onDelta = () => {}, fetchApi = fetch, maxToolRounds = MAX_TOOL_ROUNDS } = {}) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) throw new Error("Missing OpenAI API key.");
  const selectedModel = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const requestUrl = chatCompletionsUrl(baseUrl);

  const conversation = [...messages];
  let fullText = "";

  for (let round = 0; round < maxToolRounds; round += 1) {
    const result = await streamRound({ normalizedApiKey, requestUrl, selectedModel, messages: conversation, tools, onDelta, fetchApi });
    fullText += result.text;
    if (!result.toolCalls.length || !runTool) {
      return { text: fullText.trim() || "OpenAI returned an empty response.", model: selectedModel };
    }
    conversation.push({ role: "assistant", content: result.text || null, tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      let toolResult;
      try {
        toolResult = await runTool(call.function.name, JSON.parse(call.function.arguments || "{}"));
      } catch (error) {
        toolResult = { error: error.message };
      }
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
    }
  }

  throw new Error("Agent tool loop exceeded maximum rounds.");
}
