import Anthropic from "@anthropic-ai/sdk";
import { sql } from "./db";
import { decrypt } from "./crypto";

import { PROVIDERS, type Provider } from "./models";

// Every plan runs on the founder's own key. We never ship a key of our own.
export { PROVIDERS, type Provider };

export type ModelConfig = { provider: Provider; model: string; key: string };

export async function modelFor(userId: number): Promise<ModelConfig | null> {
  const [row] = await sql<{ provider: Provider; model: string; key_enc: string }>`
    select provider, model, key_enc from model_keys where user_id = ${userId}`;
  if (!row) return null;
  return { provider: row.provider, model: row.model, key: decrypt(row.key_enc) };
}

export type Schema = Record<string, unknown>;
export type LocalTool = {
  name: string;
  description: string;
  schema: Schema;
  run: (input: Record<string, unknown>) => Promise<unknown>;
};
export type Turn = { role: "user" | "assistant"; content: string };

const OPENAI_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  xai: "https://api.x.ai/v1",
};

function anthropic(cfg: ModelConfig) {
  return new Anthropic({ apiKey: cfg.key, maxRetries: 2, timeout: 120_000 });
}

// Server-side fallback re-runs a declined request on another model instead of
// returning a refusal. Only sent to Claude models that accept it.
export function fallbackParams(model: string) {
  return /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : { betas: [] as string[] };
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]) {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

function checkStop(stop: string | null | undefined) {
  if (stop === "refusal") throw new Error("The model declined this request.");
}

async function openaiCall(cfg: ModelConfig, body: Record<string, unknown>) {
  const r = await fetch(`${OPENAI_BASE[cfg.provider]}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.model, ...body }),
    // Same limit as the Anthropic client, so one slow provider cannot hold the whole tick.
    signal: AbortSignal.timeout(120_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${PROVIDERS[cfg.provider].name} ${r.status}: ${data?.error?.message ?? "request failed"}`);
  return data.choices[0].message as {
    content: string | null;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  };
}

/** Plain multi-turn chat. Used by the reflection. */
export async function chat(cfg: ModelConfig, system: string, turns: Turn[]) {
  if (cfg.provider === "anthropic") {
    const res = await anthropic(cfg).beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      system,
      messages: turns,
      ...(fallbackParams(cfg.model) as object),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    checkStop(res.stop_reason);
    return textOf(res.content);
  }
  const msg = await openaiCall(cfg, { messages: [{ role: "system", content: system }, ...turns] });
  return (msg.content ?? "").trim();
}

/** One request that must come back as JSON matching `schema`. */
export async function json<T>(cfg: ModelConfig, system: string, prompt: string, name: string, schema: Schema): Promise<T> {
  if (cfg.provider === "anthropic") {
    const res = await anthropic(cfg).beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: { type: "json_schema", schema } },
      ...(fallbackParams(cfg.model) as object),
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    checkStop(res.stop_reason);
    return JSON.parse(textOf(res.content)) as T;
  }
  const msg = await openaiCall(cfg, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_schema", json_schema: { name, schema, strict: true } },
  });
  return JSON.parse(msg.content ?? "{}") as T;
}

const OUT_OF_STEPS = "You are out of tool calls. Answer now with what you found so far and say what you could not check.";

/**
 * Tool-use loop. Returns the model's final text after it stops calling tools. `prompt` is one user turn or a whole chat.
 * After `maxSteps` rounds of tool calls the model gets one last turn with tools off, so a long read ends in an answer, not an error.
 */
export async function withTools(cfg: ModelConfig, system: string, prompt: string | Turn[], tools: LocalTool[], maxSteps = 6) {
  const turns: Turn[] = typeof prompt === "string" ? [{ role: "user", content: prompt }] : prompt;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const runTool = async (name: string, input: Record<string, unknown>) => {
    const t = byName.get(name);
    if (!t) return { error: `unknown tool ${name}` };
    try {
      return await t.run(input);
    } catch (e) {
      return { error: String((e as Error).message ?? e) };
    }
  };
  const clip = (v: unknown) => JSON.stringify(v).slice(0, 12000);

  if (cfg.provider === "anthropic") {
    const client = anthropic(cfg);
    const messages: Anthropic.Beta.BetaMessageParam[] = [...turns];
    for (let step = 0; ; step++) {
      const last = step >= maxSteps;
      if (last) (messages[messages.length - 1].content as Anthropic.Beta.BetaContentBlockParam[]).push({ type: "text", text: OUT_OF_STEPS });
      const res = await client.beta.messages.create({
        model: cfg.model,
        max_tokens: 16000,
        system,
        messages,
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema as any })),
        ...(last ? { tool_choice: { type: "none" } } : {}),
        ...(fallbackParams(cfg.model) as object),
      } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      checkStop(res.stop_reason);
      messages.push({ role: "assistant", content: res.content });
      const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (last || res.stop_reason !== "tool_use" || !uses.length) return textOf(res.content);
      const results = await Promise.all(
        uses.map(async (u) => ({
          type: "tool_result" as const,
          tool_use_id: u.id,
          content: clip(await runTool(u.name, u.input as Record<string, unknown>)),
        })),
      );
      messages.push({ role: "user", content: results });
    }
  }

  const messages: Record<string, unknown>[] = [{ role: "system", content: system }, ...turns];
  const fns = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.schema },
  }));
  for (let step = 0; ; step++) {
    const last = step >= maxSteps;
    if (last) messages.push({ role: "user", content: OUT_OF_STEPS });
    const msg = await openaiCall(cfg, { messages, tools: fns, ...(last ? { tool_choice: "none" } : {}) });
    messages.push(msg);
    if (last || !msg.tool_calls?.length) return (msg.content ?? "").trim();
    for (const c of msg.tool_calls) {
      let input = {};
      try {
        input = JSON.parse(c.function.arguments || "{}");
      } catch {}
      messages.push({ role: "tool", tool_call_id: c.id, content: clip(await runTool(c.function.name, input)) });
    }
  }
}

/** Cheap call used to check a key and model before saving them. */
export async function ping(cfg: ModelConfig) {
  const out = await chat(cfg, "Reply with the single word ok.", [{ role: "user", content: "ping" }]);
  return out.length > 0;
}
