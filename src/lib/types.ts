export type Provider = "openai" | "xai";

export const PROVIDERS: { id: Provider; label: string; plan: string; defaultModel: string; keyHint: string }[] = [
  { id: "openai", label: "OpenAI", plan: "ChatGPT", defaultModel: "gpt-5.6", keyHint: "sk-…" },
  { id: "xai", label: "xAI", plan: "Grok", defaultModel: "grok-4.7", keyHint: "xai-…" },
];

export interface User {
  id: string;
  /** provider used for the first sign-in */
  provider: Provider;
  email?: string;
  /** provider:subject pairs that sign in as this user */
  identities: string[];
  createdAt: string;
  lastLoginAt: string;
}

export type IntegrationKind = "composio" | "zapier" | "pipedream" | "custom";

/** An MCP server. Hubs like Composio, Zapier and Pipedream each expose thousands of apps through one URL. */
export interface Integration {
  id: string;
  name: string;
  kind: IntegrationKind;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
  /** catalog app this server provides, e.g. "bunq" */
  app?: string;
  /** tools never exposed to loopers, e.g. real-money payments */
  deniedTools?: string[];
}

/** An app a looper needs. Composio apps connect with one click; MCP apps point at a server. */
export interface AppRef {
  slug: string;
  name: string;
  via: "composio" | "mcp";
  logo?: string;
}

/** OAuth tokens for a subscription sign-in. Server-only. */
export interface OAuthCredential {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  expiresAt: number;
  /** epoch ms; ChatGPT refuses refreshes before this */
  earliestRefreshAt?: number;
  scopes: string[];
  email?: string;
  subject?: string;
}

export type AuthMode = "key" | "oauth";
/** Where Grok subscription tokens are sent: xAI's public API, or the Grok CLI's proxy (unofficial). */
export type GrokRoute = "api" | "cli-proxy";

export interface Settings {
  provider: Provider;
  apiKeys: Partial<Record<Provider, string>>;
  models: Record<Provider, string>;
  integrations: Integration[];
  authMode: Partial<Record<Provider, AuthMode>>;
  oauth: { openai?: OAuthCredential; xai?: OAuthCredential };
  /** ChatGPT issues a client id per user on first sign-in; it survives sign-out. */
  chatgptClientId?: string;
  grokRoute: GrokRoute;
}

export type ScheduleType = "manual" | "hourly" | "daily" | "weekly";

export interface Schedule {
  type: ScheduleType;
  /** HH:MM, local server time */
  time: string;
  /** 0 = Sunday … 6 = Saturday, used by weekly */
  days: number[];
}

export interface Skill {
  id: string;
  name: string;
  instructions: string;
  schedule: Schedule;
  /** retro skills run a self-reflection instead of regular work */
  kind: "work" | "retro";
  lastRunAt?: string;
}

export interface MetricPoint {
  at: string;
  value: number;
  note?: string;
}

export interface Metric {
  name: string;
  unit: string;
  direction: "up" | "down";
  target: number;
  history: MetricPoint[];
}

export interface Looper {
  id: string;
  name: string;
  emoji: string;
  color: Accent;
  mission: string;
  metric: Metric;
  skills: Skill[];
  /** "all" or a list of integration ids */
  integrationIds: "all" | string[];
  /** apps this looper needs connected */
  apps?: AppRef[];
  status: "active" | "paused";
  createdAt: string;
}

export type Accent = "green" | "orange" | "lavender" | "blue" | "ink";
export const ACCENTS: Accent[] = ["green", "orange", "lavender", "blue", "ink"];

export type Column = "backlog" | "todo" | "doing" | "done";
export const COLUMNS: { id: Column; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

export interface Card {
  id: string;
  looperId: string;
  title: string;
  description: string;
  column: Column;
  createdBy: "looper" | "user" | "chief";
  createdAt: string;
  updatedAt: string;
}

export interface ToolCallLog {
  name: string;
  ok: boolean;
}

export interface Run {
  id: string;
  looperId: string;
  skillId: string;
  skillName: string;
  trigger: "schedule" | "manual" | "chief";
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  summary: string;
  toolCalls: ToolCallLog[];
}

export interface Retro {
  id: string;
  looperId: string;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  /** 1–5, self-assessed */
  effectiveness: number;
  metricStart?: number;
  metricEnd?: number;
  wentWell: string[];
  didntGoWell: string[];
  tryNext: string[];
}

export interface ChiefMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
  actions?: string[];
  /** follow-up links, e.g. connecting a new looper's apps */
  links?: { label: string; href: string }[];
}

/** One user's private workspace. */
export interface DB {
  settings: Settings;
  loopers: Looper[];
  cards: Card[];
  runs: Run[];
  retros: Retro[];
  chief: ChiefMessage[];
}

/** Settings with secrets masked, safe to send to the browser. */
export type PublicSettings = Omit<Settings, "apiKeys" | "integrations" | "oauth" | "chatgptClientId"> & {
  keysSet: Record<Provider, boolean>;
  /** connected subscription accounts, by email */
  subscriptions: { openai?: { email?: string; sharing: boolean }; xai?: { email?: string } };
  /** true when the server runs on the user's machine (ChatGPT sign-in is only allowed there) */
  isLocal: boolean;
  integrations: (Omit<Integration, "headers"> & { headerNames: string[] })[];
};

export type PublicState = Omit<DB, "settings"> & { settings: PublicSettings; user: { email?: string; provider: Provider } };
