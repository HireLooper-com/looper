import "server-only";
import { randomUUID } from "node:crypto";
import { kv } from "./kv";
import type { DB, Provider, PublicState, User } from "./types";
import { PROVIDERS } from "./types";

// Users and workspaces live in the shared key-value store (Postgres on Vercel, files locally).
const wsKey = (uid: string) => `ws:${uid}`;

function empty(): DB {
  // Hosted, new workspaces start on Claude with their included credits.
  const hosted = !!process.env.ANTHROPIC_API_KEY;
  return {
    settings: {
      provider: hosted ? "anthropic" : "xai",
      apiKeys: {},
      models: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.defaultModel])) as Record<Provider, string>,
      integrations: [],
      authMode: hosted ? { anthropic: "credits" } : {},
      oauth: {},
      grokRoute: "api",
    },
    loopers: [],
    cards: [],
    runs: [],
    retros: [],
    chief: [],
    chats: {},
    asks: [],
  };
}

const STALE_RUN_MS = 8 * 60_000;

/** Fill in fields added after a workspace was first saved, and close runs that died. Mutates in place. */
function normalize(db: Partial<DB>): DB {
  const base = empty();
  for (const k of Object.keys(base) as (keyof DB)[]) if (db[k] === undefined) (db as Record<string, unknown>)[k] = base[k];
  db.settings = Object.assign(base.settings, db.settings);
  // Providers added later get their default model.
  db.settings.models = { ...base.settings.models, ...db.settings.models };
  if (db.runs && db.runs.length > 1000) db.runs.splice(0, db.runs.length - 1000);
  // A run still "running" long after the 5-minute function limit was cut off and never finished.
  for (const r of db.runs ?? [])
    if (r.status === "running" && Date.now() - Date.parse(r.startedAt) > STALE_RUN_MS) {
      r.status = "error";
      r.finishedAt = new Date(Date.parse(r.startedAt) + 5 * 60_000).toISOString();
      r.summary = r.summary || "Stopped: the run hit the 5-minute limit before it could finish. Anything it saved (rows, cards) is kept; run it again to continue.";
    }
  return db as DB;
}

export async function read(uid: string): Promise<DB> {
  return normalize((await kv.get<Partial<DB>>(wsKey(uid))) ?? {});
}

/** Locked read-modify-write of one user's workspace. */
export function mutate<T>(uid: string, fn: (db: DB) => T | Promise<T>): Promise<T> {
  return kv.update<Partial<DB>, T>(wsKey(uid), () => ({}), (value) => fn(normalize(value)));
}

// — Users — (they live in ./workspace; re-exported for older imports)

export { getUser, upsertUser } from "./workspace";

/** Optional allowlist: ALLOWED_EMAILS="you@company.com,@company.com". */
export function emailAllowed(email?: string) {
  const list = (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  if (!email) return false;
  const e = email.toLowerCase();
  return list.some((rule) => (rule.startsWith("@") ? e.endsWith(rule) : e === rule));
}

/** Stable per-installation id sent to ChatGPT as ext_agent_host_id. */
export function hostId(): Promise<string> {
  return kv.update<{ hostId?: string }, string>("host", () => ({}), (data) => (data.hostId ??= `urn:uuid:${randomUUID()}`));
}

/** ChatGPT plan usage is only offered to apps running on the user's own machine. */
export function isLocalServer() {
  return !process.env.VERCEL && process.env.GROKLOOPER_HOSTED !== "1";
}

export function toPublic(db: DB, user: User): PublicState {
  const { apiKeys, integrations, oauth, ...rest } = db.settings;
  delete (rest as Partial<typeof db.settings>).chatgptClientId;
  return {
    ...db,
    runs: db.runs.slice(-500),
    user: { email: user.email, provider: user.provider, name: user.name, avatar: user.avatar },
    settings: {
      ...rest,
      keysSet: Object.fromEntries(PROVIDERS.map((p) => [p.id, Boolean(apiKeys[p.id])])) as Record<Provider, boolean>,
      subscriptions: {
        openai: oauth.openai && {
          email: oauth.openai.email,
          sharing: oauth.openai.via === "codex" || oauth.openai.scopes.includes("chatgpt.tokens.use.direct"),
          via: oauth.openai.via,
        },
        xai: oauth.xai && { email: oauth.xai.email },
      },
      isLocal: isLocalServer(),
      integrations: integrations.map(({ headers, ...i }) => ({ ...i, headerNames: Object.keys(headers) })),
    },
  };
}
