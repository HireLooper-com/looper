import "server-only";
import { kv } from "./kv";

// Live "what am I doing" steps for a chat reply or a run, polled by the UI while it waits.
export interface Step {
  at: number;
  text: string;
}

const key = (uid: string, target: string) => `progress:${uid}:${target}`;

export function progressWriter(uid: string, target: string) {
  const steps: Step[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const push = (text: string) => {
    if (!text || steps.at(-1)?.text === text) return;
    steps.push({ at: Date.now(), text });
    const snapshot = steps.slice(-40);
    chain = chain.then(() => kv.set(key(uid, target), snapshot, 3600)).catch(() => undefined);
  };
  return {
    push,
    /** the trail so far, to keep on the run */
    trail: () => steps.map((s) => s.text).filter((t) => t !== "Thinking…" && t !== "Writing the reply…").slice(-40),
    /** Keep the trail briefly so the UI can show the last step, then let it expire. */
    done: () => chain.then(() => kv.set(key(uid, target), steps.slice(-40), 120)).catch(() => undefined),
  };
}

export async function readProgress(uid: string, target: string): Promise<Step[]> {
  return (await kv.get<Step[]>(key(uid, target))) ?? [];
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
