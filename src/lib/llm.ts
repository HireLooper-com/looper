import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import type { Settings } from "./types";
import { PROVIDERS } from "./types";

/** Resolve the model from the user's own subscription key (BYOK). */
export function getModel(settings: Settings) {
  const provider = settings.provider;
  const apiKey = settings.apiKeys[provider];
  if (!apiKey) {
    const label = PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
    throw new Error(`No ${label} API key yet. Add one in Settings.`);
  }
  const modelId = settings.models[provider];
  switch (provider) {
    case "xai":
      return createXai({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
  }
}
