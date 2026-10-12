import { sql } from "./db";
import { chat, json, modelFor, type Turn } from "./llm";
import { checkLine, liveRules, type Card, type Looper } from "./engine";
import { nextMonday } from "./time";

export type Proposal = {
  summary: string;
  changes: { routine_id: number; name: string; from_version: number; from: string; to: string; why: string }[];
};

export type Reflection = {
  id: number;
  looper_id: number;
  due_on: string;
  status: "open" | "proposed" | "accepted" | "closed";
  messages: (Turn & { by?: string })[]; // by: email of the collaborator who wrote a founder turn
  proposal: Proposal | null;
  created_at: Date;
};

async function routinesWithRules(looperId: number) {
  const rs = await sql<{ id: number; slug: string; name: string; mode: string }>`
    select id, slug, name, mode from routines where looper_id = ${looperId} order by id`;
  return Promise.all(rs.map(async (r) => ({ ...r, live: await liveRules(r.id) })));
}

/** Everything the looper knows about the last two weeks, as plain text. */
export async function reflectionContext(looper: Looper) {
  const points = await sql<{ value: string; taken_at: Date }>`
    select value, taken_at from metric_points
    where looper_id = ${looper.id} and taken_at > now() - interval '14 days' order by taken_at`;
  const cards = await sql<Card & { checks: { day: number; reading: string; verdict: string }[] | null }>`
    select c.*, (select json_agg(json_build_object('day', k.day, 'reading', k.reading, 'verdict', k.verdict) order by k.day)
                 from checks k where k.card_id = c.id and k.status = 'done') as checks
    from cards c where c.looper_id = ${looper.id} and c.status in ('done','rejected','failed','reverted')
      and (c.updated_at > now() - interval '14 days' or exists (select 1 from checks k where k.card_id = c.id and k.taken_at > now() - interval '14 days'))
    order by c.updated_at`;
  const routines = await routinesWithRules(looper.id);
  const fmt = (c: (typeof cards)[number]) => {
    if (c.status === "rejected") return `- rejected: ${c.title}. Reason: ${c.reject_reason || "none given"}`;
    if (c.status === "failed") return `- failed: ${c.title}. ${c.result ?? ""}`.slice(0, 300);
    const checks = c.checks?.length ? ` Check-backs on ${c.subject}: ${c.checks.map(checkLine).join("; ")}.` : "";
    return `- ${c.status === "reverted" ? "undone" : "done"}: ${c.title}. ${c.attribution === "attributed" ? `Moved the metric ${Number(c.delta) >= 0 ? "+" : ""}${Number(c.delta)}${looper.unit}` : "Unattributed"}.${checks}`;
  };
  return [
    `Metric: ${looper.metric_name}. Target ${looper.target === null ? "not set yet" : `${Number(looper.target)}${looper.unit}`} by ${String(looper.target_date).slice(0, 10)}. Higher is ${looper.direction === "up" ? "better" : "worse"}.`,
    `Readings, last 14 days: ${points.map((p) => `${new Date(p.taken_at).toISOString().slice(5, 10)} ${Number(p.value)}`).join(", ") || "none"}`,
    "Cards, last 14 days:",
    ...(cards.length ? cards.map(fmt) : ["- none"]),
    "Routines and their current rules:",
    ...routines.map((r) => `## ${r.name} (id ${r.id}, v${r.live?.version ?? 0}, ${r.mode === "auto" ? "runs alone" : "asks first"})\n${r.live?.rules ?? ""}`),
  ].join("\n");
}

const SYSTEM = (ctx: string) =>
  [
    "You are a looper in your reflection chat with the founder who hired you. It happens every second Friday and lasts 30 minutes.",
    "Talk about what moved the metric and what did not, using the numbers below. Name cards by title. Be brief: 3 to 6 sentences per reply.",
    "Format: short paragraphs. For 3 or more items, a numbered or - list, one line each, leading with the day or the name. **Bold** only that lead. No headings, no tables.",
    "Treat rejected cards and their reasons as the most important signal. Say which rule produced them.",
    "Check-backs say how each change did days later (keep, revert, iterate). Turn what kept into rules and drop what did not.",
    "You cannot change your rules in this chat. The chat ends in a diff of your rule files that the founder accepts or edits.",
    "",
    ctx,
  ].join("\n");

async function load(id: number) {
  const [r] = await sql<Reflection>`select * from reflections where id = ${id}`;
  const [looper] = await sql<Looper>`select * from loopers where id = ${r.looper_id}`;
  const cfg = await modelFor(looper.user_id);
  if (!cfg) throw new Error("Connect a model first");
  return { r, looper, cfg };
}

/** The looper opens: what moved, what did not, one question. */
export async function openChat(id: number) {
  const { r, looper, cfg } = await load(id);
  if (r.messages.length) return;
  const text = await chat(cfg, SYSTEM(await reflectionContext(looper)), [
    {
      role: "user",
      content:
        "Open the reflection. In order: where the metric is against the target, the cards that moved it, the cards I rejected and why, then one question for me.",
    },
  ]);
  await sql`update reflections set messages = ${JSON.stringify([{ role: "assistant", content: text }])} where id = ${id}`;
}

export async function reply(id: number, userText: string, by?: string) {
  const { r, looper, cfg } = await load(id);
  const turns: Reflection["messages"] = [...r.messages, { role: "user", content: userText, by }];
  // The API wants the first turn from the user; the opener is ours, so lead with a stub.
  const answer = await chat(cfg, SYSTEM(await reflectionContext(looper)), [
    { role: "user", content: "Open the reflection." },
    ...turns.map((t) => ({ role: t.role, content: t.content })),
  ]);
  turns.push({ role: "assistant", content: answer });
  await sql`update reflections set messages = ${JSON.stringify(turns)} where id = ${id}`;
}

const DIFF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changes"],
  properties: {
    summary: { type: "string", description: "One sentence: what changes from Monday and why." },
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["routine_id", "rules", "why"],
        properties: {
          routine_id: { type: "integer" },
          rules: { type: "string", description: "The complete new rule file, one 'key: value' rule per line." },
          why: { type: "string", description: "The card, rejection or number from this chat that justifies the change." },
        },
      },
    },
  },
};

/** End the chat in a diff of the rule files. */
export async function propose(id: number) {
  const { r, looper, cfg } = await load(id);
  const routines = await routinesWithRules(looper.id);
  const transcript = r.messages.map((m) => `${m.role === "user" ? "Founder" : "Looper"}: ${m.content}`).join("\n\n");
  const out = await json<{ summary: string; changes: { routine_id: number; rules: string; why: string }[] }>(
    cfg,
    SYSTEM(await reflectionContext(looper)),
    `Reflection transcript:\n${transcript || "(no messages)"}\n\nWrite the diff. Only change routines the chat gave a reason to change. Keep the 'key: value' line format. Return an empty list if nothing should change.`,
    "diff",
    DIFF_SCHEMA,
  );
  const byId = new Map(routines.map((x) => [x.id, x]));
  const proposal: Proposal = {
    summary: out.summary,
    changes: out.changes
      .filter((c) => byId.has(c.routine_id) && c.rules.trim() !== (byId.get(c.routine_id)!.live?.rules ?? "").trim())
      .map((c) => {
        const x = byId.get(c.routine_id)!;
        return { routine_id: x.id, name: x.name, from_version: x.live?.version ?? 0, from: x.live?.rules ?? "", to: c.rules.trim(), why: c.why };
      }),
  };
  await sql`update reflections set proposal = ${JSON.stringify(proposal)}, status = 'proposed' where id = ${id}`;
  return proposal;
}

/** The founder accepts, possibly after editing. New versions apply from next Monday. */
export async function accept(id: number, edited: Record<number, string>, tz: string, userId?: number) {
  const [r] = await sql<Reflection>`select * from reflections where id = ${id}`;
  if (!r.proposal) throw new Error("No proposal");
  const from = nextMonday(new Date(), tz);
  for (const c of r.proposal.changes) {
    // Textareas submit \r\n; rule files are stored with \n so diffs compare line by line.
    const rules = (edited[c.routine_id] ?? c.to).replace(/\r\n?/g, "\n").trim();
    if (!rules || rules === c.from.trim()) continue;
    await sql`
      insert into routine_versions (routine_id, version, rules, source, effective_from, created_by)
      select ${c.routine_id}, coalesce(max(version), 0) + 1, ${rules}, ${"reflection:" + id}, ${from}, ${userId ?? null}
      from routine_versions where routine_id = ${c.routine_id}`;
    c.to = rules;
  }
  await sql`update reflections set status = 'accepted', closed_at = now(), proposal = ${JSON.stringify(r.proposal)} where id = ${id}`;
}

/** Line diff for display: '-' removed, '+' added, ' ' kept. */
export function lineDiff(a: string, b: string) {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [string, string][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push([" ", A[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push(["-", A[i++]]);
    else out.push(["+", B[j++]]);
  }
  while (i < n) out.push(["-", A[i++]]);
  while (j < m) out.push(["+", B[j++]]);
  return out;
}
