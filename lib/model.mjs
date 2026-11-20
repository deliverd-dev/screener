// The model Screener sends to, chosen from the environment.
//
//   ANTHROPIC_API_KEY             Claude, through Anthropic's Messages API
//   OPENAI_API_KEY (+ OPENAI_BASE_URL)
//                                 OpenAI, or anything that speaks its chat
//                                 completions API: OpenRouter, Ollama, LM Studio
//   neither                       the pretend model, which only repeats back
//                                 what it received, so you can see exactly
//                                 what a real one would have been sent
//
// SCREENER_MODEL picks the model name for either provider.

const SYSTEM =
  "You are a helpful assistant. Some values in the user's message may have been replaced by placeholders " +
  "such as [EMAIL_1] or [IBAN_1] before it reached you. Keep any placeholder exactly as written when you use it, " +
  "and never guess what it stood for.";

export function modelFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  if (env.ANTHROPIC_API_KEY) {
    const name = env.SCREENER_MODEL || "claude-sonnet-5-5";
    return {
      provider: "anthropic",
      name,
      label: `Claude (${name})`,
      async complete(text, { signal } = {}) {
        const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({ model: name, max_tokens: 1024, system: SYSTEM, messages: [{ role: "user", content: text }] }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message ?? `Anthropic answered ${response.status}`);
        return (body?.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("");
      },
    };
  }
  if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL) {
    const base = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const name = env.SCREENER_MODEL || "gpt-5-mini";
    const host = safeHost(base);
    return {
      provider: "openai-compatible",
      name,
      label: host === "api.openai.com" ? `OpenAI (${name})` : `${name} at ${host}`,
      async complete(text, { signal } = {}) {
        const response = await fetchImpl(`${base}/chat/completions`, {
          method: "POST",
          signal,
          headers: {
            "content-type": "application/json",
            ...(env.OPENAI_API_KEY ? { authorization: `Bearer ${env.OPENAI_API_KEY}` } : {}),
          },
          body: JSON.stringify({
            model: name,
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: text },
            ],
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error?.message ?? `${host} answered ${response.status}`);
        return body?.choices?.[0]?.message?.content ?? "";
      },
    };
  }
  return {
    provider: "echo",
    name: "pretend",
    label: "the pretend model",
    async complete(text) {
      return `Pretend model here. No real model is connected, so I just repeat what I received. A real one would have seen exactly this:\n\n${text}`;
    },
  };
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
