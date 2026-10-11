/**
 * Minimal client for a Luminal-hosted, OpenAI-compatible chat-completions API
 * (DeepSeek / GLM Flash). Used ONLY server-side (in /api/text) so the API key
 * never reaches the browser.
 *
 * Base URL and model come from env vars, so pointing at a different endpoint is
 * a config change, not a code change.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function config() {
  return {
    apiKey: process.env.LUMINAL_API_KEY,
    baseUrl: process.env.LUMINAL_BASE_URL ?? "https://api.luminal.ai/v1",
    model: process.env.LUMINAL_MODEL ?? "deepseek-chat",
  };
}

export function isLuminalConfigured(): boolean {
  return Boolean(process.env.LUMINAL_API_KEY);
}

/**
 * Call the chat-completions endpoint and return the assistant text.
 * Throws on missing key, HTTP error, timeout, or empty content.
 */
export async function luminalChat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const cfg = config();
  if (!cfg.apiKey) throw new Error("LUMINAL_API_KEY is not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 200,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Luminal API ${res.status}: ${detail.slice(0, 160)}`);
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Luminal API returned no content");
    return content;
  } finally {
    clearTimeout(timer);
  }
}
