import "server-only";
import { kv } from "./kv";
import type { TokenUsage } from "./models";
import type { Payer, Provider } from "./types";

// Every model call is logged here: tokens and their list-price value, by who pays for them.
//   us:   included credits, on our Anthropic key (our money)
//   key:  the workspace's own API key (their money, billed by the provider)
//   plan: a ChatGPT or Grok plan (their flat subscription; the USD is what the same tokens would cost on the API)
// One row per day × model × payer × conversation, in one record per workspace per month.

export interface UsageRow {
  day: string;
  provider: Provider;
  model: string;
  payer: Payer;
  /** "chief" or a looper id */
  source: string;
  kind: "chat" | "run";
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: number;
  /** calls whose model had no known price (their tokens count, their USD doesn't) */
  unpriced: number;
}

interface UsageMonth {
  rows: Record<string, UsageRow>;
}

const monthKey = (ws: string, month: string) => `usage:${ws}:${month}`;
export const thisMonth = () => new Date().toISOString().slice(0, 7);

export interface UsageEvent {
  provider: Provider;
  model: string;
  payer: Payer;
  source: string;
  kind: UsageRow["kind"];
  tokens: TokenUsage;
  /** undefined when the model's price is unknown */
  usd?: number;
}

export async function recordUsage(ws: string, e: UsageEvent) {
  const day = new Date().toISOString().slice(0, 10);
  const id = [day, e.provider, e.model, e.payer, e.source, e.kind].join("|");
  await kv.update<UsageMonth, void>(monthKey(ws, day.slice(0, 7)), () => ({ rows: {} }), (m) => {
    const r = (m.rows[id] ??= { day, provider: e.provider, model: e.model, payer: e.payer, source: e.source, kind: e.kind, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, unpriced: 0 });
    r.calls += 1;
    r.input += e.tokens.input;
    r.output += e.tokens.output;
    r.cacheRead += e.tokens.cacheRead;
    r.cacheWrite += e.tokens.cacheWrite;
    if (e.usd === undefined) r.unpriced += 1;
    else r.usd += e.usd;
  });
}

export async function usageRows(ws: string, month = thisMonth()): Promise<UsageRow[]> {
  return Object.values((await kv.get<UsageMonth>(monthKey(ws, month)))?.rows ?? {});
}

export interface UsageTotals {
  calls: number;
  tokens: number;
  usd: number;
  unpriced: number;
}

export interface UsageSummary {
  month: string;
  total: UsageTotals;
  byPayer: Record<Payer, UsageTotals>;
  byModel: (UsageTotals & { provider: Provider; model: string; payer: Payer })[];
  bySource: (UsageTotals & { source: string })[];
}

const zero = (): UsageTotals => ({ calls: 0, tokens: 0, usd: 0, unpriced: 0 });
const add = (t: UsageTotals, r: UsageRow) => {
  t.calls += r.calls;
  t.tokens += r.input + r.output;
  t.usd += r.usd;
  t.unpriced += r.unpriced;
};

export function summarize(rows: UsageRow[], month = thisMonth()): UsageSummary {
  const s: UsageSummary = { month, total: zero(), byPayer: { us: zero(), key: zero(), plan: zero() }, byModel: [], bySource: [] };
  const models = new Map<string, UsageSummary["byModel"][number]>();
  const sources = new Map<string, UsageSummary["bySource"][number]>();
  for (const r of rows) {
    add(s.total, r);
    add(s.byPayer[r.payer], r);
    const mk = `${r.provider}|${r.model}|${r.payer}`;
    if (!models.has(mk)) models.set(mk, { ...zero(), provider: r.provider, model: r.model, payer: r.payer });
    add(models.get(mk)!, r);
    if (!sources.has(r.source)) sources.set(r.source, { ...zero(), source: r.source });
    add(sources.get(r.source)!, r);
  }
  const byCost = (a: UsageTotals, b: UsageTotals) => b.usd - a.usd || b.tokens - a.tokens;
  s.byModel = [...models.values()].sort(byCost);
  s.bySource = [...sources.values()].sort(byCost);
  return s;
}

/** Operators see /admin, every workspace's funnel, costs and nudges: ADMIN_EMAILS="you@company.com,…". */
export function isAdmin(email?: string) {
  const list = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}
