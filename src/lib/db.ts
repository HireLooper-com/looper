import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DB, Provider, PublicState } from "./types";
import { PROVIDERS } from "./types";

// A single JSON file keeps the app zero-setup. Swap for Postgres when deploying multi-instance.
const DATA_DIR = process.env.GROKLOOPER_DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "db.json");

function empty(): DB {
  return {
    settings: {
      provider: "xai",
      apiKeys: {},
      models: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.defaultModel])) as Record<Provider, string>,
      integrations: [],
    },
    loopers: [],
    cards: [],
    runs: [],
    retros: [],
    chief: [],
  };
}

let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<DB> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const db = { ...empty(), ...JSON.parse(raw) } as DB;
    db.settings = { ...empty().settings, ...db.settings };
    return db;
  } catch {
    return empty();
  }
}

async function save(db: DB) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  await fs.rename(tmp, FILE);
}

export function read(): Promise<DB> {
  return queue.then(load);
}

/** Serialized read-modify-write so concurrent runs don't clobber each other. */
export function mutate<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const db = await load();
    const result = await fn(db);
    await save(db);
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

export function toPublic(db: DB): PublicState {
  const { apiKeys, integrations, ...rest } = db.settings;
  return {
    ...db,
    runs: db.runs.slice(-500),
    settings: {
      ...rest,
      keysSet: Object.fromEntries(PROVIDERS.map((p) => [p.id, Boolean(apiKeys[p.id])])) as Record<Provider, boolean>,
      integrations: integrations.map(({ headers, ...i }) => ({ ...i, headerNames: Object.keys(headers) })),
    },
  };
}
