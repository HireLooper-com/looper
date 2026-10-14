import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel, ToolSet } from "ai";
import { chatgptAccessToken, RESOURCE, USAGE_URL } from "./oauth/chatgpt";
import { API_BASE, CLI_PROXY_BASE, cliProxyHeaders, grokAccessToken, GROK_USAGE_URL, isGrokEntitlementError } from "./oauth/grok";
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
}

const identity = <T,>(t: T) => t;

/** Resolve the model from the user's own subscription (OAuth) or API key. */
export async function getModel(uid: string, settings: Settings): Promise<ResolvedModel> {
  const provider = settings.provider;
  const modelId = settings.models[provider];
  const mode = settings.authMode[provider] ?? "key";

  if (provider === "openai" && mode === "oauth") {
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
  }
}

/** True when the active provider has a usable sign-in or key. */
export function hasCredentials(settings: Settings) {
  const p = settings.provider;
  if ((settings.authMode[p] ?? "key") === "oauth") return !!settings.oauth[p];
  return !!settings.apiKeys[p];
}

const CHATGPT_ERRORS: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded: `You've reached your ChatGPT plan's usage limit. Manage it at ${USAGE_URL}.`,
  subscription_sharing_usage_unavailable: "ChatGPT plan usage is temporarily unavailable. Try again shortly.",
  subscription_sharing_user_unavailable: "ChatGPT plan usage is temporarily unavailable. Try again shortly.",
  subscription_sharing_user_not_eligible: "This ChatGPT account isn't eligible for plan usage in other apps (Plus or Pro required).",
  subscription_sharing_invalid_user: "ChatGPT didn't accept this account. Sign in with ChatGPT again.",
};

async function chatgptError(res: Response) {
  const text = await res.text();
  let code = "";
  let message = text.slice(0, 300);
  let param = "";
  try {
    const j = JSON.parse(text);
    code = j.error?.code ?? "";
    param = j.error?.param ?? "";
    message = j.error?.message ?? j.detail ?? message;
  } catch {}
  return new Error(CHATGPT_ERRORS[code] ?? `ChatGPT plan request failed (${res.status}${code ? ` ${code}` : ""}${param ? `, ${param}` : ""}): ${message}`);
}
