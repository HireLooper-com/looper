import "server-only";
import { after } from "next/server";
import { kv } from "./kv";
import type { ModelPrice, Provider } from "./types";

// Which models exist and what they cost, from models.dev (an open catalog of model ids and API
// list prices). Cached in the store and refreshed twice a day, so new models and price changes
// show up without a deploy. If models.dev can't be reached, the last copy (or the snapshot below) is used.

const SOURCE = "https://models.dev/api.json";
const CACHE_KEY = "models:catalog";
const MAX_AGE_MS = 12 * 3600_000;
/** Families whose newest model is this much older than the provider's newest are left out of the picker. */
const STALE_FAMILY_MS = 200 * 86_400_000;
const PER_PROVIDER = 6;

export interface CatalogModel {
  id: string;
  name: string;
  family: string;
  released: string;
  price: ModelPrice;
}

export interface Catalog {
  fetchedAt: number;
  /** pickable models per provider, newest first */
  models: Record<Provider, CatalogModel[]>;
  /** list price of every text model the provider has, for metering models not in the picker */
  prices: Record<Provider, Record<string, ModelPrice>>;
}

/** Used until models.dev has been reached once. */
const SNAPSHOT: Catalog = {
  fetchedAt: 0,
  models: {
    anthropic: [
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", family: "claude-sonnet", released: "2026-09-28", price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
      { id: "claude-opus-5-5", name: "Claude Opus 5.5", family: "claude-opus", released: "2026-09-22", price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
      { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", family: "claude-haiku", released: "2026-10-07", price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
    ],
    openai: [
      { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", family: "gpt-sol", released: "2026-09-29", price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } },
      { id: "gpt-6-luna", name: "GPT-6 Luna", family: "gpt-luna", released: "2026-09-22", price: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 } },
    ],
    xai: [{ id: "grok-4.7", name: "Grok 4.7", family: "grok", released: "2026-09-21", price: { input: 2, output: 6, cacheRead: 0.5 } }],
  },
  prices: { anthropic: {}, openai: {}, xai: {} },
};

const PROVIDER_IDS: Provider[] = ["anthropic", "openai", "xai"];

interface DevModel {
  id: string;
  name?: string;
  family?: string;
  release_date?: string;
  tool_call?: boolean;
  status?: string;
  modalities?: { output?: string[] };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
}

// Dated snapshots, aliases and special-purpose variants that would only clutter a picker.
const NOT_FOR_PICKER = /-\d{4}(\d{4})?$|-latest$|codex|realtime|audio|search|-pro$|multi-agent|non-reasoning|deep-research/;

function parse(data: Record<string, { models?: Record<string, DevModel> }>): Catalog {
  const catalog: Catalog = { fetchedAt: Date.now(), models: { anthropic: [], openai: [], xai: [] }, prices: { anthropic: {}, openai: {}, xai: {} } };
  for (const p of PROVIDER_IDS) {
    const text = Object.values(data[p]?.models ?? {}).filter(
      (m) => m.cost?.input !== undefined && m.cost.output !== undefined && m.modalities?.output?.length === 1 && m.modalities.output[0] === "text",
    );
    for (const m of text)
      catalog.prices[p][m.id] = { input: m.cost!.input!, output: m.cost!.output!, cacheRead: m.cost!.cache_read, cacheWrite: m.cost!.cache_write };

    const pickable = text
      .filter((m) => m.tool_call && m.status !== "deprecated" && m.release_date && !NOT_FOR_PICKER.test(m.id))
      .map((m) => ({ id: m.id, name: (m.name ?? m.id).replace(/\s*\(latest\)$/, ""), family: m.family ?? m.id, released: m.release_date!, price: catalog.prices[p][m.id] }))
      .sort((a, b) => b.released.localeCompare(a.released));
    // The newest model of each family that's still current.
    const newest = pickable[0] ? Date.parse(pickable[0].released) : 0;
    const families = new Set<string>();
    catalog.models[p] = pickable
      .filter((m) => !families.has(m.family) && families.add(m.family) && newest - Date.parse(m.released) < STALE_FAMILY_MS)
      .slice(0, PER_PROVIDER);
    if (!catalog.models[p].length) catalog.models[p] = SNAPSHOT.models[p];
  }
  return catalog;
}

/** Fetch models.dev and store the trimmed catalog. Keeps the old copy when it fails. */
export async function refreshCatalog(): Promise<Catalog | undefined> {
  try {
    const res = await fetch(SOURCE, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`models.dev ${res.status}`);
    const catalog = parse(await res.json());
    await kv.set(CACHE_KEY, catalog);
    return catalog;
  } catch (e) {
    console.error("[models] refresh failed", e);
    return undefined;
  }
}

const g = globalThis as { __clCatalog?: Catalog; __clRefreshing?: boolean };

/** The model catalog. Served from memory or the store; refreshed in the background when stale. */
export async function getCatalog(): Promise<Catalog> {
  const fresh = (c?: Catalog) => !!c && Date.now() - c.fetchedAt < MAX_AGE_MS;
  if (fresh(g.__clCatalog)) return g.__clCatalog!;
  const stored = await kv.get<Catalog>(CACHE_KEY).catch(() => undefined);
  if (stored) g.__clCatalog = stored;
  if (!fresh(stored) && !g.__clRefreshing) {
    g.__clRefreshing = true;
    const refresh = () =>
      refreshCatalog()
        .then((c) => void (c && (g.__clCatalog = c)))
        .finally(() => (g.__clRefreshing = false));
    // Nothing cached yet: wait for it once. Otherwise serve the old copy and refresh after the response.
    if (!stored) await refresh();
    else
      try {
        after(refresh);
      } catch {
        void refresh();
      }
  }
  return g.__clCatalog ?? SNAPSHOT;
}

/** The provider's default: its newest model priced for everyday work (not the cheapest tier, not the priciest). */
export function recommendedModel(catalog: Catalog, provider: Provider): CatalogModel {
  const list = catalog.models[provider];
  return list.find((m) => m.price.input >= 1 && m.price.input <= 5) ?? list[0] ?? SNAPSHOT.models[provider][0];
}

export function priceOf(catalog: Catalog, provider: Provider, model: string): ModelPrice | undefined {
  return catalog.models[provider].find((m) => m.id === model)?.price ?? catalog.prices[provider][model] ?? SNAPSHOT.models[provider].find((m) => m.id === model)?.price;
}

export function nameOf(catalog: Catalog, provider: Provider, model: string) {
  return catalog.models[provider].find((m) => m.id === model)?.name ?? model;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** What these tokens cost at list price, in USD. */
export function usdOf(price: ModelPrice, t: TokenUsage) {
  const plain = Math.max(0, t.input - t.cacheRead - t.cacheWrite);
  return (plain * price.input + t.cacheRead * (price.cacheRead ?? price.input) + t.cacheWrite * (price.cacheWrite ?? price.input) + t.output * price.output) / 1e6;
}
