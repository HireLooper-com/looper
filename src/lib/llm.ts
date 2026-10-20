import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel, ToolSet } from "ai";
import { chatgptAccessToken, RESOURCE, USAGE_URL } from "./oauth/chatgpt";
import { codexAuth, CODEX_BASE, codexBody, codexHeaders } from "./oauth/codex";
import { API_BASE, CLI_PROXY_BASE, cliProxyHeaders, grokAccessToken, GROK_USAGE_URL, isGrokEntitlementError } from "./oauth/grok";
import { costOf, creditsLeft, spendCredits, type UsageLike } from "./billing";
import { isLocalServer } from "./db";
import { getWorkspace } from "./workspace";
import type { Settings } from "./types";
import { PROVIDERS } from "./types";

type ProviderOptions = Record<string, Record<string, string | number | boolean | null>>;

export interface ResolvedModel {
  model: LanguageModel;
  providerOptions?: ProviderOptions;
  /** ChatGPT plan requests reject tools outside a namespace. */
  wrapTools: <T extends ToolSet>(tools: T) => T;
  /** Human label for errors and UI */
  label: string;
  /** Called with each call's token usage (hosted credits are spent here). */
  meter?: (usage: UsageLike) => Promise<void>;
}

/** Hosted Claude runs on our key and the workspace's included credits. */
export const hasHostedCredits = () => !!process.env.ANTHROPIC_API_KEY;

const identity = <T,>(t: T) => t;

/** Resolve the model from the user's own subscription (OAuth) or API key. */
export async function getModel(uid: string, settings: Settings): Promise<ResolvedModel> {
  const provider = settings.provider;
  const modelId = settings.models[provider];
  const mode = settings.authMode[provider] ?? "key";

  if (provider === "openai" && mode === "oauth" && settings.oauth.openai?.via === "codex") {
    const openai = createOpenAI({
      apiKey: "chatgpt-plan",
      baseURL: CODEX_BASE,
      fetch: async (url, init) => {
        const send = async (force: boolean) => {
          const { token, accountId } = await codexAuth(uid, force);
          const headers = new Headers(init?.headers);
          headers.set("authorization", `Bearer ${token}`);
          for (const [k, v] of Object.entries(codexHeaders(accountId))) headers.set(k, v);
          headers.delete("openai-organization");
          headers.delete("openai-project");
          const body = typeof init?.body === "string" ? codexBody(init.body) : init?.body;
          return fetch(url, { ...init, headers, body, redirect: "error" });
        };
        let res = await send(false);
        if (res.status === 401) res = await send(true);
        if (!res.ok) throw await chatgptError(res);
        return res;
      },
    });
    // Callers always use streamText, which the Codex endpoint requires.
    return { model: openai.responses(modelId), providerOptions: { openai: { store: false } }, wrapTools: identity, label: "ChatGPT plan (Codex CLI)" };
  }

  if (provider === "openai" && mode === "oauth") {
    // OpenAI allows plan usage only from apps running on the user's machine.
    if (!isLocalServer())
      throw new Error("Official ChatGPT sign-in only runs loopers when Looper runs on your own machine. Reconnect ChatGPT through the Codex CLI in Settings, or use an OpenAI API key.");
    const openai = createOpenAI({
      apiKey: "chatgpt-plan",
      baseURL: RESOURCE,
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set("authorization", `Bearer ${await chatgptAccessToken(uid)}`);
        headers.delete("openai-organization");
        headers.delete("openai-project");
        const res = await fetch(url, { ...init, headers, redirect: "error" });
        if (!res.ok) throw await chatgptError(res);
        return res;
      },
    });
    return {
      model: openai.responses(modelId),
      // Plan usage requires store:false and streaming; callers always use streamText.
      providerOptions: { openai: { store: false, systemMessageMode: "developer" } },
      wrapTools: (tools) =>
        Object.fromEntries(
          Object.entries(tools).map(([k, t]) => [
            k,
            { ...t, providerOptions: { ...t.providerOptions, openai: { ...t.providerOptions?.openai, namespace: { name: "looper", description: "Tools available to this looper." } } } },
          ]),
        ) as unknown as typeof tools,
      label: "ChatGPT plan",
    };
  }

  if (provider === "xai" && mode === "oauth") {
    const proxy = settings.grokRoute === "cli-proxy";
    const xai = createXai({
      apiKey: "grok-plan",
      baseURL: proxy ? CLI_PROXY_BASE : API_BASE,
      fetch: async (url, init) => {
        const send = async (force: boolean) => {
          const headers = new Headers(init?.headers);
          headers.set("authorization", `Bearer ${await grokAccessToken(uid, force)}`);
          let body = init?.body;
          if (proxy) {
            for (const [k, v] of Object.entries(await cliProxyHeaders())) headers.set(k, v);
            if (typeof body === "string") {
              const json = JSON.parse(body);
              // The proxy rejects these fields with 422.
              for (const f of ["seed", "parallel_tool_calls", "service_tier", "prompt_cache_retention"]) delete json[f];
              if (json.model) headers.set("x-grok-model-override", json.model);
              body = JSON.stringify(json);
            }
          }
          return fetch(url, { ...init, headers, body });
        };
        let res = await send(false);
        if (res.status === 401) res = await send(true);
        if (res.status === 403) {
          const text = await res.text();
          throw new Error(
            isGrokEntitlementError(text)
              ? `Your Grok plan doesn't cover this request (tier or monthly quota). Check ${GROK_USAGE_URL}${proxy ? "" : ", try the Grok CLI route in Settings,"} or use an xAI API key.`
              : `xAI refused the request (403): ${text.slice(0, 200)}`,
          );
        }
        return res;
      },
    });
    return { model: xai.responses(modelId), wrapTools: identity, label: "Grok plan" };
  }

  if (provider === "anthropic" && mode === "credits") {
    if (!hasHostedCredits()) throw new Error("Included credits aren't available on this server. Add an Anthropic API key in Settings.");
    if (creditsLeft(await getWorkspace(uid)) <= 0)
      throw new Error("Your included AI credits are used up. Connect Grok, ChatGPT or an API key in Settings to keep your loopers working.");
    return {
      model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(modelId),
      wrapTools: identity,
      label: "Included credits",
      meter: (usage) => spendCredits(uid, costOf(modelId, usage)),
    };
  }

  const apiKey = settings.apiKeys[provider];
  if (!apiKey) {
    const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
    throw new Error(`No ${label} sign-in or API key yet. Connect one in Settings.`);
  }
  switch (provider) {
    case "xai":
      return { model: createXai({ apiKey })(modelId), wrapTools: identity, label: "xAI API key" };
    case "openai":
      return { model: createOpenAI({ apiKey })(modelId), wrapTools: identity, label: "OpenAI API key" };
    case "anthropic":
      return { model: createAnthropic({ apiKey })(modelId), wrapTools: identity, label: "Anthropic API key" };
  }
}

/** True when the active provider has a usable sign-in or key. */
export function hasCredentials(settings: Settings) {
  const p = settings.provider;
  const mode = settings.authMode[p] ?? "key";
  if (mode === "credits") return hasHostedCredits();
  if (mode === "oauth") return !!settings.oauth[p];
  return !!settings.apiKeys[p];
}

const CHATGPT_ERRORS: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded: `You've reached your ChatGPT plan's usage limit. Manage it at ${USAGE_URL}.`,
  subscription_sharing_usage_unavailable: "ChatGPT plan usage is temporarily unavailable. Try again shortly.",
  subscription_sharing_user_unavailable: "ChatGPT plan usage is temporarily unavailable. Try again shortly.",
  subscription_sharing_user_not_eligible: "This ChatGPT account isn't eligible for plan usage in other apps (Plus or Pro required).",
  subscription_sharing_invalid_user: "ChatGPT didn't accept this account. Sign in with ChatGPT again.",
  usage_limit_reached: `You've reached your ChatGPT plan's Codex usage limit. Check https://chatgpt.com/codex/settings/usage, or use an OpenAI API key.`,
  usage_not_included: "This ChatGPT plan doesn't include Codex usage (Plus, Pro, Business or Enterprise required).",
};

async function chatgptError(res: Response) {
  const text = await res.text();
  let code = "";
  let message = text.slice(0, 300);
  let param = "";
  try {
    const j = JSON.parse(text);
    code = j.error?.code ?? j.error?.type ?? "";
    param = j.error?.param ?? "";
    message = j.error?.message ?? j.detail ?? message;
  } catch {}
  return new Error(CHATGPT_ERRORS[code] ?? `ChatGPT plan request failed (${res.status}${code ? ` ${code}` : ""}${param ? `, ${param}` : ""}): ${message}`);
}
