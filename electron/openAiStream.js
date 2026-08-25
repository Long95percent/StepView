const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.1";
const REQUEST_TIMEOUT_MS = 45_000;

function chatCompletionsUrl(baseUrl) {
  return `${String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")}/chat/completions`;
}

export async function streamOpenAIChat({ apiKey, model, baseUrl, messages, onDelta = () => {}, fetchApi = fetch } = {}) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) throw new Error("Missing OpenAI API key.");
  const selectedModel = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const requestUrl = chatCompletionsUrl(baseUrl);
  let response;
  try {
    response = await fetchApi(requestUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${normalizedApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: selectedModel, messages, stream: true }),
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
  let buffer = "";
  let text = "";

  function consume(block) {
    for (const line of block.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const payload = JSON.parse(data);
      const delta = payload.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        text += delta;
        onDelta(delta);
      }
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
  return { text: text.trim() || "OpenAI returned an empty response.", model: selectedModel };
}
