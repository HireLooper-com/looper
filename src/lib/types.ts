export type Provider = "openai" | "xai" | "anthropic";

export const PROVIDERS: { id: Provider; label: string; plan: string; defaultModel: string; keyHint: string }[] = [
  { id: "openai", label: "OpenAI", plan: "ChatGPT", defaultModel: "gpt-5.6", keyHint: "sk-…" },
  { id: "xai", label: "xAI", plan: "Grok", defaultModel: "grok-4.7", keyHint: "xai-…" },
  { id: "anthropic", label: "Anthropic", plan: "Claude", defaultModel: "claude-sonnet-5-5", keyHint: "sk-ant-…" },
];

export interface User {
  id: string;
  /** how they first signed in: a model provider (self-hosted) or "email"/"google"/"github" */
  provider: Provider | "email" | "google" | "github";
  email?: string;
  name?: string;
  avatar?: string;
  /** provider:subject pairs that sign in as this user */
  identities: string[];
  /** team workspaces they belong to (the personal one has their own id) */
  workspaces?: string[];
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

/** credits: hosted Claude on the workspace's included credits (our server key). */
export type AuthMode = "key" | "oauth" | "credits";
/** Where Grok subscription tokens are sent: xAI's public API, or the Grok CLI's proxy (unofficial). */
export type GrokRoute = "api" | "cli-proxy";

export interface Settings {
  provider: Provider;
  apiKeys: Partial<Record<Provider, string>>;
  models: Record<Provider, string>;
  integrations: Integration[];
  authMode: Partial<Record<Provider, AuthMode>>;
  oauth: { openai?: OAuthCredential; xai?: OAuthCredential; anthropic?: never };
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
  /** short role tag shown next to the name, e.g. "Accounting" */
  role?: string;
  /** Sidebar group. Unset on older loopers; see areaOf. */
  area?: Area;
  status: "active" | "paused";
  createdAt: string;
}

/** Distribution loopers grow reach, traffic, leads or revenue; operations loopers keep the business running. */
export type Area = "distribution" | "operations";
export const AREAS: { id: Area; label: string }[] = [
  { id: "distribution", label: "Distribution" },
  { id: "operations", label: "Operations" },
];

const DISTRIBUTION = /\b(seo|geo|social|marketing|content|ads?|ppc|sales|growth|leads?|outreach|linkedin|newsletter|pr|brand|community|impressions|traffic|clicks|signups|revenue|roas|demos?)\b/i;

/** A looper's sidebar group: its own, or guessed from its role and business metric. */
export const areaOf = (l: Pick<Looper, "area" | "role" | "metric">): Area => l.area ?? (DISTRIBUTION.test(`${l.role ?? ""} ${l.metric.name}`) ? "distribution" : "operations");

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
  /** who has to do it: the looper itself, or the person (approve, connect, decide). Default looper. */
  assignee?: "looper" | "you";
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
  /** what the run changed, for the one-line run report */
  stats?: RunStats;
  /** the steps it took, as shown live while it worked */
  steps?: string[];
  /** hidden from the inbox after the owner dismissed the failure */
  dismissed?: boolean;
}

export interface RunStats {
  rows?: number;
  cards?: number;
  moved?: number;
  pins?: number;
  metric?: number;
  tools?: number;
}

/** A question or approval a looper puts to its owner; answered with one tap in chat or the inbox. */
export interface Ask {
  id: string;
  looperId: string;
  kind: "choice" | "approval";
  question: string;
  /** for choice: the options to tap */
  options?: string[];
  /** for approval: what exactly will happen when approved */
  detail?: string;
  status: "open" | "answered" | "dismissed";
  answer?: string;
  createdAt: string;
  answeredAt?: string;
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
  /** a question or approval asked in this message */
  askId?: string;
  /** who wrote it, in a shared workspace */
  by?: { id: string; name: string };
}

/** One user's private workspace. */
export interface DB {
  settings: Settings;
  loopers: Looper[];
  cards: Card[];
  runs: Run[];
  retros: Retro[];
  chief: ChiefMessage[];
  /** one conversation per looper */
  chats?: Record<string, ChiefMessage[]>;
  asks: Ask[];
}

/** Settings with secrets masked, safe to send to the browser. */
export type PublicSettings = Omit<Settings, "apiKeys" | "integrations" | "oauth" | "chatgptClientId"> & {
  keysSet: Record<Provider, boolean>;
  /** connected subscription accounts, by email */
  subscriptions: { openai?: { email?: string; sharing: boolean }; xai?: { email?: string }; anthropic?: never };
  /** Hosted: USD of included Claude credits left (undefined when the server has no hosted credits). */
  creditsLeft?: number;
  /** true when the server runs on the user's machine (ChatGPT sign-in is only allowed there) */
  isLocal: boolean;
  integrations: (Omit<Integration, "headers"> & { headerNames: string[] })[];
};

export type PublicState = Omit<DB, "settings"> & { settings: PublicSettings; user: { email?: string; provider: User["provider"]; name?: string; avatar?: string } };

// — Looper database (Notion-style table; one row = one unit of the looper's work) —

export type DbColumnType = "text" | "number" | "currency" | "date" | "select" | "checkbox" | "url";
export const DB_COLUMN_TYPES: { id: DbColumnType; label: string; icon: string }[] = [
  { id: "text", label: "Text", icon: "Aa" },
  { id: "number", label: "Number", icon: "#" },
  { id: "currency", label: "Currency", icon: "€" },
  { id: "date", label: "Date", icon: "◷" },
  { id: "select", label: "Select", icon: "▾" },
  { id: "checkbox", label: "Checkbox", icon: "☑" },
  { id: "url", label: "URL", icon: "↗" },
];

export interface DbColumn {
  id: string;
  name: string;
  type: DbColumnType;
  /** select options, in order */
  options?: string[];
}

export type DbValue = string | number | boolean | null;

export interface DbRow {
  id: string;
  cells: Record<string, DbValue>;
  createdBy: "looper" | "user";
  createdAt: string;
  updatedAt: string;
}

export interface LooperDatabase {
  name: string;
  /** what one row represents, e.g. "bank transaction" */
  rowNoun: string;
  columns: DbColumn[];
  rows: DbRow[];
}

/** Who a card is for. Older Chief starter cards have no assignee; ones asking to review/confirm/connect are the owner's. */
export function cardAssignee(c: Pick<Card, "assignee" | "createdBy" | "title">): "looper" | "you" {
  if (c.assignee) return c.assignee;
  return c.createdBy === "chief" && /^(review|confirm|connect|approve|decide|check|provide|share)\b/i.test(c.title.trim()) ? "you" : "looper";
}

/** An item on a looper's infinite canvas. Coordinates are canvas units; the view pans and zooms over them. */
export type CanvasItemKind = "note" | "text" | "image" | "link" | "frame" | "arrow";
export interface CanvasItem {
  id: string;
  kind: CanvasItemKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** note/text body, image caption */
  text?: string;
  /** image source: an uploaded image (/api/canvas/…) or a web URL */
  src?: string;
  /** link target */
  url?: string;
  /** link title and preview image, when the page had them */
  title?: string;
  image?: string;
  /** arrow ends: item ids */
  from?: string;
  to?: string;
  by: "you" | "looper";
  at: string;
}
export interface LooperCanvas {
  items: CanvasItem[];
}

/** Can loopers call a model with these settings: a sign-in, a key, or included credits left. */
export function modelReady(s: PublicSettings) {
  const mode = s.authMode[s.provider] ?? (s.subscriptions[s.provider] ? "oauth" : "key");
  if (mode === "credits") return (s.creditsLeft ?? 0) > 0;
  return mode === "oauth" ? !!s.subscriptions[s.provider] : s.keysSet[s.provider];
}
