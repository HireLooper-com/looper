import Anthropic from "@anthropic-ai/sdk";
import { sql } from "./db";
import { decrypt } from "./crypto";
import { chat, fallbackParams, type ModelConfig } from "./llm";
import { urlsIn } from "./spec";

// GEO readings: ask each buyer question the way a buyer would, in the AI answer
// engines buyers use, with web search on, and count the answers that name the site.
// Every engine runs on the founder's own keys: their main model key, plus one optional
// OpenRouter key saved in Settings (engine_keys, engine "openrouter") that asks ChatGPT,
// Perplexity and Google AI through one API.
// Each answer comes back with the URLs the engine cited: the pages a buyer is sent to instead.

export const OPENROUTER = "openrouter";
// search: OpenRouter's web plugin; Perplexity searches on its own.
export const ENGINES = [
  { name: "ChatGPT", model: "openai/gpt-5", search: true },
  { name: "Perplexity", model: "perplexity/sonar", search: false },
  { name: "Google AI", model: "google/gemini-2.5-flash", search: true },
] as const;

export type Answer = { text: string; urls: string[] };
const none: Answer = { text: "", urls: [] };
/** The engine's citations, then any URL written in the text, at most 12. */
const answer = (text: string, cited: string[]): Answer => ({ text, urls: [...new Set([...cited, ...urlsIn(text)])].slice(0, 12) });

const SYSTEM = "Answer the way an AI assistant answers a buyer: search the web, then name the specific products, companies or sites you would recommend.";

// The dynamic-filtering web search variant runs on current Claude models; older ones take the basic one.
const searchTool = (model: string) =>
  /^claude-(opus-(5|4-[678])|sonnet-(5|4-6)|fable-5)/.test(model) ? "web_search_20260209" : "web_search_20250305";

async function askClaude(cfg: ModelConfig, q: string) {
  const client = new Anthropic({ apiKey: cfg.key, maxRetries: 2, timeout: 120_000 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: q }];
  // Server tools can pause a long turn; send the turn back to let it finish, at most 3 times.
  for (let i = 0; i < 4; i++) {
    const res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      tools: [{ type: searchTool(cfg.model), name: "web_search", max_uses: 3 } as Anthropic.Beta.BetaToolUnion],
      ...(fallbackParams(cfg.model) as object),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") return none;
    if (res.stop_reason !== "pause_turn") {
      const blocks = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
      const cited = blocks.flatMap((b) => (b.citations ?? []).map((c) => ("url" in c ? String(c.url) : ""))).filter(Boolean);
      return answer(blocks.map((b) => b.text).join(""), cited);
    }
    messages.push({ role: "assistant", content: res.content });
  }
  return none;
}

/** OpenAI and xAI Responses API with their hosted web search tool. */
async function askResponses(base: string, key: string, model: string, q: string) {
  const r = await fetch(`${base}/responses`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, instructions: SYSTEM, input: q, tools: [{ type: "web_search" }] }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${data?.error?.message ?? "request failed"}`);
  const parts = ((data.output ?? []) as { content?: { text?: string; annotations?: { url?: string }[] }[] }[]).flatMap((o) => o.content ?? []);
  const text = typeof data.output_text === "string" ? (data.output_text as string) : parts.map((c) => c.text ?? "").join("");
  return answer(text, parts.flatMap((c) => (c.annotations ?? []).map((a) => a.url ?? "")).filter(Boolean));
}

/** One engine through OpenRouter chat completions; citations arrive as url_citation annotations. */
async function askOpenRouter(key: string, engine: (typeof ENGINES)[number], q: string) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Looper" },
    body: JSON.stringify({
      model: engine.model,
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }],
      ...(engine.search ? { plugins: [{ id: "web", max_results: 5 }] } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${data?.error?.message ?? "request failed"}`);
  const msg = data.choices?.[0]?.message ?? {};
  const cited = [
    ...((msg.annotations ?? []) as { url_citation?: { url?: string } }[]).map((a) => a.url_citation?.url ?? ""),
    ...((data.citations ?? []) as string[]),
  ];
  return answer(String(msg.content ?? ""), cited.filter(Boolean));
}

type Asker = { name: string; ask: (q: string) => Promise<Answer> };

/** Check an OpenRouter key before saving it; this endpoint is free. */
export async function pingOpenRouter(key: string) {
  const r = await fetch("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${data?.error?.message ?? "request failed"}`);
}

/** The founder's main model with web search, then ChatGPT, Perplexity and Google AI through OpenRouter when they added a key. */
export async function enginesFor(userId: number, cfg: ModelConfig): Promise<Asker[]> {
  const main: Asker =
    cfg.provider === "anthropic"
      ? { name: "Claude", ask: (q) => askClaude(cfg, q) }
      : cfg.provider === "openai"
        ? { name: "ChatGPT", ask: (q) => askResponses("https://api.openai.com/v1", cfg.key, cfg.model, q) }
        : { name: "Grok", ask: (q) => askResponses("https://api.x.ai/v1", cfg.key, cfg.model, q) };
  // No web search on this model: answer from what it knows, so the reading still lands.
  const withFallback: Asker = {
    name: main.name,
    ask: (q) => main.ask(q).catch(async () => answer(await chat(cfg, SYSTEM, [{ role: "user", content: q }]), [])),
  };
  const [row] = await sql<{ key_enc: string }>`select key_enc from engine_keys where user_id = ${userId} and engine = ${OPENROUTER}`;
  if (!row) return [withFallback];
  const key = decrypt(row.key_enc);
  const extra = ENGINES.filter((e) => e.name !== main.name).map((e): Asker => ({ name: e.name, ask: (q) => askOpenRouter(key, e, q) }));
  return [withFallback, ...extra];
}
