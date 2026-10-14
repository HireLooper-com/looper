import "server-only";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { DB, Provider, PublicState, User } from "./types";
import { PROVIDERS } from "./types";

// JSON files keep the app zero-setup: one index of users and one workspace file per user.
// Swap for Postgres when deploying multi-instance.
const DATA_DIR = process.env.GROKLOOPER_DATA_DIR ?? path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const HOST_FILE = path.join(DATA_DIR, "host.json");
const workspaceFile = (uid: string) => path.join(DATA_DIR, "users", `${uid.replace(/[^\w-]/g, "")}.json`);

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
  };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

// One write queue per file so concurrent runs don't clobber each other.
const queues = new Map<string, Promise<unknown>>();
function serialized<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(file) ?? Promise.resolve()).then(fn);
  queues.set(file, next.catch(() => undefined));
  return next;
}

async function loadWorkspace(uid: string): Promise<DB> {
  const db = { ...empty(), ...(await readJson<Partial<DB>>(workspaceFile(uid), {})) } as DB;
  db.settings = { ...empty().settings, ...db.settings };
  return db;
}

export function read(uid: string): Promise<DB> {
  const file = workspaceFile(uid);
  return (queues.get(file) ?? Promise.resolve()).then(() => loadWorkspace(uid));
}

/** Serialized read-modify-write of one user's workspace. */
export function mutate<T>(uid: string, fn: (db: DB) => T | Promise<T>): Promise<T> {
  const file = workspaceFile(uid);
  return serialized(file, async () => {
    const db = await loadWorkspace(uid);
    const result = await fn(db);
    await writeJson(file, db);
    return result;
  });
}

// — Users —

export async function listUsers(): Promise<User[]> {
  return (await readJson<{ users: User[] }>(USERS_FILE, { users: [] })).users;
}

export async function getUser(uid: string) {
  return (await listUsers()).find((u) => u.id === uid);
}

/**
 * Find the user behind a provider identity, or create one. When `linkTo` is set the identity is
 * attached to that signed-in user instead (connecting a second subscription).
 */
export function upsertUser(identity: { provider: Provider; subject: string; email?: string }, linkTo?: string): Promise<User> {
  return serialized(USERS_FILE, async () => {
    const data = await readJson<{ users: User[] }>(USERS_FILE, { users: [] });
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
    await writeJson(USERS_FILE, data);
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
  return serialized(HOST_FILE, async () => {
    const data = await readJson<{ hostId?: string }>(HOST_FILE, {});
    if (data.hostId) return data.hostId;
    const id = `urn:uuid:${randomUUID()}`;
    await writeJson(HOST_FILE, { hostId: id });
    return id;
  });
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
