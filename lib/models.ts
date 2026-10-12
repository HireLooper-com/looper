// Providers and the models offered for each, first is the default. Pure data, safe in client components.
export type Provider = "anthropic" | "openai" | "xai";
export const PROVIDERS: Record<Provider, { name: string; model: string; models: string[]; hint: string }> = {
  anthropic: {
    name: "Anthropic",
    model: "claude-opus-5-5",
    models: ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"],
    hint: "sk-ant-...",
  },
  openai: { name: "OpenAI", model: "gpt-5", models: ["gpt-5", "gpt-5-mini"], hint: "sk-..." },
  xai: { name: "xAI", model: "grok-4", models: ["grok-4", "grok-3-mini"], hint: "xai-..." },
};
