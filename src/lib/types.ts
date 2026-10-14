export type Provider = "xai" | "openai" | "anthropic";

export const PROVIDERS: { id: Provider; label: string; defaultModel: string; keyHint: string }[] = [
  { id: "xai", label: "Grok (xAI)", defaultModel: "grok-4.7", keyHint: "xai-…" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-5.6", keyHint: "sk-…" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-5-5", keyHint: "sk-ant-…" },
];

export type IntegrationKind = "composio" | "zapier" | "pipedream" | "custom";

/** An MCP server. Hubs like Composio, Zapier and Pipedream each expose thousands of apps through one URL. */
export interface Integration {
  id: string;
  name: string;
  kind: IntegrationKind;
  url: string;
  headers: Record<string, string>;
  enabled: boolean;
}

export interface Settings {
  provider: Provider;
  apiKeys: Partial<Record<Provider, string>>;
  models: Record<Provider, string>;
  integrations: Integration[];
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
}

export interface DB {
  settings: Settings;
  loopers: Looper[];
  cards: Card[];
  runs: Run[];
  retros: Retro[];
  chief: ChiefMessage[];
}

/** Settings with secrets masked, safe to send to the browser. */
export type PublicSettings = Omit<Settings, "apiKeys" | "integrations"> & {
  keysSet: Record<Provider, boolean>;
  integrations: (Omit<Integration, "headers"> & { headerNames: string[] })[];
};

export type PublicState = Omit<DB, "settings"> & { settings: PublicSettings };
