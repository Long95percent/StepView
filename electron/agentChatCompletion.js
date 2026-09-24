const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-5.1";
const MAX_TOOL_ROUNDS = 6;

function chatCompletionsUrl(baseUrl) {
  return `${String(baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "")}/chat/completions`;
}

export function missingApiKeyError() {
  return new Error("Missing OpenAI API key.");
}

export async function completeChatWithTools({ apiKey, model, baseUrl, messages, tools, runTool, fetchApi = fetch, maxToolRounds = MAX_TOOL_ROUNDS } = {}) {
  const normalizedApiKey = String(apiKey || "").trim();
  if (!normalizedApiKey) throw missingApiKeyError();
  const selectedModel = String(model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const requestUrl = chatCompletionsUrl(baseUrl);

  const conversation = [...messages];
  for (let round = 0; round < maxToolRounds; round += 1) {
    const response = await fetchApi(requestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${normalizedApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: selectedModel, messages: conversation, ...(tools?.length ? { tools } : {}) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI request failed with ${response.status}.`);

    const message = payload.choices?.[0]?.message || {};
    if (!message.tool_calls?.length || !runTool) {
      return { text: message.content?.trim() || "OpenAI returned an empty response.", model: selectedModel };
    }
    conversation.push(message);
    for (const call of message.tool_calls) {
      let result;
      try {
        result = await runTool(call.function.name, JSON.parse(call.function.arguments || "{}"));
      } catch (error) {
        result = { error: error.message };
      }
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  throw new Error("Agent tool loop exceeded maximum rounds.");
}
