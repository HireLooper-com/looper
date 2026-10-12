import { repoFor, type SetupEntry } from "./brief";
import { sql } from "./db";
import type { Tool } from "./composio";
import { githubFor, isConnected, runTool, toolkitNames, toolsFor, wsById } from "./tools";
import { json, modelFor, withTools, type LocalTool, type ModelConfig } from "./llm";
import { attribute, autoTargetFor } from "./attribution";
import { enginesFor } from "./geo";
import { sitePages } from "./pages";
import { ledger, notes } from "./memory";
import type { LedgerRow } from "./memory-store";
import { role as findRole, type ActionKind } from "./roles";
import { domainOf, existingPage, guard, limitsOf, prProblems, prRules, topDomains } from "./spec";
import { closePR, openPR, prState, PR_SLUG, readTools, type PrArgs } from "./publish";

export type Looper = {
  id: number;
  user_id: number; // the workspace owner: their model key and subscription
  workspace_id: number;
  role: string;
  name: string;
  metric_name: string;
  metric_source: string;
  metric_hint: string;
  unit: string;
  direction: "up" | "down";
  target: string | null;
  target_date: string;
  created_at: Date;
  website: string;
  brief: string;
  tools: string[];
  prompts: string[];
  plan_status: "waiting" | "planning" | "ready" | "failed";
  plan_error: string | null;
  setup: Record<string, SetupEntry>;
  signals_at: Record<string, string>;
  work: string; // what one card ships, picked in the builder
  repo: string; // owner/name pull requests go to, picked by a person; "" falls back to the notes from hire (repoFor)
  fired_at: Date | null;
  metric_failed_at?: Date | null; // when the daily read started failing; cleared by the next reading
  metric_tried_at?: Date | null; // the last failed try; the tick waits 6 hours after it
  metric_error?: string | null;
};

export type Card = {
  id: number;
  looper_id: number;
  routine_id: number | null;
  title: string;
  tool: string;
  detail: string;
  action: { tool_slug: string; arguments: Record<string, unknown> } | null;
  undo: { tool_slug: string; arguments: Record<string, unknown> } | null;
  status: "proposed" | "approved" | "running" | "done" | "rejected" | "failed" | "reverted";
  acted_by: number | null;
  reject_reason: string | null;
  result: string | null;
  delta: string | null;
  attribution: "pending" | "attributed" | "unattributed";
  created_at: Date;
  done_at: Date | null;
  subject: string;
  source_kind: string | null;
  source_key: string | null;
  ext: { pr?: { repo: string; number: number; url: string; branch: string; merge_sha?: string; ci?: string } } | null;
};

/** What a card does on approval, from its action. */
export const kindOf = (a: Card["action"]): ActionKind => (!a ? "manual" : a.tool_slug === PR_SLUG ? "github_pr" : "tool");

export const toolDef = (t: Tool, run: (args: Record<string, unknown>) => Promise<unknown>): LocalTool => ({
  name: t.slug,
  description: (t.description || t.name).slice(0, 1000),
  schema: (t.input_parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
  run,
});

/** Tool slugs that only read data. */
export const READS = /(_GET|_LIST|_SEARCH|_RUN_QUERY|_REPORT|_FETCH)/i;

/** Rules that apply to a routine right now: the newest version whose effective date has passed. */
export async function liveRules(routineId: number) {
  const [v] = await sql<{ version: number; rules: string }>`
    select version, rules from routine_versions
    where routine_id = ${routineId} and effective_from <= now()
    order by version desc limit 1`;
  return v;
}

export async function latestMetric(looperId: number) {
  const [p] = await sql<{ value: string; taken_at: Date }>`
    select value, taken_at from metric_points where looper_id = ${looperId} order by taken_at desc limit 1`;
  return p ?? null;
}

/* ---------------- metric ---------------- */

/** Store a reading and attribute the cards that finished since the previous one. */
export async function recordMetric(looperId: number, value: number, note = "") {
  const prev = await latestMetric(looperId);
  const [p] = await sql<{ taken_at: Date }>`
    insert into metric_points (looper_id, value, note) values (${looperId}, ${value}, ${note}) returning taken_at`;
  await sql`update loopers set metric_failed_at = null, metric_tried_at = null, metric_error = null where id = ${looperId} and metric_failed_at is not null`;
  const done = await sql<{ id: number }>`
    select id from cards where looper_id = ${looperId} and status = 'done' and attribution = 'pending'
      and done_at <= ${p.taken_at}`;
  await autoTarget(looperId, value);
  const a = attribute(done.map((d) => d.id), prev ? Number(prev.value) : null, value);
  if (a.attributed) await sql`update cards set attribution = 'attributed', delta = ${a.attributed.delta} where id = ${a.attributed.id}`;
  if (a.unattributed.length) await sql`update cards set attribution = 'unattributed' where id = any(${a.unattributed})`;
}

async function autoTarget(looperId: number, value: number) {
  const [l] = await sql<{ target: string | null; direction: string }>`select target, direction from loopers where id = ${looperId}`;
  if (!l || l.target !== null) return;
  await sql`update loopers set target = ${autoTargetFor(value, l.direction)} where id = ${looperId} and target is null`;
}

/** The brand as it shows up in an answer: "timetuna" for https://www.timetuna.com/pricing. */
export function brandOf(website: string) {
  try {
    const host = new URL(/^https?:\/\//.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "");
    return host.split(".")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  } catch {
    return "";
  }
}

/**
 * Ask each buyer question in every answer engine the founder has a key for, with web search.
 * Every answer lands in the ledger (kind ai_answer, keyed by the question): which engines name
 * the site and which URLs they cite instead. Returns which questions at least one answer names.
 */
export async function askBuyerQuestions(looper: Looper, cfg: ModelConfig) {
  const brand = brandOf(looper.website);
  if (brand.length < 3) throw new Error("Add your website in Settings first");
  const qs = (looper.prompts ?? []).slice(0, 10);
  if (!qs.length) throw new Error("The looper writes its 10 buyer questions when it plans its week");
  const engines = await enginesFor(looper.user_id, cfg);
  const named = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "").includes(brand);
  const own = domainOf(looper.website);
  const perEngine = await Promise.all(
    engines.map((e) =>
      Promise.all(qs.map((q) => e.ask(q).then((a) => ({ named: named(a.text), urls: a.urls }), () => ({ named: false, urls: [] as string[] })))),
    ),
  );
  const hits = qs.map((_, i) => perEngine.some((h) => h[i].named));
  const readAt = new Date();
  for (const [i, q] of qs.entries()) {
    const urls = perEngine.flatMap((h) => h[i].urls);
    await ledger.upsert(
      looper.workspace_id,
      looper.id,
      "ai_answer",
      q,
      {
        named_by: engines.filter((_, j) => perEngine[j][i].named).map((e) => e.name),
        engines: engines.map((e) => e.name),
        cited: topDomains(urls, own),
        urls: [...new Set(urls)].filter((u) => domainOf(u) !== own).slice(0, 10),
      },
      readAt,
    );
  }
  const by = engines.map((e, j) => `${e.name} ${perEngine[j].filter((x) => x.named).length}`).join(", ");
  return { qs, hits, brand, by };
}

/** GEO reading: the number of buyer questions where at least one answer names the site. */
async function readGeo(looper: Looper, cfg: ModelConfig) {
  const { qs, hits, brand, by } = await askBuyerQuestions(looper, cfg);
  const value = hits.filter(Boolean).length;
  const which = qs.filter((_, i) => hits[i]).map((q) => `"${q.slice(0, 60)}"`);
  await recordMetric(looper.id, value, `${value} of ${qs.length} questions name ${brand} (${by})${which.length ? `: ${which.join(", ")}` : ""}`.slice(0, 900));
  return value;
}

/** Read the metric from its connected tool. The model picks the tool call; we keep only the number. */
export async function readMetric(looper: Looper, cfg?: ModelConfig | null) {
  if (looper.metric_source === "manual") return null;
  cfg ??= await modelFor(looper.user_id);
  if (!cfg) throw new Error("Connect a model first");
  if (looper.metric_source === "geo") return readGeo(looper, cfg);
  const { value, note } = await measureMetric(looper, cfg);
  await recordMetric(looper.id, value, note);
  return value;
}

/** One reading from the metric's tool, not stored. The builder's test run shows it before hire. */
export async function measureMetric(looper: Looper, cfg: ModelConfig) {
  const names = await toolkitNames(looper.workspace_id);
  if (!(await isConnected(looper.workspace_id, looper.metric_source)))
    throw new Error(`Connect ${names[looper.metric_source] ?? looper.metric_source} first`);
  const ws = await wsById(looper.workspace_id);
  const tools = (await toolsFor(looper.workspace_id, looper.metric_source)).map((t) => toolDef(t, (a) => runTool(ws, t.slug, a)));
  const out = await withTools(
    cfg,
    "You read one business metric from a connected tool. Only read data. Never change anything.",
    [
      `Metric: ${looper.metric_name}`,
      looper.website && `Website: ${looper.website}`,
      looper.metric_hint && `How to compute it: ${looper.metric_hint}`,
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      "Call the tools you need, then end your reply with one line: VALUE: <number> (digits and a decimal point only, no unit).",
    ]
      .filter(Boolean)
      .join("\n"),
    tools,
    8,
  );
  // Tolerate "VALUE: **12,345**" and similar; commas are thousands separators.
  const m = out.match(/VALUE:[\s*`]*(-?\d[\d,]*(?:\.\d+)?)/i);
  const value = m ? Number(m[1].replace(/,/g, "")) : NaN;
  if (!Number.isFinite(value)) {
    console.error(`readMetric looper ${looper.id}: no VALUE line in reply:\n${out}`);
    const said = out.replace(/\s+/g, " ").trim();
    throw new Error(
      said
        ? `The model did not return a number. It said: ${said.length > 600 ? "…" + said.slice(-600) : said}`
        : "The model did not return a number. Its reply was empty.",
    );
  }
  return { value, note: "read from " + (names[looper.metric_source] ?? looper.metric_source) };
}

/* ---------------- routines ---------------- */

const CARDS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cards"],
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "subject", "source_key", "tool_slug", "arguments_json", "undo_tool_slug", "undo_arguments_json"],
        properties: {
          title: { type: "string", description: "Starts with a verb, names the count and the tool. Under 70 characters." },
          detail: {
            type: "string",
            description: "Why this moves the metric, with the numbers you used. A card with no tool call adds the whole deliverable after that, ready to ship.",
          },
          subject: { type: "string", description: "The one thing this card changes, as described in the context, or empty for a report." },
          source_key: { type: "string", description: "The exact key of the ledger row this card acts on, or empty." },
          tool_slug: { type: "string", description: "Exact tool slug to execute on approval, or empty if the founder does it by hand." },
          arguments_json: { type: "string", description: "JSON object of arguments for tool_slug, or {}." },
          undo_tool_slug: {
            type: "string",
            description: "Exact tool slug that reverses tool_slug (enable what was paused, remove what was added), or empty if it cannot be undone.",
          },
          undo_arguments_json: { type: "string", description: "JSON object of arguments for undo_tool_slug, or {}." },
        },
      },
    },
  },
};

const PR_HOW = [
  `Cards that change the website use tool_slug ${PR_SLUG}: approving one opens a pull request, and merging it publishes the change.`,
  `Its arguments_json: {"repo": "owner/name", "title": "...", "body": "what changes and why, with the numbers", "files": [...]}.`,
  `A file is {"path": "...", "content": "the whole new file"} for a new page, or {"path": "...", "edits": [{"find": "exact text that occurs once in the current file", "replace": "new text"}]} for a change to an existing one.`,
  "Read the current file with github_read before writing edits, and copy the find text exactly. One page per card. Leave the undo fields empty: the old files are kept when the pull request opens.",
  "Follow the notes from hire for folders, frontmatter and files to leave alone.",
].join("\n");
const prRepo = (repo: string) => `Repository: ${repo}. Every pull request goes to ${repo} and no other; put it in "repo".`;

// A by-hand card is the deliverable itself, so the founder ships it without rewriting anything.
const BY_HAND =
  "A by-hand card carries the whole deliverable in its detail: the full text of a page or post, the email as it will be sent, the exact settings to change. Never only a plan of what to write. Never say you will write it later.";

export type RoutineRow = { id: number; name: string; tool: string; mode: string; looper_id: number; input: string; action: ActionKind };

/** Past cards with their check-backs, for the routine and the reflection. */
export async function cardHistory(looperId: number, limit = 25) {
  const cards = await sql<Card & { checks: { day: number; reading: string; verdict: string }[] | null }>`
    select c.*, (select json_agg(json_build_object('day', k.day, 'reading', k.reading, 'verdict', k.verdict) order by k.day)
                 from checks k where k.card_id = c.id and k.status = 'done') as checks
    from cards c where c.looper_id = ${looperId} and c.status in ('done','rejected','reverted')
    order by c.updated_at desc limit ${limit}`;
  return cards;
}

export const checkLine = (k: { day: number; reading: string; verdict: string }) =>
  `day ${k.day}: ${k.reading}${k.verdict && k.verdict !== "baseline" ? ` (${k.verdict})` : ""}`;

type PlanRows = Pick<LedgerRow, "key" | "status" | "data">[];

/**
 * Plan one routine's cards from the rules, the ledger, the gap and past feedback. Saves nothing:
 * runRoutine stores the cards, and the builder's test run only shows them. `rows` replaces the
 * ledger, for a looper not hired yet.
 */
export async function planCards(looper: Looper, r: RoutineRow, rules: { version: number; rules: string } | null, cfg: ModelConfig, given?: PlanRows) {
  const role = findRole(looper.role);
  const limits = limitsOf(role);
  const wsId = looper.workspace_id;

  const points = await sql<{ value: string; taken_at: Date }>`
    select value, taken_at from metric_points where looper_id = ${looper.id} order by taken_at desc limit 14`;
  const history = await cardHistory(looper.id);
  const locked = await sql<{ subject: string }>`
    select distinct subject from cards where looper_id = ${looper.id} and subject <> ''
      and status not in ('rejected','failed') and created_at > now() - make_interval(days => ${limits.cooldownDays})`;
  const used = await sql<{ kind: ActionKind; n: number }>`
    select case when action is null then 'manual' when action->>'tool_slug' = ${PR_SLUG} then 'github_pr' else 'tool' end as kind, count(*)::int as n
    from cards where looper_id = ${looper.id} and status <> 'rejected' and created_at > now() - interval '7 days' group by 1`;
  const learned = await notes.live(wsId, looper.id, 20);
  const rows: PlanRows = given ?? (r.input ? await ledger.list(wsId, looper.id, r.input, 60) : []);
  const signal = role?.signals?.find((x) => x.kind === r.input);
  // Other ledger kinds the role matches its input against, like invoices and payouts for a bank transaction.
  const evidence = given
    ? []
    : await Promise.all(
        (role?.evidence ?? [])
          .filter((k) => k !== r.input)
          .map(async (kind) => ({ kind, signal: role?.signals?.find((x) => x.kind === kind), rows: await ledger.list(wsId, looper.id, kind, 60) })),
      );

  // Tools: read tools for context and action tools for cards. A pull request routine reads the repository
  // instead, plus the toolkit its input signal comes from, so it sees the item behind a ledger row.
  const ws = await wsById(wsId);
  const names = await toolkitNames(wsId);
  let tools: Tool[] = [];
  let reads: LocalTool[] = [];
  // Pull requests go to the one repository a person picked or confirmed; with none, the cards are by hand.
  const repo = r.action === "github_pr" ? repoFor(looper) : "";
  const github = r.action === "github_pr" && (await isConnected(wsId, "github"));
  const pr = github && Boolean(repo);
  // A pull request routine also reads the data it picks pages from: its signal's tool, or its own, like Search Console.
  const data = signal && signal.tool !== "geo" ? signal.tool : r.tool;
  const source = pr && data && data !== "geo" && data !== "github" && (await isConnected(wsId, data)) ? data : "";
  if (pr) {
    reads = readTools(await githubFor(ws), repo);
    if (source)
      reads.push(...(await toolsFor(wsId, source, 30)).filter((t) => READS.test(t.slug)).map((t) => toolDef(t, (a) => runTool(ws, t.slug, a))));
  } else if (await isConnected(wsId, r.tool)) {
    tools = await toolsFor(wsId, r.tool, 30);
    reads = tools.filter((t) => READS.test(t.slug)).map((t) => toolDef(t, (a) => runTool(ws, t.slug, a)));
  }

  const setup = Object.entries(looper.setup ?? {}).filter(([, v]) => v.status === "done");
  // Pages already published, so a routine improves one instead of writing it twice.
  const pages = role?.sitePages && looper.website ? await sitePages(looper.website) : [];
  const path = (u: string) => u.replace(/^https?:\/\/[^/]+/, "") || "/";
  const context = [
    `Looper: ${looper.name}. Metric: ${looper.metric_name}. Target: ${looper.target === null ? "set after the first reading" : `${Number(looper.target)}${looper.unit}`} by ${String(looper.target_date).slice(0, 10)}. Higher is ${looper.direction === "up" ? "better" : "worse"}.`,
    looper.website && `Website: ${looper.website}`,
    looper.brief && `What the business does: ${looper.brief}`,
    setup.length && `What you learned at hire:\n${setup.map(([k, v]) => `## ${k}\n${v.text}`).join("\n")}`,
    learned.length && `What the team told you:\n${learned.map((n) => `- ${n.text}`).join("\n")}`,
    `Readings, newest first: ${points.map((p) => `${Number(p.value)} (${new Date(p.taken_at).toISOString().slice(0, 10)})`).join(", ") || "none yet"}`,
    `Routine: ${r.name}, rules v${rules?.version ?? 0}:\n${rules?.rules ?? ""}`,
    looper.work && `Unit of work: ${looper.work}. Each card is one of these.`,
    role?.subject && `Each card changes one ${role.subject.kind}; put ${role.subject.key} in subject.`,
    locked.length && `Changed in the last ${limits.cooldownDays} days, leave these alone: ${locked.map((x) => x.subject).join(", ")}`,
    pages.length &&
      `Pages already on the site (${pages.length}, from its sitemap). Never write a new page on a topic one of these covers; improve that page with edits instead:\n${pages
        .slice(0, 400)
        .map(path)
        .join("\n")}`,
    r.input &&
      (rows.length
        ? `Ledger, ${r.input}${signal ? ` (one row per ${signal.key})` : ""}, as last read. Put the key of the row a card acts on in source_key:\n${rows
            .map((x) => `- ${x.key} [${x.status}] ${JSON.stringify(x.data).slice(0, 400)}`)
            .join("\n")}`
        : `The ledger has no ${r.input} rows yet. They are read once a day; propose nothing that needs them.`),
    ...evidence
      .filter((e) => e.rows.length)
      .map(
        (e) =>
          `Ledger, ${e.kind}${e.signal ? ` (one row per ${e.signal.key})` : ""}, to match against:\n${e.rows.map((x) => `- ${x.key} ${JSON.stringify(x.data).slice(0, 400)}`).join("\n")}`,
      ),
    "Past cards and what happened:",
    ...history.map((c) =>
      c.status === "rejected"
        ? `- REJECTED "${c.title}"${c.reject_reason ? `: ${c.reject_reason}` : ""}`
        : `- ${c.status === "reverted" ? "UNDONE" : "DONE"} "${c.title}"${c.subject ? ` [${c.subject}]` : ""} ${c.attribution === "attributed" ? `delta ${Number(c.delta)}` : "unattributed"}${
            c.checks?.length ? `; ${c.checks.map(checkLine).join("; ")}` : ""
          }`,
    ),
    pr
      ? [PR_HOW, prRepo(repo), prRules(limits.pr)].filter(Boolean).join("\n")
      : github
        ? `No repository is picked for pull requests yet. Write by-hand cards and leave tool_slug empty. ${BY_HAND}`
        : r.action === "github_pr"
        ? `GitHub is not connected. Write by-hand cards and leave tool_slug empty. ${BY_HAND}`
        : tools.length
          ? `Tools you may put on a card (executed only after approval):\n${tools.map((t) => `- ${t.slug}: ${(t.description || t.name).slice(0, 160)}`).join("\n")}\nA card with no tool call is done by hand. ${BY_HAND}`
          : `No tools are connected for ${names[r.tool] ?? r.tool}. Write cards the founder does by hand and leave tool_slug empty. ${BY_HAND}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Look at the data first when read tools exist, then plan cards from what was found.
  let findings = "";
  if (reads.length) {
    findings = await withTools(
      cfg,
      pr
        ? [
            "You gather what a routine needs from the repository. Only read.",
            source &&
              (signal
                ? `Read the ledger rows you would act on in ${names[source] ?? source} first, for the detail the ledger lacks.`
                : `Read the numbers the routine rules ask for in ${names[source] ?? source} first.`),
            `Read ${repo} only. Report the numbers, the files that matter and, for each file you would change, the exact current text of the lines to change.`,
          ]
            .filter(Boolean)
            .join(" ")
        : "You gather numbers for a routine. Only call read tools. Summarise what you found in under 200 words with the numbers.",
      context,
      reads,
      pr ? (source ? 16 : 10) : 6,
    );
  }

  const out = await json<{
    cards: {
      title: string;
      detail: string;
      subject: string;
      source_key: string;
      tool_slug: string;
      arguments_json: string;
      undo_tool_slug: string;
      undo_arguments_json: string;
    }[];
  }>(
    cfg,
    [
      "You are a looper: an AI hire that owns one business metric. You propose work as cards; the founder approves each one.",
      "Follow the routine rules exactly. Propose 0 to 5 cards. Zero is fine when nothing meets the rules.",
      "Do not repeat a card the founder rejected for the same reason. Learn from the check-backs on past cards: repeat what kept, avoid what was undone.",
      "Card titles start with a verb and contain a number, like: Pause 6 keywords under 1x ROAS.",
      "For every tool call, name the call that reverses it when one exists, so the founder can undo the card.",
    ].join("\n"),
    context + (findings ? `\n\nWhat the data shows:\n${findings}` : ""),
    "cards",
    CARDS_SCHEMA,
  );

  const valid = new Set([...tools.map((t) => t.slug), ...(pr ? [PR_SLUG] : [])]);
  const call = (slug: string, args: string): Card["action"] => {
    if (!slug || !valid.has(slug)) return null;
    try {
      const a = JSON.parse(args || "{}");
      if (slug === PR_SLUG && !(Array.isArray(a.files) && a.files.length)) return null;
      // The model only read the picked repo, so its files belong there whatever it wrote in "repo".
      return { tool_slug: slug, arguments: slug === PR_SLUG ? { ...a, repo } : a };
    } catch {
      return null;
    }
  };
  const drafts = out.cards.slice(0, 5).map((c) => {
    let action = call(c.tool_slug, c.arguments_json);
    let detail = c.detail;
    // A pull request outside the role's limits becomes a by-hand card that keeps the plan.
    const problems = action?.tool_slug === PR_SLUG ? prProblems((action.arguments as PrArgs).files, limits.pr) : [];
    if (problems.length) {
      action = null;
      detail = `${detail}\n\nNot opened as a pull request: ${problems.join("; ")}.`;
    }
    const undo = action && action.tool_slug !== PR_SLUG ? call(c.undo_tool_slug, c.undo_arguments_json) : null;
    const row = rows.find((x) => x.key === c.source_key.trim());
    return { ...c, detail, title: c.title.slice(0, 140), subject: c.subject.trim().slice(0, 500), action, undo, kind: kindOf(action), source: row };
  });
  // A new page whose URL words match a published page is that page written twice.
  const repeats: { title: string; why: string }[] = [];
  const fresh = drafts.filter((d) => {
    if (d.action?.tool_slug !== PR_SLUG) return true;
    const files = ((d.action.arguments as PrArgs).files ?? []) as { path: string; content?: string }[];
    const hit = files.filter((f) => typeof f.content === "string").map((f) => existingPage(f.path, pages)).find(Boolean);
    if (hit) repeats.push({ title: d.title, why: `already on the site: ${path(hit)}` });
    return !hit;
  });
  const guarded = guard(fresh, { locked: new Set(locked.map((x) => x.subject)), used: Object.fromEntries(used.map((u) => [u.kind, u.n])), limits, mode: r.mode });
  const { keep } = guarded;
  const dropped = [...repeats, ...guarded.dropped];
  return { keep, dropped, findings, rows, pr, repo, pages: pages.length, tool: names[pr ? "github" : r.tool] ?? r.tool, toolConnected: pr || tools.length > 0, readCount: reads.length };
}

/** Run one routine: plan its cards and put them on the board. */
export async function runRoutine(routineId: number) {
  const [r] = await sql<RoutineRow>`
    select id, name, tool, mode, looper_id, input, action from routines where id = ${routineId}`;
  const [looper] = await sql<Looper>`select * from loopers where id = ${r.looper_id}`;
  if (looper.fired_at) return 0;
  const rules = await liveRules(r.id);
  const [run] = await sql<{ id: number }>`
    insert into runs (routine_id, version) values (${r.id}, ${rules?.version ?? 0}) returning id`;
  try {
    const cfg = await modelFor(looper.user_id);
    if (!cfg) throw new Error("No model connected");
    const { keep, dropped, tool, pr } = await planCards(looper, r, rules, cfg);
    const wsId = looper.workspace_id;

    // Fired while the model was writing: the cards go nowhere.
    const [fired] = await sql`select 1 from loopers where id = ${looper.id} and fired_at is not null`;
    if (fired) throw new Error("Looper fired during the run");
    for (const c of keep) {
      const [card] = await sql<{ id: number }>`
        insert into cards (looper_id, routine_id, run_id, title, tool, detail, action, undo, status, subject, source_kind, source_key)
        values (${looper.id}, ${r.id}, ${run.id}, ${c.title}, ${tool},
                ${c.detail}, ${c.action ? JSON.stringify(c.action) : null}, ${c.undo ? JSON.stringify(c.undo) : null}, ${c.status},
                ${c.subject}, ${c.source ? r.input : null}, ${c.source?.key ?? null})
        returning id`;
      if (c.source) await ledger.setStatus(wsId, looper.id, r.input, c.source.key, "carded", card.id);
      if (c.status === "approved" && c.action) await executeCard(card.id);
    }
    const note = dropped.length ? `Held back: ${dropped.map((d) => `${d.title} (${d.why})`).join("; ")}`.slice(0, 1000) : null;
    await sql`update runs set status = 'done', finished_at = now(), cards = ${keep.length}, error = ${note} where id = ${run.id}`;
    return keep.length;
  } catch (e) {
    await sql`update runs set status = 'failed', finished_at = now(), error = ${String((e as Error).message)} where id = ${run.id}`;
    throw e;
  }
}

/* ---------------- cards ---------------- */

/**
 * Execute an approved card's action. A tool call runs and the card is done. A pull request opens
 * and the card waits in Running until the PR is merged (syncPullRequests). Cards without an
 * action wait for the founder to mark them done.
 */
export async function executeCard(cardId: number) {
  const [c] = await sql<Card & { workspace_id: number; role: string; looper_repo: string; looper_setup: Looper["setup"] }>`
    update cards set status = 'running', updated_at = now()
    from loopers l
    where cards.id = ${cardId} and cards.status = 'approved' and cards.action is not null and l.id = cards.looper_id
    returning cards.*, l.workspace_id, l.role, l.repo as looper_repo, l.setup as looper_setup`;
  if (!c) return;
  const ws = await wsById(c.workspace_id);
  try {
    if (c.action!.tool_slug === PR_SLUG) {
      const a = c.action!.arguments as PrArgs;
      const repo = repoFor({ repo: c.looper_repo, setup: c.looper_setup });
      if (a.repo !== repo) throw new Error(`Not opened: this card targets ${a.repo || "no repository"}, and ${repo ? `this looper ships to ${repo}` : "no repository is picked yet"}. Set it on the Brief tab.`);
      const pr = await openPR(await githubFor(ws), a, limitsOf(findRole(c.role)));
      const undo = { tool_slug: PR_SLUG, arguments: { repo: pr.repo, title: `Undo: ${c.title}`.slice(0, 200), body: `Puts back the files changed by ${pr.url}.`, files: pr.previous } };
      await sql`update cards set updated_at = now(), undo = ${JSON.stringify(undo)},
        ext = ${JSON.stringify({ pr: { repo: pr.repo, number: pr.number, url: pr.url, branch: pr.branch } })},
        result = ${`Pull request opened: ${pr.url}. The card is done when it is merged.`} where id = ${c.id}`;
      return;
    }
    const before = await latestMetric(c.looper_id);
    const data = await runTool(ws, c.action!.tool_slug, c.action!.arguments);
    await sql`update cards set status = 'done', done_at = now(), updated_at = now(),
      metric_before = ${before ? Number(before.value) : null},
      result = ${JSON.stringify(data).slice(0, 4000)} where id = ${c.id}`;
  } catch (e) {
    await sql`update cards set status = 'failed', updated_at = now(), result = ${String((e as Error).message)} where id = ${c.id}`;
  }
}

/**
 * Pull request cards in Running: merged means done at the merge time, once CI on the merge commit
 * has finished (at most 2 hours of waiting). A merge whose CI failed is done but claims no metric
 * change, and its ledger row is lost. Closed without a merge means rejected, and the ledger row
 * it answered opens again.
 */
export async function syncPullRequests(limit = 30) {
  const cards = await sql<Card & { workspace_id: number }>`
    select c.*, l.workspace_id from cards c join loopers l on l.id = c.looper_id
    where c.status = 'running' and c.ext ? 'pr' order by c.updated_at limit ${limit}`;
  const log: string[] = [];
  for (const c of cards) {
    const pr = c.ext!.pr!;
    try {
      const st = await prState(await githubFor(await wsById(c.workspace_id)), pr.repo, pr.number);
      if (st.state === "merged" && st.ci === "pending" && Date.now() - new Date(st.mergedAt!).getTime() < 2 * 3600e3) {
        await sql`update cards set updated_at = now() where id = ${c.id}`;
        log.push(`card ${c.id} merged, CI running`);
      } else if (st.state === "merged") {
        const before = await latestMetric(c.looper_id);
        const failed = st.ci === "failure";
        const ext = { ...c.ext, pr: { ...pr, merge_sha: st.mergeSha, ci: st.ci } };
        await sql`update cards set status = 'done', done_at = ${st.mergedAt}, updated_at = now(), ext = ${JSON.stringify(ext)},
          attribution = case when ${failed} then 'unattributed' else attribution end,
          metric_before = ${before ? Number(before.value) : null},
          result = ${failed ? `Merged, but CI failed on ${st.mergeSha?.slice(0, 7)}: ${pr.url}` : `Merged: ${pr.url}`} where id = ${c.id} and status = 'running'`;
        if (c.source_kind && c.source_key)
          await ledger.setStatus(c.workspace_id, c.looper_id, c.source_kind, c.source_key, failed ? "lost" : "done", c.id);
        log.push(`card ${c.id} merged${failed ? ", CI failed" : ""}`);
      } else if (st.state === "closed") {
        await sql`update cards set status = 'rejected', updated_at = now(), reject_reason = 'Pull request closed without merging'
          where id = ${c.id} and status = 'running'`;
        await reopenSource(c);
        log.push(`card ${c.id} closed`);
      } else {
        await sql`update cards set updated_at = now() where id = ${c.id}`;
      }
    } catch (e) {
      log.push(`card ${c.id}: ${(e as Error).message}`);
    }
  }
  return log;
}

/**
 * Fire a looper. Its history stays, it stops running: cards waiting for approval or for their
 * tool call are rejected, its open pull requests are closed, an open reflection is closed.
 * A pull request GitHub refuses to close stays in Running and syncPullRequests keeps following it.
 */
export async function fireLooper(looperId: number) {
  const [l] = await sql<{ id: number; name: string; workspace_id: number }>`
    update loopers set fired_at = now() where id = ${looperId} and fired_at is null returning id, name, workspace_id`;
  if (!l) return { cards: 0, prs: 0 };
  const cards = await sql`
    update cards set status = 'rejected', updated_at = now(), reject_reason = 'Looper fired'
    where looper_id = ${l.id} and status in ('proposed','approved') returning id`;
  await sql`update reflections set status = 'closed', closed_at = now() where looper_id = ${l.id} and status in ('open','proposed')`;
  const open = await sql<Card>`select * from cards where looper_id = ${l.id} and status = 'running' and ext ? 'pr'`;
  let prs = 0;
  if (open.length) {
    const gh = await githubFor(await wsById(l.workspace_id)).catch(() => null);
    for (const c of open) {
      const pr = c.ext!.pr!;
      try {
        if (!gh || (await prState(gh, pr.repo, pr.number)).state !== "open") continue;
        await closePR(gh, pr.repo, pr.number, `Closed by Looper: ${l.name} was fired before this was merged.`);
        await sql`update cards set status = 'rejected', updated_at = now(), reject_reason = 'Looper fired, pull request closed'
          where id = ${c.id} and status = 'running'`;
        prs++;
      } catch (e) {
        console.error(`fire looper ${l.id}: card ${c.id}:`, (e as Error).message);
      }
    }
  }
  return { cards: cards.length, prs };
}

/** A rejected card frees the ledger row it answered, so a later run can pick it again. */
export async function reopenSource(c: Pick<Card, "id" | "looper_id" | "source_kind" | "source_key"> & { workspace_id: number }) {
  if (c.source_kind && c.source_key) await ledger.setStatus(c.workspace_id, c.looper_id, c.source_kind, c.source_key, "open");
}

/**
 * Reverse a done card with the undo call the looper wrote with it. The card leaves
 * attribution: a reverted change cannot claim the next reading.
 */
export async function revertCard(cardId: number, userId: number) {
  const [c] = await sql<Card & { workspace_id: number }>`
    select cards.*, l.workspace_id from cards join loopers l on l.id = cards.looper_id
    where cards.id = ${cardId} and cards.status = 'done' and cards.undo is not null`;
  if (!c) return "Nothing to undo";
  try {
    const ws = await wsById(c.workspace_id);
    // A pull request card is undone by another pull request that puts the old files back.
    const data =
      c.undo!.tool_slug === PR_SLUG
        ? `pull request ${(await openPR(await githubFor(ws), c.undo!.arguments as PrArgs)).url}`
        : await runTool(ws, c.undo!.tool_slug, c.undo!.arguments);
    await sql`update cards set status = 'reverted', updated_at = now(), acted_by = ${userId},
      attribution = case when attribution = 'pending' then 'unattributed' else attribution end,
      result = ${`Undone: ${typeof data === "string" ? data : JSON.stringify(data)}`.slice(0, 4000)} where id = ${c.id}`;
    return null;
  } catch (e) {
    return `Undo failed: ${(e as Error).message}`;
  }
}

/** A by-hand card is done once a person says what shipped: a link, or one line. */
export async function markDone(cardId: number, shipped: string) {
  const [c] = await sql<{ looper_id: number }>`select looper_id from cards where id = ${cardId}`;
  const before = await latestMetric(c.looper_id);
  await sql`update cards set status = 'done', done_at = now(), updated_at = now(), result = ${`Shipped: ${shipped}`.slice(0, 4000)},
    metric_before = ${before ? Number(before.value) : null} where id = ${cardId} and status in ('approved','failed')`;
}
