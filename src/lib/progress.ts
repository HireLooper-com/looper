import "server-only";
import { kv } from "./kv";

// Live "what am I doing" for a chat reply or a run: steps, the reply as it's written, and whether
// it's finished. Polled by the UI through GET routes (never server actions, which queue).
export interface Step {
  at: number;
  text: string;
}

export interface Progress {
  since: number;
  steps: Step[];
  /** the reply so far, while the model writes it */
  draft?: string;
  done: boolean;
  error?: string;
}

/** A piece of background work shown in the rail's Working tray, and as a notice when it ends. */
export interface Job {
  target: string;
  label: string;
  href: string;
  /** notice wording: "Max replied" / "Max couldn't reply" */
  done?: string;
  failed?: string;
  since: number;
  finishedAt?: number;
  ok?: boolean;
  /** what it said when it finished, for the notice */
  note?: string;
}

const key = (uid: string, target: string) => `progress:${uid}:${target}`;
const jobsKey = (uid: string) => `jobs:${uid}`;
const KEEP_FINISHED_MS = 10 * 60_000;
const STALE_MS = 6 * 60_000;

function updateJobs(uid: string, fn: (jobs: Job[]) => Job[]) {
  return kv
    .update<{ jobs: Job[] }, void>(jobsKey(uid), () => ({ jobs: [] }), (box) => {
      const now = Date.now();
      // Drop old notices, and work that died without saying so (the function was cut off).
      box.jobs = fn(box.jobs).filter((j) => (j.finishedAt ? now - j.finishedAt < KEEP_FINISHED_MS : now - j.since < STALE_MS));
    })
    .catch(() => undefined);
}

export function progressWriter(uid: string, target: string, job?: { label: string; href: string; done?: string; failed?: string }) {
  const since = Date.now();
  const state: Progress = { since, steps: [], done: false };
  let chain: Promise<unknown> = Promise.resolve();
  let lastDraftWrite = 0;
  const save = (ttl = 3600) => {
    const snapshot: Progress = { ...state, steps: state.steps.slice(-40) };
    chain = chain.then(() => kv.set(key(uid, target), snapshot, ttl)).catch(() => undefined);
  };
  const push = (text: string) => {
    if (!text || state.steps.at(-1)?.text === text) return;
    state.steps.push({ at: Date.now(), text });
    save();
  };
  save();
  if (job) chain = chain.then(() => updateJobs(uid, (jobs) => [...jobs.filter((j) => j.target !== target), { target, ...job, since }]));
  return {
    since,
    /** resolves once the "working" record and the tray entry are saved */
    ready: () => chain,
    push,
    /** The reply as it's being written; saved a few times a second so the UI can show it growing. */
    text: (soFar: string) => {
      state.draft = soFar;
      if (Date.now() - lastDraftWrite > 350) {
        lastDraftWrite = Date.now();
        save();
      }
    },
    /** the trail so far, to keep on the run */
    trail: () => state.steps.map((s) => s.text).filter((t) => !["Thinking…", "Writing the reply…", "Connecting apps…", "Wrapping up…"].includes(t)).slice(-40),
    /** Mark finished; keep the trail briefly so the UI can catch the end, then let it expire. */
    done: (result?: { ok?: boolean; note?: string; error?: string }) => {
      state.done = true;
      state.draft = undefined;
      if (result?.error) state.error = result.error;
      save(600);
      if (job)
        chain = chain.then(() =>
          updateJobs(uid, (jobs) => jobs.map((j) => (j.target === target ? { ...j, finishedAt: Date.now(), ok: result?.ok ?? !result?.error, note: result?.note ?? result?.error } : j))),
        );
      return chain.catch(() => undefined);
    },
  };
}

export async function readProgress(uid: string, target: string): Promise<Progress | null> {
  const v = await kv.get<Progress | Step[]>(key(uid, target));
  if (!v) return null;
  // Older records were a bare list of steps.
  return Array.isArray(v) ? { since: v[0]?.at ?? 0, steps: v, done: true } : v;
}

/** Background work in progress, plus recently finished work for notices. Each active job carries its latest step. */
export async function readJobs(uid: string) {
  const now = Date.now();
  const jobs = ((await kv.get<{ jobs: Job[] }>(jobsKey(uid)))?.jobs ?? []).filter((j) => (j.finishedAt ? now - j.finishedAt < KEEP_FINISHED_MS : now - j.since < STALE_MS));
  return Promise.all(
    jobs.map(async (j) => {
      if (j.finishedAt) return { ...j, step: undefined };
      const p = await readProgress(uid, j.target);
      return { ...j, step: p?.draft ? "Writing…" : p?.steps.at(-1)?.text };
    }),
  );
}

const APPS: Record<string, string> = {
  GOOGLESHEETS: "Google Sheets",
  GOOGLEDRIVE: "Google Drive",
  GOOGLECALENDAR: "Google Calendar",
  GOOGLEDOCS: "Google Docs",
  GOOGLE: "Google",
  GMAIL: "Gmail",
  STRIPE: "Stripe",
  GITHUB: "GitHub",
  LINKEDIN: "LinkedIn",
  NOTION: "Notion",
  SLACK: "Slack",
  HUBSPOT: "HubSpot",
  BUFFER: "Buffer",
};

const str = (v: unknown, n = 60) => {
  const s = typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

/** A short human sentence for a tool call. */
export function describeTool(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "find_tools":
      return `Looking for tools: “${str(i.query)}”`;
    case "db_describe":
      return "Looking at the database";
    case "db_create":
      return `Creating the database “${str(i.name)}”`;
    case "db_query":
      return i.search ? `Searching the database for “${str(i.search, 40)}”` : "Checking the database";
    case "db_add_rows":
      return `Adding ${Array.isArray(i.rows) ? i.rows.length : "new"} rows to the database`;
    case "db_update_rows":
      return `Updating ${Array.isArray(i.updates) ? i.updates.length : ""} rows in the database`;
    case "db_add_column":
      return `Adding a column “${str(i.name)}”`;
    case "ask_owner":
      return i.kind === "approval" ? "Asking you to approve" : "Asking you a question";
    case "canvas_read":
      return "Looking at the canvas";
    case "canvas_look":
      return "Looking at your images";
    case "canvas_add":
      return `Pinning ${Array.isArray(i.items) && i.items.length > 1 ? `${i.items.length} items` : "an item"} to the canvas`;
    case "canvas_update":
      return "Editing a canvas item";
    case "canvas_remove":
      return "Tidying the canvas";
    case "computer_browse": {
      const t = str(i.target, 60);
      if (i.action === "open") return `Opening ${t.replace(/^https?:\/\//, "")}`;
      const v = str(i.value, 40);
      switch (i.action) {
        case "fill":
        case "type":
          return "Typing into the page"; // never echo the text: it may be a password
        case "click":
          return "Clicking on the page";
        case "select":
          return `Choosing “${v}”`;
        case "press":
          return `Pressing ${t}`;
        case "scroll":
          return `Scrolling ${t === "up" ? "up" : "down"}`;
        case "back":
          return "Going back";
        case "forward":
          return "Going forward";
        case "reload":
          return "Reloading the page";
        case "wait":
          return "Waiting for the page";
        case "look":
          return "Looking at the page";
        default:
          return "Using the browser";
      }
    }
    case "computer_read":
      return "Reading the page";
    case "computer_screenshot":
      return "Looking at the screen";
    case "computer_run":
      return `Running “${str(i.command, 50)}”`;
    case "kanban_list":
      return "Looking at the board";
    case "kanban_add_card":
      return `Adding a card: ${str(i.title)}`;
    case "kanban_move_card":
      return `Moving a card to ${str(i.column)}`;
    case "metric_record":
      return `Logging the metric: ${str(i.value)}`;
    case "update_core_instructions":
      return "Updating core instructions";
    case "save_skill":
      return `Saving the skill “${str(i.name)}”`;
    case "start_skill":
      return `Starting ${str(i.skill)}`;
    case "start_collect":
      return `Starting a job: ${str(i.title)}`;
    case "web_search":
      return `Searching the web for “${str(i.query, 50)}”`;
    case "web_fetch":
      return `Reading ${str(i.url, 60).replace(/^https?:\/\//, "")}`;
    case "playbook_save":
      return `Noting in the playbook: ${str(i.source, 40)} ${i.status === "works" ? "works" : i.status === "fails" ? "doesn't work" : "partly works"}`;
    case "list_loopers":
      return "Checking on the team";
    case "list_integrations":
      return "Checking connected apps";
    case "create_looper":
      return `Hiring ${str(i.name)}`;
    case "update_looper":
      return `Updating ${str(i.looper)}`;
    case "retire_looper":
      return `Retiring ${str(i.looper)}`;
    case "assign_card":
      return `Giving ${str(i.looper)} a card: ${str(i.title)}`;
    case "run_skill":
      return `Running ${str(i.looper)} · ${str(i.skill)}`;
    case "read_database":
      return `Reading ${str(i.looper)}'s database`;
    case "fill_database":
      return `Asking ${str(i.looper)} to fill the database`;
  }
  // Composio-style slugs: GOOGLESHEETS_BATCH_GET → "Google Sheets: batch get"
  const m = name.match(/^(?:[a-z0-9_]+__)?([A-Z0-9]+)_([A-Z0-9_]+)$/);
  if (m) return `${APPS[m[1]] ?? m[1][0] + m[1].slice(1).toLowerCase()}: ${m[2].replace(/_/g, " ").toLowerCase()}`;
  return `Using ${name.replace(/[_-]+/g, " ")}`;
}
