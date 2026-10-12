import { neon } from "@neondatabase/serverless";

// One client per process. Schema is created lazily on first use, the same
// way the waitlist route does it, so a fresh database needs no migration step.
//
// Hosted on Vercel the client is Neon over HTTP. Any other Postgres (an on-prem
// Bloody enterprise install, local work) goes through node-postgres. The driver
// follows the URL; DATABASE_DRIVER=neon or pg overrides it.
type Client = {
  tag: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;
  query: (text: string) => Promise<unknown>;
};
let client: Promise<Client> | null = null;
let ready: Promise<void> | null = null;

function isNeon(url: string) {
  const d = process.env.DATABASE_DRIVER;
  return d ? d === "neon" : /\.neon\.tech|neon\.build/.test(url);
}

async function pgClient(url: string): Promise<Client> {
  const pg = (await import("pg")).default;
  // Dates stay "2026-10-10" strings and numerics stay strings, the way the Neon client returns them.
  pg.types.setTypeParser(1082, (v: string) => v);
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL || 10) });
  return {
    tag: async (strings, ...values) => {
      const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""), "");
      return (await pool.query(text, values)).rows;
    },
    query: (text) => pool.query(text),
  };
}

function raw() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!client) {
    if (isNeon(url)) {
      const q = neon(url);
      client = Promise.resolve({ tag: (s, ...v) => q(s, ...v) as Promise<unknown[]>, query: (t) => q.query(t) });
    } else {
      client = pgClient(url);
    }
  }
  return client;
}

const SCHEMA = [
  `create table if not exists users (
    id serial primary key,
    email text not null unique,
    pw_hash text,
    tz text not null default 'Europe/Amsterdam',
    plan text not null default 'solo',
    stripe_customer_id text,
    subscription_status text not null default 'none',
    created_at timestamptz not null default now()
  )`,
  // Sign in is by emailed code now; older rows keep their hash, new ones have none.
  `alter table users alter column pw_hash drop not null`,
  `create table if not exists login_codes (
    email text primary key,
    code_hash text not null,
    tz text,
    attempts int not null default 0,
    sent_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`,
  `create table if not exists sessions (
    token_hash text primary key,
    user_id int not null references users(id) on delete cascade,
    expires_at timestamptz not null
  )`,
  `create table if not exists model_keys (
    user_id int primary key references users(id) on delete cascade,
    provider text not null,
    model text not null,
    key_enc text not null,
    key_hint text not null,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists connections (
    user_id int not null references users(id) on delete cascade,
    toolkit text not null,
    account_id text not null,
    status text not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, toolkit)
  )`,
  `create table if not exists loopers (
    id serial primary key,
    user_id int not null references users(id) on delete cascade,
    role text not null,
    name text not null,
    metric_name text not null,
    metric_source text not null,
    metric_hint text not null default '',
    unit text not null default '',
    direction text not null default 'up',
    target numeric not null,
    target_date date not null,
    created_at timestamptz not null default now()
  )`,
  // Onboarding asks for the website once; the planner reads it to write routines.
  `alter table users add column if not exists website text not null default ''`,
  // The model writes routines at hire (lib/plan.ts). plan_status: waiting (no model key yet), planning, ready, failed.
  // A target left empty is set by the looper after the first reading.
  `alter table loopers alter column target drop not null`,
  `alter table loopers add column if not exists website text not null default ''`,
  `alter table loopers add column if not exists brief text not null default ''`,
  `alter table loopers add column if not exists tools text[] not null default '{}'`,
  `alter table loopers add column if not exists prompts jsonb not null default '[]'`,
  `alter table loopers add column if not exists plan_status text not null default 'ready'`,
  `alter table loopers add column if not exists plan_error text`,
  `alter table loopers add column if not exists plan_at timestamptz`,
  // A fired looper keeps its history but drops out of the tick, the team and email.
  `alter table loopers add column if not exists fired_at timestamptz`,
  `create table if not exists metric_points (
    id serial primary key,
    looper_id int not null references loopers(id) on delete cascade,
    value numeric not null,
    note text not null default '',
    taken_at timestamptz not null default now()
  )`,
  `create table if not exists routines (
    id serial primary key,
    looper_id int not null references loopers(id) on delete cascade,
    slug text not null,
    name text not null,
    tool text not null default '',
    days int[] not null,
    hour int not null,
    mode text not null default 'ask',
    last_slot timestamptz,
    created_at timestamptz not null default now(),
    unique (looper_id, slug)
  )`,
  `create table if not exists routine_versions (
    id serial primary key,
    routine_id int not null references routines(id) on delete cascade,
    version int not null,
    rules text not null,
    source text not null,
    effective_from timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (routine_id, version)
  )`,
  `create table if not exists runs (
    id serial primary key,
    routine_id int not null references routines(id) on delete cascade,
    version int not null,
    started_at timestamptz not null default now(),
    finished_at timestamptz,
    status text not null default 'running',
    error text,
    cards int not null default 0
  )`,
  `create table if not exists cards (
    id serial primary key,
    looper_id int not null references loopers(id) on delete cascade,
    routine_id int references routines(id) on delete set null,
    run_id int references runs(id) on delete set null,
    title text not null,
    tool text not null default '',
    detail text not null default '',
    action jsonb,
    status text not null default 'proposed',
    reject_reason text,
    result text,
    metric_before numeric,
    delta numeric,
    attribution text not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    done_at timestamptz
  )`,
  `create index if not exists cards_looper on cards(looper_id, status)`,
  `create table if not exists reflections (
    id serial primary key,
    looper_id int not null references loopers(id) on delete cascade,
    due_on date not null,
    status text not null default 'open',
    messages jsonb not null default '[]',
    proposal jsonb,
    created_at timestamptz not null default now(),
    closed_at timestamptz,
    unique (looper_id, due_on)
  )`,
  // Workspaces (v0.3). A workspace is one product, brand or client with its own tools, loopers and board.
  // Loopers keep user_id = the workspace owner, whose model key and subscription they run on.
  `create table if not exists workspaces (
    id serial primary key,
    owner_id int not null references users(id) on delete cascade,
    name text not null,
    website text not null default '',
    composio_user text,
    created_at timestamptz not null default now()
  )`,
  `create table if not exists members (
    workspace_id int not null references workspaces(id) on delete cascade,
    user_id int not null references users(id) on delete cascade,
    role text not null default 'member',
    created_at timestamptz not null default now(),
    primary key (workspace_id, user_id)
  )`,
  `create table if not exists invites (
    workspace_id int not null references workspaces(id) on delete cascade,
    email text not null,
    invited_by int references users(id) on delete set null,
    created_at timestamptz not null default now(),
    primary key (workspace_id, email)
  )`,
  `create table if not exists ws_connections (
    workspace_id int not null references workspaces(id) on delete cascade,
    toolkit text not null,
    account_id text not null,
    status text not null,
    updated_at timestamptz not null default now(),
    primary key (workspace_id, toolkit)
  )`,
  // Only the first workspace of an owner carries a Composio user name; this keeps parallel requests from creating two.
  `create unique index if not exists workspaces_first on workspaces(owner_id) where composio_user is not null`,
  `alter table loopers add column if not exists workspace_id int references workspaces(id) on delete cascade`,
  // Every account from before workspaces gets one, named after its website, with its loopers and
  // connections moved in. It keeps the Composio user `looper-<id>` so linked accounts still work.
  `insert into workspaces (owner_id, name, website, composio_user)
    select u.id, coalesce(nullif(regexp_replace(u.website, '^https?://', ''), ''), 'My workspace'), u.website, 'looper-' || u.id
    from users u
    where exists (select 1 from loopers l where l.user_id = u.id and l.workspace_id is null)
      and not exists (select 1 from workspaces w where w.owner_id = u.id)`,
  `insert into members (workspace_id, user_id, role) select id, owner_id, 'owner' from workspaces on conflict do nothing`,
  `update loopers l set workspace_id = (select min(w.id) from workspaces w where w.owner_id = l.user_id) where l.workspace_id is null`,
  `insert into ws_connections (workspace_id, toolkit, account_id, status, updated_at)
    select w.id, c.toolkit, c.account_id, c.status, c.updated_at from connections c
    join workspaces w on w.id = (select min(id) from workspaces where owner_id = c.user_id)
    on conflict do nothing`,
  // Who acted, for teams with collaborators.
  // The call that reverses a card's tool call, written by the looper with the card.
  `alter table cards add column if not exists undo jsonb`,
  `alter table cards add column if not exists acted_by int references users(id) on delete set null`,
  `alter table routine_versions add column if not exists created_by int references users(id) on delete set null`,
  `alter table users add column if not exists stripe_subscription_id text`,
  // Email: cards to approve, failed runs, reflection open (notify); Monday progress report (weekly).
  `alter table users add column if not exists notify boolean not null default true`,
  `alter table users add column if not exists weekly boolean not null default true`,
  `alter table users add column if not exists notified_at timestamptz`,
  // Custom connectors (Bloody enterprise, A-team): a REST API described as endpoints, called like a Composio tool.
  `create table if not exists connectors (
    id serial primary key,
    workspace_id int not null references workspaces(id) on delete cascade,
    slug text not null,
    name text not null,
    base_url text not null,
    auth_header text not null default 'Authorization',
    auth_enc text,
    endpoints jsonb not null default '[]',
    created_at timestamptz not null default now(),
    unique (workspace_id, slug)
  )`,
  // Extra AI answer engines for GEO readings, on the founder's own OpenRouter key (engine "openrouter", lib/geo.ts).
  `create table if not exists engine_keys (
    user_id int not null references users(id) on delete cascade,
    engine text not null,
    key_enc text not null,
    key_hint text not null,
    created_at timestamptz not null default now(),
    primary key (user_id, engine)
  )`,
  `create table if not exists mail_log (
    user_id int not null references users(id) on delete cascade,
    kind text not null,
    key text not null,
    sent_at timestamptz not null default now(),
    primary key (user_id, kind, key)
  )`,
  // Chat with a looper (lib/talk.ts). One thread per looper, shared by the workspace. `changes` holds what the
  // looper proposed in that reply (rules, schedule, new routine, target, brief, run now); a person applies each one.
  `create table if not exists talk (
    id serial primary key,
    looper_id int not null references loopers(id) on delete cascade,
    role text not null,
    content text not null default '',
    user_id int references users(id) on delete set null,
    changes jsonb not null default '[]',
    created_at timestamptz not null default now()
  )`,
  `create index if not exists talk_looper on talk(looper_id, id)`,
  // Memory (lib/memory-store.ts). Every row carries its workspace, and the composite keys below make the
  // database refuse a row whose looper belongs to another workspace.
  `create unique index if not exists loopers_id_ws on loopers(id, workspace_id)`,
  // Notes: what the business taught its loopers. Written only after a person approved them; edits are new rows.
  `create table if not exists notes (
    id serial primary key,
    workspace_id int not null references workspaces(id) on delete cascade,
    looper_id int,
    text text not null,
    source_kind text not null,
    source_id int,
    approved_by int references users(id) on delete set null,
    supersedes int references notes(id),
    expires_on date,
    status text not null default 'live',
    created_at timestamptz not null default now(),
    foreign key (looper_id, workspace_id) references loopers(id, workspace_id) on delete cascade
  )`,
  `create index if not exists notes_ws on notes(workspace_id, status)`,
  // Ledger: what a looper tracks (a page, a query, a keyword), written by code from tool reads, never by the model.
  `create table if not exists ledger (
    id serial primary key,
    workspace_id int not null references workspaces(id) on delete cascade,
    looper_id int not null,
    kind text not null,
    key text not null,
    status text not null default 'open',
    card_id int references cards(id) on delete set null,
    data jsonb not null default '{}',
    read_at timestamptz,
    updated_at timestamptz not null default now(),
    unique (looper_id, kind, key),
    foreign key (looper_id, workspace_id) references loopers(id, workspace_id) on delete cascade
  )`,
  // Role specs (lib/roles.ts) copied into each looper. A routine picks from a ledger kind (`input`), acts as a
  // tool call, a pull request or by hand (`action`), and its done cards are read again on `check_days`.
  `alter table routines add column if not exists input text not null default ''`,
  `alter table routines add column if not exists action text not null default 'tool'`,
  `alter table routines add column if not exists check_days int[] not null default '{}'`,
  `alter table routines add column if not exists check_read text not null default ''`,
  `alter table routines add column if not exists check_tool text not null default ''`,
  // A card changes one subject (a page, a campaign) and may answer one ledger row. `ext` holds the pull request.
  `alter table cards add column if not exists subject text not null default ''`,
  `alter table cards add column if not exists source_kind text`,
  `alter table cards add column if not exists source_key text`,
  `alter table cards add column if not exists ext jsonb`,
  `create index if not exists cards_subject on cards(looper_id, subject) where subject <> ''`,
  // What the looper learned at hire, per setup step: { "repo": { "status": "done", "text": "...", "at": "..." } }.
  `alter table loopers add column if not exists setup jsonb not null default '{}'`,
  // When each signal was last read (or tried), so a failing or empty read waits a day: { "query": "2026-10-10T07:00:00Z" }.
  `alter table loopers add column if not exists signals_at jsonb not null default '{}'`,
  // Check-backs: a done card's subject read on day 0 (baseline) and the role's check days after it.
  `create table if not exists checks (
    id serial primary key,
    card_id int not null references cards(id) on delete cascade,
    day int not null,
    status text not null default 'done',
    reading text not null default '',
    verdict text not null default '',
    taken_at timestamptz not null default now(),
    unique (card_id, day)
  )`,
  `create table if not exists waitlist (
    id serial primary key,
    email text not null unique,
    plan text not null,
    ref text,
    created_at timestamptz not null default now()
  )`,
  // The looper builder (/app/new): one row per looper being set up, step by step. Hire turns it into a looper and deletes it.
  `create table if not exists drafts (
    id serial primary key,
    workspace_id int not null references workspaces(id) on delete cascade,
    created_by int not null references users(id) on delete cascade,
    role text not null,
    data jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`,
  // What one card ships, picked in the builder, like "A blog post, shipped as a pull request to GitHub".
  `alter table loopers add column if not exists work text not null default ''`,
  `create table if not exists events (
    id bigserial primary key,
    name text not null,
    props jsonb not null default '{}',
    path text,
    ref text,
    anon text,
    created_at timestamptz not null default now()
  )`,
  // A failing daily metric read: when it started failing (one digest line), the last try (the tick waits 6 hours) and why.
  `alter table loopers add column if not exists metric_failed_at timestamptz`,
  `alter table loopers add column if not exists metric_tried_at timestamptz`,
  `alter table loopers add column if not exists metric_error text`,
];

export async function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      const q = await raw();
      for (const stmt of SCHEMA) await q.query(stmt);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

// Tagged template that makes sure the schema exists first.
export async function sql<T = Record<string, any>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  await ensureSchema();
  return (await (await raw()).tag(strings, ...values)) as T[];
}

export function hasDb() {
  return Boolean(process.env.DATABASE_URL);
}
