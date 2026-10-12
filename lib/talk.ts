import { sql } from "./db";
import { modelFor, withTools, type LocalTool } from "./llm";
import { READS, runRoutine, toolDef, type Card, type Looper } from "./engine";
import { role as findRole } from "./roles";
import { routineFrom } from "./spec";
import { reflectionContext } from "./reflection";
import { connectableNames, isConnected, runTool, toolkitNames, toolsFor, wsById } from "./tools";
import { cleanDays, slotText, toTurns, type Change, type TalkRow } from "./talk-turns";

// Chat with a looper any day: questions about the metric, cards and routines, answered
// from the same data the reflection reads, plus live reads from connected tools.
// The looper never changes itself here. Asked for a change, it proposes one; a person
// presses Apply. Rule changes become a new routine version, effective at once.

export type { Change, TalkRow };
export type Message = TalkRow & { user_id: number | null; email: string | null; created_at: Date };

type Routine = { id: number; name: string; tool: string; days: number[]; hour: number; mode: "ask" | "auto" };
type Latest = { version: number; rules: string; effective_from: Date };

async function routinesOf(looperId: number) {
  const rs = await sql<Routine>`select id, name, tool, days, hour, mode from routines where looper_id = ${looperId} order by hour, id`;
  return Promise.all(
    rs.map(async (r) => {
      const [v] = await sql<Latest>`
        select version, rules, effective_from from routine_versions where routine_id = ${r.id} order by version desc limit 1`;
      return { ...r, latest: v ?? null };
    }),
  );
}

export async function messages(looperId: number, limit = 60) {
  return sql<Message>`
    select * from (
      select t.id, t.role, t.content, t.changes, t.user_id, t.created_at, u.email from talk t
      left join users u on u.id = t.user_id where t.looper_id = ${looperId} order by t.id desc limit ${limit}
    ) x order by id`;
}

async function context(l: Looper, routines: Awaited<ReturnType<typeof routinesOf>>, names: Record<string, string>, tz: string) {
  const open = await sql<Card>`
    select * from cards where looper_id = ${l.id} and status in ('proposed','approved','running') order by created_at desc limit 20`;
  const pending = routines.filter((r) => r.latest && new Date(r.latest.effective_from) > new Date());
  return [
    `Looper: ${l.name}. Website: ${l.website || "none"}. Brief: ${l.brief || "none yet"}.`,
    await reflectionContext(l),
    "Schedule (founder's time zone):",
    ...routines.map((r) => `- id ${r.id} ${r.name}: ${slotText(r)}, ${r.tool ? names[r.tool] ?? r.tool : "by hand"}`),
    ...pending.map((r) => `Routine ${r.name} has v${r.latest!.version} waiting, from ${new Date(r.latest!.effective_from).toISOString().slice(0, 10)}:\n${r.latest!.rules}`),
    "Open cards now:",
    ...(open.length ? open.map((c) => `- ${c.status}: ${c.title} (${c.tool || "by hand"})`) : ["- none"]),
    `Today: ${new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "full", timeStyle: "short" }).format(new Date())}, ${tz}.`,
  ].join("\n");
}

const SYSTEM = (l: Looper, ctx: string) =>
  [
    `You are ${l.name}, a looper: an AI hire that owns one business metric, ${l.metric_name}. You are in the team chat with the people who hired you.`,
    "Answer from the data below. When a question needs fresh data, call the read tools. Name cards by title and routines by name.",
    "Be brief: 1 to 5 sentences. Every claim is a number, a time or a tool. Plain words, no em dashes, no buzzwords, no filler.",
    "Format: short paragraphs. For 3 or more items, a numbered or - list, one line each, leading with the day or the name. **Bold** only that lead. No headings, no tables.",
    "You never change anything yourself. When asked to change your rules, your schedule, a routine's ask-first setting, the target or the brief,",
    "to add a routine or to run one now, call the matching propose_ tool. The person sees each proposal with an Apply button. Then say in one line what you proposed.",
    "Rules are short `key: value` lines with numbers. propose_rules takes the complete new rule file, starting from the newest version below.",
    "Anything that spends money, sends to a customer or publishes stays a card that asks first. Say so if asked to skip that.",
    "If a request is unclear, ask one question instead of proposing.",
    "",
    ctx,
  ].join("\n");

const routineId = { type: "integer", description: "Routine id from the schedule" };
const why = { type: "string", description: "One sentence: what the person asked or the data that justifies it." };
const daysHour = {
  days: { type: "array", items: { type: "integer" }, description: "0 = Mon ... 6 = Sun" },
  hour: { type: "integer", description: "Local hour, 0 to 23" },
};
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

/** The propose_ tools. Each one validates and adds to `out`; nothing is applied. */
function proposeTools(l: Looper, routines: Awaited<ReturnType<typeof routinesOf>>, slugs: Record<string, string>, out: Change[]): LocalTool[] {
  const byId = new Map(routines.map((r) => [r.id, r]));
  const find = (id: unknown) => {
    const r = byId.get(Number(id));
    if (!r) throw new Error(`No routine with id ${id}. Use an id from the schedule.`);
    return r;
  };
  const hourOf = (h: unknown) => {
    const n = Math.round(Number(h));
    if (!Number.isFinite(n) || n < 0 || n > 23) throw new Error("hour must be 0 to 23");
    return n;
  };
  const daysOf = (d: unknown) => {
    const days = cleanDays(d);
    if (!days.length) throw new Error("days needs at least one day, 0 = Mon ... 6 = Sun");
    return days;
  };
  const done = { ok: "Shown to the person with an Apply button. Not applied yet." };
  const add = (c: Change) => {
    out.push(c);
    return done;
  };
  return [
    {
      name: "propose_rules",
      description: "Propose a new version of one routine's rule file.",
      schema: obj({ routine_id: routineId, rules: { type: "string", description: "The complete new rule file, one `key: value` per line." }, why }),
      run: async (a) => {
        const r = find(a.routine_id);
        const to = String(a.rules ?? "").replace(/\r\n?/g, "\n").trim();
        const from = r.latest?.rules ?? "";
        if (!to) throw new Error("rules is empty");
        if (to === from.trim()) throw new Error("These are the current rules. Nothing to change.");
        return add({ kind: "rules", routine_id: r.id, name: r.name, from_version: r.latest?.version ?? 0, from, to: to.slice(0, 4000), why: String(a.why ?? ""), status: "proposed" });
      },
    },
    {
      name: "propose_schedule",
      description: "Propose new days, hour or mode for one routine. mode ask = cards wait for approval, auto = runs alone.",
      schema: obj({ routine_id: routineId, ...daysHour, mode: { type: "string", enum: ["ask", "auto"] }, why }),
      run: async (a) => {
        const r = find(a.routine_id);
        const to = { days: daysOf(a.days), hour: hourOf(a.hour), mode: a.mode === "auto" ? ("auto" as const) : ("ask" as const) };
        return add({ kind: "schedule", routine_id: r.id, name: r.name, from: { days: r.days, hour: r.hour, mode: r.mode }, to, why: String(a.why ?? ""), status: "proposed" });
      },
    },
    {
      name: "propose_routine",
      description: "Propose a new routine. It starts in ask-first mode.",
      schema: obj({
        name: { type: "string", description: "Starts with a verb, under 40 characters" },
        tool: { type: "string", enum: [...Object.keys(slugs), ""], description: "Toolkit it works in, or empty for work done by hand" },
        ...daysHour,
        rules: { type: "string", description: "3 to 5 lines of `key: value` with numbers" },
        why,
      }),
      run: async (a) => {
        const name = String(a.name ?? "").trim().slice(0, 80);
        const rules = String(a.rules ?? "").trim().slice(0, 4000);
        if (!name || !rules) throw new Error("name and rules are required");
        const tool = slugs[String(a.tool)] ? String(a.tool) : "";
        return add({ kind: "routine", name, tool, days: daysOf(a.days), hour: hourOf(a.hour), rules, why: String(a.why ?? ""), status: "proposed" });
      },
    },
    {
      name: "propose_target",
      description: "Propose a new target value and date for the metric.",
      schema: obj({ target: { type: "number" }, date: { type: "string", description: "YYYY-MM-DD" }, why }),
      run: async (a) => {
        const target = Number(a.target);
        const date = String(a.date ?? "");
        if (!Number.isFinite(target)) throw new Error("target must be a number");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw new Error("date must be YYYY-MM-DD");
        const from = { target: l.target === null ? null : Number(l.target), date: String(l.target_date).slice(0, 10) };
        return add({ kind: "target", from, to: { target, date }, why: String(a.why ?? ""), status: "proposed" });
      },
    },
    {
      name: "propose_brief",
      description: "Propose a new one-sentence brief: what the business sells and to whom. Every routine reads it.",
      schema: obj({ brief: { type: "string" }, why }),
      run: async (a) => {
        const to = String(a.brief ?? "").trim().slice(0, 400);
        if (!to) throw new Error("brief is empty");
        return add({ kind: "brief", from: l.brief, to, why: String(a.why ?? ""), status: "proposed" });
      },
    },
    {
      name: "propose_run",
      description: "Propose running one routine now, outside its schedule. Its cards land on the board.",
      schema: obj({ routine_id: routineId, why }),
      run: async (a) => {
        const r = find(a.routine_id);
        return add({ kind: "run", routine_id: r.id, name: r.name, why: String(a.why ?? ""), status: "proposed" });
      },
    },
  ];
}

/** Read-only tools from the toolkits this looper works in, at most 40. */
async function readTools(l: Looper, routines: Routine[]) {
  const kits = [...new Set([l.metric_source, ...l.tools, ...routines.map((r) => r.tool)])].filter((k) => k && k !== "manual" && k !== "geo");
  const ws = await wsById(l.workspace_id);
  const out: LocalTool[] = [];
  for (const k of kits) {
    if (!(await isConnected(l.workspace_id, k))) continue;
    const ts = await toolsFor(l.workspace_id, k, 30).catch(() => []);
    for (const t of ts.filter((t) => READS.test(t.slug)).slice(0, 12)) out.push(toolDef(t, (a) => runTool(ws, t.slug, a)));
  }
  return out.slice(0, 40);
}

/** Store the person's message, let the looper answer, store the answer with its proposals. */
export async function send(looperId: number, text: string, userId: number, tz: string) {
  const [l] = await sql<Looper>`select * from loopers where id = ${looperId}`;
  const cfg = await modelFor(l.user_id);
  if (!cfg) throw new Error("Connect a model key in Settings first. The looper talks on the workspace owner's key.");
  await sql`insert into talk (looper_id, role, content, user_id) values (${l.id}, 'user', ${text}, ${userId})`;

  const [rows, routines, names, slugs] = await Promise.all([
    messages(l.id, 30),
    routinesOf(l.id),
    toolkitNames(l.workspace_id),
    connectableNames(l.workspace_id),
  ]);
  const changes: Change[] = [];
  const tools = [...proposeTools(l, routines, slugs, changes), ...(await readTools(l, routines))];
  const answer = await withTools(cfg, SYSTEM(l, await context(l, routines, names, tz)), toTurns(rows), tools, 8);
  await sql`insert into talk (looper_id, role, content, changes) values (${l.id}, 'assistant', ${answer}, ${JSON.stringify(changes.slice(0, 6))})`;
}

/**
 * Apply one proposal. The status flips first, so two clicks cannot apply it twice;
 * a failure flips it back. Returns a note for the person, or throws.
 */
export async function apply(talkId: number, i: number, userId: number, email: string) {
  const [row] = await sql<{ looper_id: number; changes: Change[] }>`
    update talk set changes = jsonb_set(jsonb_set(changes, ${[String(i), "status"]}::text[], '"applied"'), ${[String(i), "by"]}::text[], ${JSON.stringify(email)}::jsonb)
    where id = ${talkId} and changes -> ${i}::int ->> 'status' = 'proposed' returning looper_id, changes`;
  if (!row) return "Already handled.";
  const c = row.changes[i];
  try {
    const note = await run(c, row.looper_id, talkId, i, userId);
    await sql`update talk set changes = jsonb_set(changes, ${[String(i), "note"]}::text[], ${JSON.stringify(note)}::jsonb) where id = ${talkId}`;
    return note;
  } catch (e) {
    await sql`update talk set changes = jsonb_set(changes, ${[String(i), "status"]}::text[], '"proposed"') where id = ${talkId}`;
    throw e;
  }
}

export async function dismiss(talkId: number, i: number) {
  await sql`update talk set changes = jsonb_set(changes, ${[String(i), "status"]}::text[], '"dismissed"')
    where id = ${talkId} and changes -> ${i}::int ->> 'status' = 'proposed'`;
}

async function ownRoutine(looperId: number, routineId: number) {
  const [r] = await sql<{ id: number }>`select id from routines where id = ${routineId} and looper_id = ${looperId}`;
  if (!r) throw new Error("That routine no longer exists.");
  return r.id;
}

async function run(c: Change, looperId: number, talkId: number, i: number, userId: number): Promise<string> {
  const source = `chat:${talkId}`;
  switch (c.kind) {
    case "rules": {
      const id = await ownRoutine(looperId, c.routine_id);
      const [v] = await sql<{ n: number }>`select coalesce(max(version), 0)::int as n from routine_versions where routine_id = ${id}`;
      if (v.n !== c.from_version) throw new Error(`${c.name} is on v${v.n} now, this proposal was for v${c.from_version}. Ask the looper again.`);
      await sql`insert into routine_versions (routine_id, version, rules, source, effective_from, created_by)
        values (${id}, ${v.n + 1}, ${c.to}, ${source}, now(), ${userId})`;
      return `${c.name} is on v${v.n + 1} from now.`;
    }
    case "schedule": {
      const id = await ownRoutine(looperId, c.routine_id);
      await sql`update routines set days = ${c.to.days}, hour = ${c.to.hour}, mode = ${c.to.mode} where id = ${id}`;
      return `${c.name}: ${slotText(c.to)}.`;
    }
    case "routine": {
      // A routine from chat makes tool or by-hand cards and is checked back like the role's others.
      const [l] = await sql<{ role: string }>`select role from loopers where id = ${looperId}`;
      const x = routineFrom(findRole(l.role), { tool: c.tool });
      const [r] = await sql<{ id: number }>`
        insert into routines (looper_id, slug, name, tool, days, hour, check_days, check_read, check_tool)
        values (${looperId}, ${`chat-${talkId}-${i}`}, ${c.name}, ${c.tool}, ${c.days}, ${c.hour}, ${x.check_days}, ${x.check_read}, ${x.check_tool})
        on conflict (looper_id, slug) do nothing returning id`;
      if (r) await sql`insert into routine_versions (routine_id, version, rules, source, created_by) values (${r.id}, 1, ${c.rules}, ${source}, ${userId})`;
      return `${c.name} is on the calendar, asks first.`;
    }
    case "target":
      await sql`update loopers set target = ${c.to.target}, target_date = ${c.to.date} where id = ${looperId}`;
      return "Target updated.";
    case "brief":
      await sql`update loopers set brief = ${c.to} where id = ${looperId}`;
      return "Brief updated.";
    case "run": {
      const n = await runRoutine(await ownRoutine(looperId, c.routine_id));
      return n ? `${n} new card${n > 1 ? "s" : ""} on the board.` : "Nothing met the rules this run.";
    }
  }
}
