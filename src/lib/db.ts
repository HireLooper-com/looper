import "server-only";
import { randomUUID } from "node:crypto";
import { nanoid } from "nanoid";
import { kv } from "./kv";
import type { DB, Provider, PublicState, User } from "./types";
import { PROVIDERS } from "./types";

// Users and workspaces live in the shared key-value store (Postgres on Vercel, files locally).
const wsKey = (uid: string) => `ws:${uid}`;
const USERS_KEY = "users";

function empty(): DB {
  return {
    settings: {
      provider: "xai",
      apiKeys: {},
      models: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.defaultModel])) as Record<Provider, string>,
      integrations: [],
      authMode: {},
      oauth: {},
      grokRoute: "api",
    },
    loopers: [],
    cards: [],
    runs: [],
    retros: [],
    chief: [],
    chats: {},
  };
}

/** Fill in fields added after a workspace was first saved. Mutates in place. */
function normalize(db: Partial<DB>): DB {
  const base = empty();
  for (const k of Object.keys(base) as (keyof DB)[]) if (db[k] === undefined) (db as Record<string, unknown>)[k] = base[k];
  db.settings = Object.assign(base.settings, db.settings);
  if (db.runs && db.runs.length > 1000) db.runs.splice(0, db.runs.length - 1000);
  return db as DB;
}

export async function read(uid: string): Promise<DB> {
  return normalize((await kv.get<Partial<DB>>(wsKey(uid))) ?? {});
}

/** Locked read-modify-write of one user's workspace. */
export function mutate<T>(uid: string, fn: (db: DB) => T | Promise<T>): Promise<T> {
  return kv.update<Partial<DB>, T>(wsKey(uid), () => ({}), (value) => fn(normalize(value)));
}

// — Users —

export async function listUsers(): Promise<User[]> {
  return (await kv.get<{ users: User[] }>(USERS_KEY))?.users ?? [];
}

export async function getUser(uid: string) {
  return (await listUsers()).find((u) => u.id === uid);
}

/**
 * Find the user behind a provider identity, or create one. When `linkTo` is set the identity is
 * attached to that signed-in user instead (connecting a second subscription).
 */
export function upsertUser(identity: { provider: Provider; subject: string; email?: string }, linkTo?: string): Promise<User> {
  return kv.update<{ users: User[] }, User>(USERS_KEY, () => ({ users: [] }), (data) => {
    const key = `${identity.provider}:${identity.subject}`;
    const at = new Date().toISOString();
    let user = linkTo ? data.users.find((u) => u.id === linkTo) : data.users.find((u) => u.identities.includes(key));
    if (!user) {
      user = { id: nanoid(12), provider: identity.provider, email: identity.email, identities: [], createdAt: at, lastLoginAt: at };
      data.users.push(user);
    }
    // An identity belongs to exactly one user.
    for (const u of data.users) if (u !== user) u.identities = u.identities.filter((i) => i !== key);
    if (!user.identities.includes(key)) user.identities.push(key);
    user.email ??= identity.email;
    user.lastLoginAt = at;
    return user;
  });
}

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
    user: { email: user.email, provider: user.provider },
    settings: {
      ...rest,
      keysSet: Object.fromEntries(PROVIDERS.map((p) => [p.id, Boolean(apiKeys[p.id])])) as Record<Provider, boolean>,
      subscriptions: {
        openai: oauth.openai && { email: oauth.openai.email, sharing: oauth.openai.scopes.includes("chatgpt.tokens.use.direct") },
        xai: oauth.xai && { email: oauth.xai.email },
      },
      isLocal: isLocalServer(),
      integrations: integrations.map(({ headers, ...i }) => ({ ...i, headerNames: Object.keys(headers) })),
    },
  };
}
