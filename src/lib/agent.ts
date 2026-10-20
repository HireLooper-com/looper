import "server-only";
import { isStepCount, Output, streamText, tool, type ModelMessage, type ToolSet } from "ai";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import { mutate, read } from "./db";
import { allWorkspaceIds } from "./workspace";
import { canvasTools, deleteCanvas, describeCanvas, readCanvas } from "./canvas";
import { activeAccounts, composioTools, hasComposio, resolveApps } from "./composio";
import { computerSession, hasComputer, wipeComputer } from "./computer";
import { coerce, columnSpec, databaseTools, deleteDatabase, describeDatabase, mutateDatabase, newDatabase, readDatabase } from "./database";
import { connectTools, integrationsFor } from "./integrations";
import { getModel, hasCredentials } from "./llm";
import { describeTool, progressWriter } from "./progress";
import { describeSchedule, isDue } from "./schedule";
import { appFromName } from "./apps";
import type { AppRef, Ask, Card, ChiefMessage, Column, DB, DbValue, Looper, Retro, Run, RunStats, Settings, Skill, ToolCallLog } from "./types";
import { ACCENTS } from "./types";

const now = () => new Date().toISOString();
const DAY = 86_400_000;
const columnSchema = z.enum(["backlog", "todo", "doing", "done"]);

// In a shared workspace, the model should know which teammate is talking.
const authored = (m: ChiefMessage) => (m.role === "user" && m.by ? `[${m.by.name}] ${m.content}` : m.content);

// ——— Model calls ———

/** Rank integration tools by how many query words appear in their name and description. */
function searchTools(tools: ToolSet, query: string, limit: number) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  return Object.entries(tools)
    .map(([name, t]) => {
      const description = typeof t.description === "string" ? t.description : "";
      const hay = `${name.replace(/[_-]+/g, " ")} ${description}`.toLowerCase();
      const nameHay = name.toLowerCase();
      const score = words.reduce((s, w) => s + (nameHay.includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0);
      return { name, description: description.slice(0, 300), score };
    })
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ name, description }) => ({ name, description }));
}

interface CallOptions {
  instructions: string;
  prompt?: string;
  messages?: ModelMessage[];
  /** always-available tools */
  tools?: ToolSet;
  /** integration tools; inactive until the model finds them with find_tools */
  external?: ToolSet;
  maxSteps?: number;
  /** live steps shown in the UI while this call works */
  progress?: (text: string) => void;
  /** the reply so far, as it streams */
  onText?: (soFar: string) => void;
  /** quick back-and-forth (chat): ask for less reasoning where the model allows it */
  fast?: boolean;
}

// Models that refused a reasoning-effort setting; we stop sending it to them.
const noEffort = new Set<string>();

function fastOptions(settings: Settings, base: Record<string, Record<string, unknown>> | undefined) {
  const key = `${settings.provider}:${settings.models[settings.provider]}`;
  if (noEffort.has(key)) return base;
  const provider = settings.provider === "openai" ? "openai" : "xai";
  return { ...base, [provider]: { ...base?.[provider], reasoningEffort: "low" } };
}

/**
 * Every call streams: ChatGPT plan usage requires stream:true and store:false, and the same
 * path works for API keys. Integration tools stay out of the request until `find_tools` picks them,
 * so a hub with thousands of tools costs a handful of definitions per step.
 */
async function callModel(uid: string, settings: Settings, opts: CallOptions, output?: Parameters<typeof streamText>[0]["output"]) {
  try {
    return await callModelOnce(uid, settings, opts, output, !!opts.fast);
  } catch (e) {
    // Some models don't take a reasoning effort; remember and retry without it.
    if (opts.fast && /reasoning/i.test(e instanceof Error ? e.message : String(e))) {
      noEffort.add(`${settings.provider}:${settings.models[settings.provider]}`);
      return callModelOnce(uid, settings, opts, output, false);
    }
    throw e;
  }
}

async function callModelOnce(uid: string, settings: Settings, opts: CallOptions, output: Parameters<typeof streamText>[0]["output"], fast: boolean) {
  const m = await getModel(uid, settings);
  const base = opts.tools ?? {};
  const external = opts.external ?? {};
  const hasExternal = Object.keys(external).length > 0;
  const discovered = new Set<string>();

  const findTools = tool({
    description: `Search ${Object.keys(external).length} integration tools by app and action, e.g. "linkedin create post" or "gmail send email". Matching tools become callable on your next step.`,
    inputSchema: z.object({ query: z.string().min(2) }),
    execute: async ({ query }) => {
      const hits = searchTools(external, query, 8);
      for (const h of hits) discovered.add(h.name);
      return { tools: hits, note: hits.length ? "Call these on your next step." : "Nothing matched. Try other words." };
    },
  });

  const all: ToolSet = { ...base, ...(hasExternal ? { find_tools: findTools, ...external } : {}) };
  let failure: unknown;
  let writing = false;
  let soFar = "";
  opts.progress?.("Thinking…");
  // Vercel functions stop at 5 minutes. Past the soft budget the model gets no more tools and must
  // wrap up; the hard limit aborts just before the platform would kill the run silently.
  const startedAt = Date.now();
  let wrappingUp = false;
  const result = streamText({
    model: m.model,
    instructions: opts.instructions,
    ...(opts.messages ? { messages: opts.messages } : { prompt: opts.prompt ?? "" }),
    tools: Object.keys(all).length ? m.wrapTools(all) : undefined,
    providerOptions: (fast ? fastOptions(settings, m.providerOptions as Record<string, Record<string, unknown>>) : m.providerOptions) as typeof m.providerOptions,
    stopWhen: isStepCount(opts.maxSteps ?? 12),
    prepareStep: () => {
      if (Date.now() - startedAt > SOFT_BUDGET_MS) {
        if (!wrappingUp) opts.progress?.("Almost out of time, wrapping up…");
        wrappingUp = true;
        return {
          activeTools: [],
          toolChoice: "none" as const,
          instructions: `${opts.instructions}\n\nTime is up for this run. Don't call tools. Summarise what you did, what you saved, and exactly what's left for the next run.`,
        };
      }
      return hasExternal ? { activeTools: [...Object.keys(base), "find_tools", ...discovered] } : {};
    },
    abortSignal: AbortSignal.timeout(HARD_LIMIT_MS),
    output,
    // Subscription usage errors (limits) shouldn't be retried automatically.
    maxRetries: (settings.authMode[settings.provider] ?? "key") === "oauth" ? 0 : 2,
    onError: ({ error }) => {
      failure = error;
    },
    onChunk: ({ chunk }) => {
      if (!opts.progress) return;
      if (chunk.type === "tool-call") opts.progress(describeTool(chunk.toolName, chunk.input));
      else if (chunk.type === "text-delta") {
        if (!writing) {
          writing = true;
          opts.progress("Writing the reply…");
        }
        if (opts.onText && !output) {
          soFar += chunk.text;
          opts.onText(soFar);
        }
      } else if (chunk.type === "tool-result") soFar = ""; // a new step starts a new reply
    },
  });
  await result.consumeStream();
  // Spend hosted credits even when the call failed partway: the tokens were used.
  if (m.meter) await Promise.resolve(result.totalUsage).then(m.meter).catch(() => undefined);
  if (failure) throw failure;
  return result;
}

const SOFT_BUDGET_MS = 210_000;
const HARD_LIMIT_MS = 285_000;

const errorText = (e: unknown) => {
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
    return "Stopped at the 5-minute limit. Anything already saved (rows, cards) is kept; run it again to continue.";
  return e instanceof Error ? e.message : String(e);
};

// ——— Looper context and built-in tools ———

function metricLine(l: Looper) {
  const last = l.metric.history.at(-1);
  return `${l.metric.name}: ${last ? `${last.value} ${l.metric.unit}` : "no reading yet"} (target ${l.metric.target} ${l.metric.unit}, ${l.metric.direction === "up" ? "higher is better" : "lower is better"})`;
}

function asksLine(db: DB, looperId: string) {
  const asks = db.asks.filter((a) => a.looperId === looperId);
  const open = asks.filter((a) => a.status === "open");
  const answered = asks.filter((a) => a.status === "answered").slice(-5);
  return [
    open.length ? `Waiting on the owner (don't ask again):\n${open.map((a) => `- ${a.question}`).join("\n")}` : "",
    answered.length ? `The owner's recent answers:\n${answered.map((a) => `- ${a.question} → ${a.answer}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function looperBrief(db: DB, l: Looper, database = "") {
  const cards = db.cards.filter((c) => c.looperId === l.id && c.column !== "done");
  const retro = db.retros.filter((r) => r.looperId === l.id).at(-1);
  return [
    `You are ${l.name}, a looper: an autonomous operator who owns exactly one business metric and works in loops.`,
    `Mission: ${l.mission}`,
    `Your metric — ${metricLine(l)}. Everything you do should move this number.`,
    `Recent metric history: ${l.metric.history.slice(-8).map((p) => `${p.at.slice(0, 10)}=${p.value}`).join(", ") || "none"}.`,
    `Open kanban cards:\n${cards.map((c) => `- [${c.column}]${c.assignee === "you" ? " (waiting on the owner)" : ""} ${c.id}: ${c.title}`).join("\n") || "- none"}`,
    asksLine(db, l.id),
    retro ? `Your last retro said to try next:\n${retro.tryNext.map((t) => `- ${t}`).join("\n")}` : "",
    `Your skills: ${l.skills.map((s) => `${s.name} (${describeSchedule(s.schedule)})`).join("; ")}.`,
    database,
    hasComputer()
      ? "You have your own computer: a private Linux machine with Chrome that remembers logins. Use computer_browse to open and use websites that no connected app covers (search, read, fill forms, check dashboards), computer_read to read a page, computer_screenshot to see it, computer_run for shell work like downloads and scripts. Prefer a connected app when one covers the job. If a site needs a login you don't have, ask the owner; never guess passwords. If a site shows a bot check (CAPTCHA, 'verify you are human'), stop: don't click it, retry or try to get around it. Prefer the site's official API or a connected app (search with find_tools), else another public source (RSS feed, search results, other sites); only if nothing else works, ask_owner whether they want to pass the check themselves. Before a final submit, post, purchase or send on a website, get an approved ask_owner approval, as with apps."
      : "",
    "Work rules: keep your kanban board current (add cards for work you plan, move them as you go). When you learn the latest metric value from a real source, record it with metric_record. To use an external app (CRM, email, social, analytics, docs, …), call find_tools with the app and action, then call the tool it returns. Never invent data. When only the owner can decide something, ask with ask_owner (tappable options) instead of guessing, and never send, publish, file, pay or delete without an approved ask_owner approval; keep kanban cards for: 'you' for real tasks that take the owner more than a tap. Finish with a 2–4 sentence summary of what you did and what changed.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function boardTools(uid: string, looperId: string, actor: Card["createdBy"]): ToolSet {
  return {
    kanban_list: tool({
      description: "List the cards on your kanban board.",
      inputSchema: z.object({}),
      execute: async () => (await read(uid)).cards.filter((c) => c.looperId === looperId).map((c) => ({ ...c, assignee: c.assignee ?? "looper" })),
    }),
    kanban_add_card: tool({
      description:
        "Add a card to your kanban board. Most cards are your own work (for: 'looper'). Use for: 'you' only when the owner must act: approve or review something, connect an app, make a decision, or give you information you can't get yourself.",
      inputSchema: z.object({
        title: z.string(),
        description: z.string().default(""),
        column: columnSchema.default("todo"),
        for: z.enum(["looper", "you"]).default("looper"),
      }),
      execute: ({ title, description, column, for: assignee }) =>
        mutate(uid, (db) => {
          const card: Card = { id: nanoid(8), looperId, title, description, column, assignee, createdBy: actor, createdAt: now(), updatedAt: now() };
          db.cards.push(card);
          return card;
        }),
    }),
    kanban_move_card: tool({
      description: "Move a card to another column, optionally appending a note to its description.",
      inputSchema: z.object({ cardId: z.string(), column: columnSchema, note: z.string().optional() }),
      execute: ({ cardId, column, note }) =>
        mutate(uid, (db) => {
          const card = db.cards.find((c) => c.id === cardId && c.looperId === looperId);
          if (!card) throw new Error(`No card ${cardId}`);
          card.column = column as Column;
          if (note) card.description = `${card.description}\n\n${note}`.trim();
          card.updatedAt = now();
          return card;
        }),
    }),
    metric_record: tool({
      description: "Record a fresh reading of your business metric, with where it came from.",
      inputSchema: z.object({ value: z.number(), note: z.string().describe("source of the reading") }),
      execute: ({ value, note }) =>
        mutate(uid, (db) => {
          const l = db.loopers.find((x) => x.id === looperId);
          if (!l) throw new Error("Looper gone");
          l.metric.history.push({ at: now(), value, note });
          return { recorded: value };
        }),
    }),
  };
}

function logToolCalls(steps: { content: { type: string; toolName?: string }[] }[]): ToolCallLog[] {
  return steps.flatMap((s) =>
    s.content
      .filter((p) => (p.type === "tool-result" || p.type === "tool-error") && p.toolName !== "find_tools")
      .map((p) => ({ name: p.toolName ?? "tool", ok: p.type === "tool-result" })),
  );
}

type StepLike = { content: { type: string; toolName?: string; input?: unknown }[] };

/** What a run changed, counted from its successful tool calls. */
function runStats(steps: StepLike[]): RunStats {
  const stats: RunStats = {};
  const bump = (k: keyof RunStats, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
  const results = new Set(steps.flatMap((s) => s.content.filter((p) => p.type === "tool-result").map((p) => (p as { toolCallId?: string }).toolCallId)));
  for (const s of steps)
    for (const p of s.content) {
      if (p.type !== "tool-call" || !results.has((p as { toolCallId?: string }).toolCallId)) continue;
      const input = (p.input ?? {}) as Record<string, unknown>;
      const len = (k: string) => (Array.isArray(input[k]) ? (input[k] as unknown[]).length : 1);
      if (p.toolName === "db_add_rows") bump("rows", len("rows"));
      else if (p.toolName === "kanban_add_card") bump("cards");
      else if (p.toolName === "kanban_move_card") bump("moved");
      else if (p.toolName === "canvas_add") bump("pins", len("items"));
      else if (p.toolName === "metric_record") stats.metric = Number(input.value);
      if (p.toolName !== "find_tools") bump("tools");
    }
  return stats;
}

// ——— Asking the owner ———

/** Put a question or an approval to the owner: it shows in the looper's chat and the inbox. */
function askTools(uid: string, looperId: string, onAsk?: (id: string) => void): ToolSet {
  return {
    ask_owner: tool({
      description:
        "Ask your owner something only they can decide, as tappable options (kind 'choice', 2–4 short options), or ask approval before anything risky or irreversible: sending, publishing, filing, paying, deleting (kind 'approval', with `detail` saying exactly what will happen). Their answer comes back to you as a chat message. Prefer this over a kanban card for quick decisions. Ask one thing at a time.",
      inputSchema: z.object({
        kind: z.enum(["choice", "approval"]),
        question: z.string().max(300),
        options: z.array(z.string().max(60)).min(2).max(4).optional(),
        detail: z.string().max(1200).optional(),
      }),
      execute: (input) =>
        mutate(uid, (d) => {
          const open = d.asks.find((a) => a.looperId === looperId && a.status === "open" && a.question === input.question);
          if (open) return { asked: open.id, note: "Already asked; wait for the answer." };
          const ask: Ask = { id: nanoid(8), looperId, kind: input.kind, question: input.question, options: input.kind === "choice" ? input.options : undefined, detail: input.detail, status: "open", createdAt: now() };
          d.asks.push(ask);
          (d.chats ??= {})[looperId] = [...(d.chats[looperId] ?? []), { id: nanoid(8), role: "assistant", content: input.question, at: now(), askId: ask.id }];
          onAsk?.(ask.id);
          return { asked: ask.id, note: "The owner will see it in chat and their inbox. Carry on with anything that doesn't depend on the answer." };
        }),
    }),
  };
}

// ——— Runs ———

async function startRun(uid: string, looper: Looper, skill: Skill, trigger: Run["trigger"]) {
  const run: Run = {
    id: nanoid(10),
    looperId: looper.id,
    skillId: skill.id,
    skillName: skill.name,
    trigger,
    status: "running",
    startedAt: now(),
    summary: "",
    toolCalls: [],
  };
  await mutate(uid, (db) => {
    db.runs.push(run);
    const s = db.loopers.find((l) => l.id === looper.id)?.skills.find((x) => x.id === skill.id);
    if (s) s.lastRunAt = run.startedAt;
  });
  return run;
}

async function finishRun(uid: string, id: string, patch: Partial<Run>) {
  await mutate(uid, (db) => {
    const run = db.runs.find((r) => r.id === id);
    if (run) Object.assign(run, patch, { finishedAt: now() });
  });
}

/** Every external tool a looper can use: MCP hubs plus its connected Composio apps. Close when done. */
async function looperApps(uid: string, looper: Looper, db: DB) {
  const ext = await connectTools(integrationsFor(looper, db.settings));
  const composioSlugs = (await resolveApps((looper.apps ?? []).filter((a) => a.via === "composio")).catch(() => [])).map((a) => a.slug);
  const apps = await composioTools(uid, composioSlugs).catch(() => ({ tools: {}, connected: [] as string[], missing: composioSlugs }));
  ext.tools = { ...ext.tools, ...apps.tools };
  ext.connected.push(...apps.connected);
  if (apps.missing.length) ext.failed.push(...apps.missing.map((slug) => ({ name: `${slug} (not connected yet)`, error: "" })));
  return ext;
}

export async function runSkill(uid: string, looperId: string, skillId: string, trigger: Run["trigger"] = "manual", adhoc?: Skill, maxSteps = 25) {
  const db = await read(uid);
  const looper = db.loopers.find((l) => l.id === looperId);
  const skill = adhoc ?? looper?.skills.find((s) => s.id === skillId);
  if (!looper || !skill) throw new Error("Looper or skill not found");
  if (skill.kind === "retro") return runRetro(uid, looperId, trigger, skill);

  const run = await startRun(uid, looper, skill, trigger);
  const live = progressWriter(uid, `run:${run.id}`, { label: `${looper.name} · ${skill.name}`, href: `/loopers/${looper.id}?tab=chat`, done: "finished" });
  live.push("Connecting apps…");
  const ext = await looperApps(uid, looper, db);
  const pc = hasComputer() ? computerSession(uid, looper.id, { label: skill.name, progress: live.push }) : null;
  if (ext.connected.length) live.push(`Connected: ${ext.connected.map((c) => c.split(" (")[0]).join(", ")}`);
  let outcome: { ok?: boolean; note?: string; error?: string } = {};
  try {
    const hasExternal = Object.keys(ext.tools).length > 0;
    // A looper without a database designs one before it works, so its results land in rows.
    const table = (await readDatabase(uid, looper.id)) ?? (await designDatabase(uid, looper.id).catch(() => null));
    const database = [describeDatabase(table), describeCanvas(await readCanvas(uid, looper.id))].filter(Boolean).join("\n\n");
    const result = await callModel(uid, db.settings, {
      instructions: looperBrief(db, looper, database),
      prompt: [
        `Run your skill "${skill.name}" now.`,
        skill.instructions,
        hasExternal ? `Connected integrations: ${ext.connected.join(", ")}.` : "No external integrations are connected; work with your board and say what integration would help.",
        ext.failed.length ? `Unavailable: ${ext.failed.map((f) => f.name).join(", ")}. If you need one of these, add a card asking the user to connect it on your Tools tab.` : "",
      ].join("\n\n"),
      tools: { ...boardTools(uid, looper.id, "looper"), ...databaseTools(uid, looper.id), ...canvasTools(uid, looper.id), ...askTools(uid, looper.id), ...pc?.tools },
      external: ext.tools,
      maxSteps,
      progress: live.push,
      onText: live.text,
    });
    const text = await result.text;
    const steps = await result.steps;
    await finishRun(uid, run.id, { status: "success", summary: text, toolCalls: logToolCalls(steps), stats: runStats(steps), steps: live.trail() });
    outcome = { ok: true, note: firstSentence(text) };
    return { ...run, status: "success" as const, summary: text };
  } catch (error) {
    const summary = errorText(error);
    await finishRun(uid, run.id, { status: "error", summary, steps: live.trail() });
    outcome = { error: summary };
    return { ...run, status: "error" as const, summary };
  } finally {
    await Promise.all([ext.close(), pc?.release()]);
    await live.done(outcome);
  }
}

function firstSentence(s: string) {
  const flat = s.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.{20,160}?[.!?])(\s|$)/);
  return m ? m[1] : flat.slice(0, 140);
}

const retroSchema = z.object({
  effectiveness: z.number().int().min(1).max(5).describe("1 = wasted effort, 5 = clearly moved the metric"),
  wentWell: z.array(z.string()).max(6),
  didntGoWell: z.array(z.string()).max(6),
  tryNext: z.array(z.string()).max(5).describe("concrete experiments for the next loop"),
  newCards: z.array(z.object({ title: z.string(), description: z.string() })).max(4).describe("todo cards to add for the tryNext items"),
});

export async function runRetro(uid: string, looperId: string, trigger: Run["trigger"] = "manual", skill?: Skill) {
  const db = await read(uid);
  const looper = db.loopers.find((l) => l.id === looperId);
  if (!looper) throw new Error("Looper not found");
  const retroSkill = skill ?? looper.skills.find((s) => s.kind === "retro") ?? defaultRetroSkill();
  const run = await startRun(uid, looper, retroSkill, trigger);
  const live = progressWriter(uid, `run:${run.id}`, { label: `${looper.name}'s retro`, href: `/loopers/${looper.id}?tab=retro`, done: "is ready" });
  live.push("Reading the week's runs, cards and metric…");

  const last = db.retros.filter((r) => r.looperId === looperId).at(-1);
  const periodStart = last?.periodEnd ?? new Date(Math.max(Date.parse(looper.createdAt), Date.now() - 7 * DAY)).toISOString();
  const periodEnd = now();
  const inPeriod = (iso: string) => iso >= periodStart && iso <= periodEnd;
  const runs = db.runs.filter((r) => r.looperId === looperId && r.id !== run.id && inPeriod(r.startedAt));
  const cards = db.cards.filter((c) => c.looperId === looperId && inPeriod(c.updatedAt));
  const points = looper.metric.history.filter((p) => inPeriod(p.at));
  const before = looper.metric.history.filter((p) => p.at < periodStart).at(-1) ?? points[0];
  const after = points.at(-1);

  try {
    live.push(`Reviewing ${runs.length} run${runs.length === 1 ? "" : "s"} and ${cards.length} card${cards.length === 1 ? "" : "s"}…`);
    const result = await callModel(
      uid,
      db.settings,
      {
        instructions: looperBrief(db, looper),
        progress: live.push,
        prompt: [
          `Hold your retrospective for ${periodStart.slice(0, 10)} → ${periodEnd.slice(0, 10)}. Be honest and specific about whether your work actually moved ${looper.metric.name}; separate activity from impact.`,
          `Metric: ${before ? before.value : "unknown"} → ${after ? after.value : "unknown"} ${looper.metric.unit}. Readings: ${points.map((p) => `${p.at.slice(0, 16)} ${p.value}${p.note ? ` (${p.note})` : ""}`).join("; ") || "none"}.`,
          `Skill runs (${runs.length}):\n${runs.map((r) => `- ${r.startedAt.slice(0, 16)} ${r.skillName} [${r.status}] tools: ${r.toolCalls.map((t) => t.name).join(", ") || "none"} — ${r.summary.slice(0, 300)}`).join("\n") || "- none"}`,
          `Cards touched:\n${cards.map((c) => `- [${c.column}] ${c.title}`).join("\n") || "- none"}`,
          last ? `Last retro's experiments: ${last.tryNext.join("; ")}. Say whether you followed through.` : "",
        ].join("\n\n"),
      },
      Output.object({ schema: retroSchema }),
    );
    const output = (await result.output) as z.infer<typeof retroSchema>;
    live.push("Writing the retro…");

    const retro: Retro = {
      id: nanoid(8),
      looperId,
      createdAt: now(),
      periodStart,
      periodEnd,
      effectiveness: output.effectiveness,
      metricStart: before?.value,
      metricEnd: after?.value,
      wentWell: output.wentWell,
      didntGoWell: output.didntGoWell,
      tryNext: output.tryNext,
    };
    await mutate(uid, (d) => {
      d.retros.push(retro);
      for (const c of output.newCards)
        d.cards.push({ id: nanoid(8), looperId, title: c.title, description: c.description, column: "todo", assignee: "looper", createdBy: "looper", createdAt: now(), updatedAt: now() });
    });
    const summary = `Retro: effectiveness ${retro.effectiveness}/5. Next: ${retro.tryNext.join("; ")}`;
    await finishRun(uid, run.id, { status: "success", summary });
    await live.done({ ok: true, note: `Effectiveness ${retro.effectiveness}/5` });
    return { ...run, status: "success" as const, summary };
  } catch (error) {
    const summary = errorText(error);
    await finishRun(uid, run.id, { status: "error", summary });
    await live.done({ error: summary });
    return { ...run, status: "error" as const, summary };
  }
}

export function defaultRetroSkill(): Skill {
  return {
    id: nanoid(8),
    name: "Weekly retro",
    kind: "retro",
    instructions: "Reflect on the effectiveness of the past week's work against the metric.",
    schedule: { type: "weekly", time: "17:00", days: [5] },
  };
}

/**
 * Start one user's due skills. Each skill is claimed inside the workspace lock (its lastRunAt moves
 * to now) so two servers ticking at once can't both start it, and loopers that are already working
 * wait for the next tick instead of stacking runs. Claimed skills run side by side, each with its
 * own time budget, so a slow one can't eat the others' share of the 5-minute function limit.
 */
export async function tickUser(uid: string) {
  const claimed = await mutate(uid, (db) => {
    if (!hasCredentials(db.settings)) return [];
    const at = now();
    return db.loopers
      .filter((l) => l.status === "active" && !db.runs.some((r) => r.looperId === l.id && r.status === "running"))
      .flatMap((l) => {
        const s = l.skills.find((x) => isDue(x));
        if (!s) return [];
        s.lastRunAt = at;
        return [{ looperId: l.id, skillId: s.id, label: `${l.name}/${s.name}` }];
      });
  });
  await Promise.all(claimed.map((c) => runSkill(uid, c.looperId, c.skillId, "schedule").catch((e) => console.error("[tick]", c.label, e))));
  return claimed.map((c) => c.label);
}

/** Run every user's due skills. Called by the local ticker or the daily cron on /api/tick. */
export async function tick() {
  const started = await Promise.all((await allWorkspaceIds()).map((ws) => tickUser(ws).then((l) => l.map((x) => `${ws}/${x}`))));
  return { started: started.flat() };
}

// ——— Chief ———

const skillInput = z.object({
  name: z.string(),
  instructions: z.string().describe("what the looper does each time this skill runs, naming the apps it should use"),
  type: z.enum(["manual", "hourly", "daily", "weekly"]),
  time: z.string().default("09:00").describe("HH:MM"),
  days: z.array(z.number().int().min(0).max(6)).default([1]).describe("weekly only, 0=Sun"),
});

function toSkill(s: z.infer<typeof skillInput>): Skill {
  return { id: nanoid(8), name: s.name, instructions: s.instructions, kind: "work", schedule: { type: s.type, time: s.time, days: s.days } };
}

function dedupeApps(apps: AppRef[]) {
  return apps.filter((a, i) => a.slug && apps.findIndex((b) => b.slug === a.slug) === i);
}

export const looperSpec = z.object({
  name: z.string().describe("short, human first name–style, e.g. 'Ivy'"),
  role: z.string().max(24).optional().describe("one-word role tag, e.g. 'Accounting', 'SEO', 'Sales'"),
  area: z
    .enum(["distribution", "operations"])
    .optional()
    .describe("'distribution' if it grows reach, traffic, leads or revenue (SEO, social, ads, sales); 'operations' if it keeps the business running (support, bugs, finance)"),
  emoji: z.string().default("◎"),
  mission: z.string(),
  metric: z.object({ name: z.string(), unit: z.string(), direction: z.enum(["up", "down"]), target: z.number(), current: z.number().optional() }),
  skills: z.array(skillInput).min(1).max(4),
  apps: z.array(z.string()).max(8).default([]).describe("apps the looper needs, by name, e.g. ['Stripe', 'Gmail', 'bunq']"),
  database: z
    .object({ name: z.string(), rowNoun: z.string().describe("what one row is, e.g. 'bank transaction'"), columns: z.array(columnSpec).min(2).max(15) })
    .optional()
    .describe("the looper's database: one row per unit of its work"),
  starterCards: z
    .array(z.object({ title: z.string(), for: z.enum(["looper", "you"]).describe("'you' when the owner must act (connect, approve, decide)") }))
    .max(5)
    .default([]),
});
export type LooperSpec = z.infer<typeof looperSpec>;

/** Create a looper from a spec (Chief's create_looper and the guided hiring flow). */
export async function hireLooper(uid: string, input: LooperSpec) {
  const apps = await resolveApps(dedupeApps(input.apps.map(appFromName)));
  const r = await mutate(uid, (db) => {
    const looper: Looper = {
      id: nanoid(8),
      name: input.name,
      emoji: input.emoji,
      color: ACCENTS[db.loopers.length % ACCENTS.length],
      mission: input.mission,
      metric: {
        name: input.metric.name,
        unit: input.metric.unit,
        direction: input.metric.direction,
        target: input.metric.target,
        history: input.metric.current === undefined ? [] : [{ at: now(), value: input.metric.current, note: "baseline" }],
      },
      skills: [...input.skills.map(toSkill), defaultRetroSkill()],
      integrationIds: "all",
      apps,
      role: input.role,
      area: input.area,
      status: "active",
      createdAt: now(),
    };
    db.loopers.push(looper);
    for (const c of input.starterCards)
      db.cards.push({ id: nanoid(8), looperId: looper.id, title: c.title, description: "", column: "todo", assignee: c.for, createdBy: "chief", createdAt: now(), updatedAt: now() });
    return { id: looper.id, name: looper.name, apps, firstSkill: looper.skills[0] };
  });
  if (input.database) await mutateDatabase(uid, r.id, (box) => void (box.db ??= newDatabase(input.database!.name, input.database!.rowNoun, input.database!.columns)));
  return r;
}

/** Chief drafts a looper for a goal without hiring it, so the owner can review it first. */
export async function proposeLooper(uid: string, goal: string): Promise<LooperSpec> {
  const db = await read(uid);
  const team = db.loopers.map((l) => `- ${l.name}: ${metricLine(l)}`).join("\n") || "- nobody yet";
  const result = await callModel(
    uid,
    db.settings,
    {
      instructions: `${CHIEF_INSTRUCTIONS}\n\nToday is ${new Date().toDateString()}. Current team (pick a name that isn't taken):\n${team}`,
      prompt: `Draft one looper for this goal, ready to hire: ${goal}\n\nInclude the apps it needs, a database (5–10 columns), 1–3 skills on sensible schedules whose instructions name the apps, and up to 3 starter cards. If the goal doesn't say the current value, leave metric.current out.`,
      maxSteps: 1,
    },
    Output.object({ schema: looperSpec }),
  );
  return (await result.output) as LooperSpec;
}

function chiefTools(uid: string, actions: string[], links: { label: string; href: string }[]): ToolSet {
  const findLooper = (db: DB, idOrName: string) => {
    const l = db.loopers.find((x) => x.id === idOrName || x.name.toLowerCase() === idOrName.toLowerCase());
    if (!l) throw new Error(`No looper "${idOrName}"`);
    return l;
  };
  return {
    list_loopers: tool({
      description: "List all loopers with their metric, status, skills and open card counts.",
      inputSchema: z.object({}),
      execute: async () => {
        const db = await read(uid);
        return db.loopers.map((l) => ({
          id: l.id,
          name: l.name,
          status: l.status,
          mission: l.mission,
          metric: metricLine(l),
          skills: l.skills.map((s) => `${s.name} — ${describeSchedule(s.schedule)}`),
          openCards: db.cards.filter((c) => c.looperId === l.id && c.column !== "done").length,
          lastRetro: db.retros.filter((r) => r.looperId === l.id).at(-1)?.effectiveness,
        }));
      },
    }),
    list_integrations: tool({
      description: "List what the user has connected: app accounts (Gmail, Stripe…, usable by every looper), MCP hubs, and which apps each looper still misses.",
      inputSchema: z.object({}),
      execute: async () => {
        const db = await read(uid);
        const c = await appConnections(uid, db);
        return {
          connectedApps: c.connected,
          hubs: c.hubs,
          loopers: db.loopers.map((l) => ({ name: l.name, missing: (l.apps ?? []).filter((a) => !c.isConnected(a)).map((a) => a.name) })),
        };
      },
    }),
    create_looper: tool({
      description: "Hire a new looper. Each looper owns exactly ONE business metric. Give it 1–4 work skills on sensible schedules; a weekly retro skill is added automatically.",
      inputSchema: looperSpec,
      execute: async (input) => {
        const r = await hireLooper(uid, input);
        const c = await appConnections(uid, await read(uid));
        const missing = r.apps.filter((a) => !c.isConnected(a));
        // Only offer Connect for what isn't connected yet.
        if (missing.length) links.push({ label: `Connect ${missing.map((a) => a.name).join(", ")} for ${r.name}`, href: `/loopers/${r.id}?tab=apps` });
        actions.push(`Hired ${r.name}`);
        return { id: r.id, name: r.name, appsAlreadyConnected: r.apps.filter((a) => c.isConnected(a)).map((a) => a.name), appsToConnect: missing.map((a) => a.name) };
      },
    }),
    update_looper: tool({
      description: "Change a looper's mission, metric target, status (active/paused) or add skills.",
      inputSchema: z.object({
        looper: z.string().describe("id or name"),
        mission: z.string().optional(),
        target: z.number().optional(),
        status: z.enum(["active", "paused"]).optional(),
        addSkills: z.array(skillInput).optional(),
        addApps: z.array(z.string()).optional().describe("apps to add, by name"),
      }),
      execute: async (input) => {
        const added = input.addApps?.length ? await resolveApps(input.addApps.map(appFromName)) : [];
        const c = await appConnections(uid, await read(uid));
        const missing = added.filter((a) => !c.isConnected(a));
        return mutate(uid, (db) => {
          const l = findLooper(db, input.looper);
          if (added.length) {
            l.apps = dedupeApps([...(l.apps ?? []), ...added]);
            if (missing.length) links.push({ label: `Connect ${missing.map((a) => a.name).join(", ")} for ${l.name}`, href: `/loopers/${l.id}?tab=apps` });
          }
          if (input.mission) l.mission = input.mission;
          if (input.target !== undefined) l.metric.target = input.target;
          if (input.status) l.status = input.status;
          if (input.addSkills) l.skills.push(...input.addSkills.map(toSkill));
          actions.push(`Updated ${l.name}`);
          return { ok: true, appsToConnect: missing.map((a) => a.name) };
        });
      },
    }),
    retire_looper: tool({
      description: "Permanently remove a looper and its board, runs and retros. Only when the user explicitly asks.",
      inputSchema: z.object({ looper: z.string() }),
      execute: ({ looper }) =>
        mutate(uid, (db) => {
          const l = findLooper(db, looper);
          db.loopers = db.loopers.filter((x) => x.id !== l.id);
          db.cards = db.cards.filter((x) => x.looperId !== l.id);
          db.runs = db.runs.filter((x) => x.looperId !== l.id);
          db.retros = db.retros.filter((x) => x.looperId !== l.id);
          actions.push(`Retired ${l.name}`);
          return { id: l.id };
        }).then(async ({ id }) => {
          await Promise.all([deleteDatabase(uid, id), deleteCanvas(uid, id), wipeComputer(uid, id).catch(() => undefined)]);
          return { ok: true };
        }),
    }),
    assign_card: tool({
      description: "Put a task on a looper's kanban board: for the looper to do, or for the user (for: 'you') when they must act.",
      inputSchema: z.object({ looper: z.string(), title: z.string(), description: z.string().default(""), for: z.enum(["looper", "you"]).default("looper") }),
      execute: ({ looper, title, description, for: assignee }) =>
        mutate(uid, (db) => {
          const l = findLooper(db, looper);
          db.cards.push({ id: nanoid(8), looperId: l.id, title, description, column: "todo", assignee, createdBy: "chief", createdAt: now(), updatedAt: now() });
          actions.push(`Assigned "${title}" to ${l.name}`);
          return { ok: true };
        }),
    }),
    read_database: tool({
      description: "Read a looper's database (its table of work: transactions, posts, leads…). Use this whenever the user asks to see rows. Optional text search.",
      inputSchema: z.object({ looper: z.string(), search: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }),
      execute: async ({ looper, search, limit }) => {
        const l = findLooper(await read(uid), looper);
        const table = await readDatabase(uid, l.id);
        if (!table) return { database: null, note: `${l.name} has no database yet. It's designed when the user opens the Database tab or before the next run.` };
        const q = search?.toLowerCase();
        const rows = table.rows.filter((r) => !q || Object.values(r.cells).some((v) => String(v ?? "").toLowerCase().includes(q)));
        links.push({ label: `Open ${l.name}'s ${table.name}`, href: `/loopers/${l.id}?tab=database` });
        return {
          name: table.name,
          row: table.rowNoun,
          total: rows.length,
          columns: table.columns.map((c) => c.name),
          rows: rows.slice(0, limit).map((r) => Object.fromEntries(table.columns.map((c) => [c.name, r.cells[c.id] ?? null]))),
          note: table.rows.length === 0 ? "Empty. Offer fill_database to pull rows from the looper's sources." : undefined,
        };
      },
    }),
    fill_database: tool({
      description: "Start a background run where the looper fills its database from its connected sources (sheets, Stripe, Gmail…). Takes a few minutes; rows appear on its Database tab.",
      inputSchema: z.object({ looper: z.string() }),
      execute: async ({ looper }) => {
        const l = findLooper(await read(uid), looper);
        after(() => fillDatabase(uid, l.id, "chief").then(() => undefined).catch(() => undefined));
        actions.push(`${l.name} is filling the database`);
        links.push({ label: `Watch ${l.name}'s database`, href: `/loopers/${l.id}?tab=database` });
        return { started: true };
      },
    }),
    run_skill: tool({
      description: "Run one of a looper's skills right now and return its summary.",
      inputSchema: z.object({ looper: z.string(), skill: z.string().describe("skill name") }),
      execute: async ({ looper, skill }) => {
        const db = await read(uid);
        const l = findLooper(db, looper);
        const s = l.skills.find((x) => x.name.toLowerCase() === skill.toLowerCase()) ?? l.skills[0];
        const run = await runSkill(uid, l.id, s.id, "chief");
        actions.push(`Ran ${l.name} · ${s.name}`);
        return { status: run.status, summary: run.summary };
      },
    }),
  };
}

/**
 * What the owner has actually connected: their app accounts (shared by every looper) and any MCP
 * hubs. Chief reads this so it only asks for apps that are still missing.
 */
async function appConnections(uid: string, db: DB) {
  const accounts = hasComposio() ? await activeAccounts(uid).catch(() => new Map<string, unknown[]>()) : new Map<string, unknown[]>();
  const hubs = db.settings.integrations.filter((i) => i.enabled);
  const names = new Map(db.loopers.flatMap((l) => (l.apps ?? []).map((a) => [a.slug, a.name] as const)));
  const isConnected = (a: AppRef) => (a.via === "mcp" ? hubs.some((h) => h.app === a.slug) : accounts.has(a.slug));
  const connected = [...accounts].map(([slug, list]) => `${names.get(slug) ?? slug}${list.length > 1 ? ` (${list.length} accounts)` : ""}`);
  const appsLine = (l: Looper) => (l.apps ?? []).map((a) => `${a.name} ${isConnected(a) ? "✓" : "(not connected)"}`).join(", ");
  return { isConnected, connected, hubs: hubs.map((h) => h.name), appsLine };
}

const CHIEF_INSTRUCTIONS = `You are Chief, the head of a team of loopers. A looper is an AI operator hired to move exactly one business metric. It has one kanban board, a calendar of scheduled skills, and a retro board where it judges its own effectiveness.

Your job: turn the user's goals into loopers, manage them, and report on them. When the user wants something done repeatedly, propose a looper (name, one metric with unit/direction/target, 1–4 scheduled skills that name the apps to use) and hire it with create_looper — don't ask more than one clarifying question first. One metric per looper, always; split goals that have two metrics into two loopers.

Give every looper a database (create_looper.database) whose rows are the unit of its work, with 5–10 useful columns: a VAT looper gets one row per bank transaction (date, amount, counterparty, source, VAT rate, VAT amount, invoice found, status); an SEO looper gets one row per blog post or idea (title, status Idea/Drafting/Published, keyword, URL, clicks); a sales looper one row per lead. Use select columns for statuses.

Always pass the apps the looper needs in create_looper.apps (e.g. a VAT looper with a bunq account, Stripe income and invoices in Gmail → ["bunq", "Stripe", "Gmail"]).

Connections: the user connects each app once (Gmail, Stripe, Google Sheets…) and every looper can use it. "Connected apps" below is the live list. Never ask the user to connect an app that is already there. create_looper and update_looper return appsToConnect: only those still need connecting, and the app shows a Connect button for exactly those, so say "connect X with the button below". If appsToConnect is empty, say everything is already connected. MCP hubs (Composio, Zapier…) are optional extras; an empty hub list does not mean apps aren't connected.

When the user asks to see a looper's data (transactions, posts, leads), call read_database and show the rows as a short list; if it's empty, offer fill_database.

Be brief and concrete. Use plain text with short lists.`;

/**
 * Save the owner's message and mark Chief as working, then hand back the slow part to run in the
 * background, so the request returns at once and the UI follows the live progress.
 */
export async function beginChiefReply(uid: string, userText: string, by?: ChiefMessage["by"]) {
  const userMsg: ChiefMessage = { id: nanoid(8), role: "user", content: userText, at: now(), ...(by ? { by } : {}) };
  await mutate(uid, (d) => void d.chief.push(userMsg));
  const live = progressWriter(uid, "chief", { label: "Chief", href: "/chief", done: "replied", failed: "couldn't reply" });
  await live.ready();
  return Object.assign(() => chiefReply(uid, live).then(() => undefined), { since: live.since });
}

async function chiefReply(uid: string, live: ReturnType<typeof progressWriter>) {
  const db = await read(uid);
  const history: ModelMessage[] = db.chief.slice(-31).map((m) => ({ role: m.role, content: authored(m) }));
  const actions: string[] = [];
  const links: { label: string; href: string }[] = [];
  let content: string;
  try {
    const conn = await appConnections(uid, db);
    const team = db.loopers.map((l) => `- ${l.name} (${l.status}): ${metricLine(l)}${l.apps?.length ? `; apps: ${conn.appsLine(l)}` : ""}`).join("\n") || "- nobody hired yet";
    const result = await callModel(uid, db.settings, {
      progress: live.push,
      instructions: `${CHIEF_INSTRUCTIONS}\n\nToday is ${new Date().toDateString()}.\nCurrent team:\n${team}\nConnected apps: ${conn.connected.join(", ") || "none yet"}\nMCP hubs: ${conn.hubs.join(", ") || "none (optional)"}`,
      messages: history,
      tools: chiefTools(uid, actions, links),
      maxSteps: 12,
      onText: live.text,
      fast: true,
    });
    content = (await result.text) || (actions.length ? "Done." : "…");
  } catch (error) {
    content = `I couldn't reach the model: ${errorText(error)}`;
  }
  const reply = { id: nanoid(8), role: "assistant" as const, content, at: now(), actions, links };
  await mutate(uid, (d) => void d.chief.push(reply));
  await live.done({ ok: !content.startsWith("I couldn't"), note: firstSentence(content) });
  return reply;
}

// ——— Database design ———

const designSchema = z.object({
  name: z.string().describe("short table name, e.g. 'Transactions Q4'"),
  rowNoun: z.string().describe("what ONE row is, singular, e.g. 'bank transaction'"),
  columns: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["text", "number", "currency", "date", "select", "checkbox", "url"]),
        options: z.array(z.string()).describe("for select columns: the allowed values; empty otherwise"),
      }),
    )
    .min(3)
    .max(12)
    .describe("first column is the row's title (text)"),
  rows: z
    .array(z.array(z.string()).describe("one value per column, in column order; empty string when unknown"))
    .max(60)
    .describe("rows you can already fill from your past work below; never invent data"),
});

/**
 * Let a looper design its own database from what it knows (mission, metric, skills, apps) and
 * pre-fill rows it can take from its past runs and cards. No-op when it already has one.
 */
export async function designDatabase(uid: string, looperId: string) {
  const existing = await readDatabase(uid, looperId);
  if (existing) return existing;
  const db = await read(uid);
  const looper = db.loopers.find((l) => l.id === looperId);
  if (!looper) throw new Error("Looper not found");

  const runs = db.runs.filter((r) => r.looperId === looperId && r.status === "success").slice(-12);
  const cards = db.cards.filter((c) => c.looperId === looperId);
  const result = await callModel(
    uid,
    db.settings,
    {
      instructions: looperBrief(db, looper, ""),
      prompt: [
        `Design your database: the table you'll keep current on every run. One row = one unit of your work (for a VAT looper: one bank transaction; for an SEO looper: one blog post or idea; for sales: one lead).`,
        `Pick 5–10 columns you actually need to move "${looper.metric.name}": a title column first, dates, money as currency, statuses and categories as select columns with sensible options, checkboxes for yes/no facts, links as url.`,
        `Apps you work with: ${(looper.apps ?? []).map((a) => a.name).join(", ") || "none listed"}.`,
        runs.length || cards.length
          ? `Then fill rows you can already take from your past work. Only use facts that appear below; never invent rows.\n\nRecent run summaries:\n${runs.map((r) => `- ${r.startedAt.slice(0, 10)} ${r.skillName}: ${r.summary.slice(0, 2500)}`).join("\n") || "- none"}\n\nCards:\n${cards.map((c) => `- [${c.column}] ${c.title}${c.description ? ` — ${c.description.slice(0, 300)}` : ""}`).join("\n") || "- none"}`
          : "You have no past work yet, so return no rows.",
      ].join("\n\n"),
      maxSteps: 1,
    },
    Output.object({ schema: designSchema }),
  );
  const design = (await result.output) as z.infer<typeof designSchema>;

  return mutateDatabase(uid, looperId, (box) => {
    if (box.db) return box.db;
    const created = newDatabase(design.name, design.rowNoun, design.columns.map((c) => ({ ...c, options: c.type === "select" ? c.options : undefined })));
    const at = new Date().toISOString();
    for (const values of design.rows) {
      if (!values.some((v) => v.trim())) continue;
      const row = { id: nanoid(8), cells: {} as Record<string, DbValue>, createdBy: "looper" as const, createdAt: at, updatedAt: at };
      created.columns.forEach((col, i) => (row.cells[col.id] = coerce(col, values[i] ?? "")));
      created.rows.push(row);
    }
    box.db = created;
    return created;
  });
}

// ——— Filling the database from the looper's sources ———

const SHEETS_URL = /docs\.google\.com\/spreadsheets\//;

/**
 * Pull every row the looper can find in its connected sources (sheet, Stripe, Gmail…) into its
 * database. Designs the table first if needed. Logged as a "Fill database" run on the calendar.
 */
export async function fillDatabase(uid: string, looperId: string, trigger: Run["trigger"] = "manual") {
  // A mission or skill that points at a Google Sheet needs the Google Sheets app.
  const before = await read(uid);
  const looper = before.loopers.find((l) => l.id === looperId);
  if (!looper) throw new Error("Looper not found");
  const text = [looper.mission, ...looper.skills.map((s) => s.instructions)].join(" ");
  if (SHEETS_URL.test(text) && !looper.apps?.some((a) => a.slug === "googlesheets")) {
    const [sheets] = await resolveApps([{ slug: "googlesheets", name: "Google Sheets", via: "composio" as const }]);
    await mutate(uid, (d) => {
      const l = d.loopers.find((x) => x.id === looperId);
      if (l && !l.apps?.some((a) => a.slug === sheets.slug)) l.apps = [...(l.apps ?? []), sheets];
    });
  }

  const table = (await readDatabase(uid, looperId)) ?? (await designDatabase(uid, looperId));
  const skill: Skill = {
    id: "fill-database",
    name: "Fill database",
    kind: "work",
    schedule: { type: "manual", time: "09:00", days: [] },
    instructions: [
      `Fill your database "${table.name}" (one row = one ${table.rowNoun}) from your real sources: every app and file named in your mission and skills.`,
      `Cover the current period your mission is about (e.g. the current VAT quarter). Read the source in full, page by page.`,
      `Before adding, run db_query to see what's already there and never add a ${table.rowNoun} twice. Add rows in batches of up to 100 with db_add_rows, filling every column you can; leave unknown values empty rather than guessing.`,
      `If a source you need isn't connected or can't be read, don't invent rows: add a kanban card for the owner (for: 'you') saying exactly what to connect or share.`,
      `End with how many rows you added, from which sources, and what's still missing.`,
    ].join("\n"),
  };
  return runSkill(uid, looperId, skill.id, trigger, skill, 60);
}

// ——— Chatting with a looper ———

/** Talk to one looper directly. It answers with its own tools: board, database, apps; it can also
 * edit its core instructions and skills, and start one of its skills in the background. */
export async function beginLooperReply(uid: string, looperId: string, userText: string, by?: ChiefMessage["by"]) {
  const name = await mutate(uid, (d) => {
    const l = d.loopers.find((x) => x.id === looperId);
    if (!l) throw new Error("Looper not found");
    (d.chats ??= {})[looperId] = [...(d.chats[looperId] ?? []), { id: nanoid(8), role: "user", content: userText, at: now(), ...(by ? { by } : {}) }];
    return l.name;
  });
  const live = progressWriter(uid, `chat:${looperId}`, { label: name, href: `/loopers/${looperId}?tab=chat`, done: "replied", failed: "couldn't reply" });
  await live.ready();
  return Object.assign(() => looperChatReply(uid, looperId, live).then(() => undefined), { since: live.since });
}

async function looperChatReply(uid: string, looperId: string, live: ReturnType<typeof progressWriter>) {
  const db = await read(uid);
  const looper = db.loopers.find((l) => l.id === looperId);
  if (!looper) {
    await live.done({ error: "Looper not found" });
    return;
  }
  // Recent runs are part of the conversation: the looper reports there.
  const history = (db.chats?.[looperId] ?? []).slice(-31);
  const runs = db.runs.filter((r) => r.looperId === looperId && r.status !== "running").slice(-5);
  const actions: string[] = [];
  const links: { label: string; href: string }[] = [];
  live.push("Connecting apps…");
  // Apps, database and canvas load side by side.
  const [ext, table, canvas] = await Promise.all([looperApps(uid, looper, db), readDatabase(uid, looperId), readCanvas(uid, looperId)]);
  const pc = hasComputer() ? computerSession(uid, looperId, { label: "Chat", progress: live.push }) : null;
  let content: string;
  try {
    const own: ToolSet = {
      update_core_instructions: tool({
        description: "Rewrite your core instructions (mission, sources, rules) when the owner asks to change how you work.",
        inputSchema: z.object({ instructions: z.string().min(10) }),
        execute: ({ instructions }) =>
          mutate(uid, (d) => {
            const l = d.loopers.find((x) => x.id === looperId);
            if (l) l.mission = instructions;
            actions.push("Updated core instructions");
            return { ok: true };
          }),
      }),
      save_skill: tool({
        description: "Add a skill, or change one by name (instructions and schedule).",
        inputSchema: skillInput,
        execute: (input) =>
          mutate(uid, (d) => {
            const l = d.loopers.find((x) => x.id === looperId);
            if (!l) return { error: "gone" };
            const existing = l.skills.find((x) => x.name.toLowerCase() === input.name.toLowerCase());
            if (existing) Object.assign(existing, { instructions: input.instructions, schedule: { type: input.type, time: input.time, days: input.days } });
            else l.skills.push(toSkill(input));
            actions.push(`${existing ? "Updated" : "Added"} skill ${input.name}`);
            return { ok: true };
          }),
      }),
      start_skill: tool({
        description: "Start one of your skills now in the background; its result appears in this chat when done.",
        inputSchema: z.object({ skill: z.string() }),
        execute: async ({ skill }) => {
          const s = looper.skills.find((x) => x.name.toLowerCase() === skill.toLowerCase());
          if (!s) return { error: `No skill "${skill}". Skills: ${looper.skills.map((x) => x.name).join(", ")}` };
          after(() => runSkill(uid, looperId, s.id, "chief").then(() => undefined).catch(() => undefined));
          actions.push(`Started ${s.name}`);
          return { started: s.name };
        },
      }),
    };
    const result = await callModel(uid, db.settings, {
      instructions: [
        looperBrief(db, looper, [describeDatabase(table), describeCanvas(canvas)].filter(Boolean).join("\n\n")),
        `You're chatting with your owner. Answer as ${looper.name}, briefly and concretely, in first person. Use your tools to look things up instead of guessing; you can change your own instructions and skills when asked.`,
        runs.length ? `Your latest runs:\n${runs.map((r) => `- ${r.startedAt.slice(0, 16)} ${r.skillName} [${r.status}]: ${r.summary.slice(0, 600)}`).join("\n")}` : "",
        ext.connected.length ? `Connected apps: ${ext.connected.join(", ")}.` : "No apps connected yet.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      messages: history.map((m) => ({ role: m.role, content: authored(m) })),
      tools: { ...boardTools(uid, looperId, "looper"), ...databaseTools(uid, looperId), ...canvasTools(uid, looperId), ...askTools(uid, looperId), ...own, ...pc?.tools },
      external: ext.tools,
      maxSteps: 20,
      progress: live.push,
      onText: live.text,
      fast: true,
    });
    content = (await result.text) || (actions.length ? "Done." : "…");
  } catch (error) {
    content = `I couldn't reach the model: ${errorText(error)}`;
  } finally {
    await Promise.all([ext.close(), pc?.release()]);
  }
  const reply = { id: nanoid(8), role: "assistant" as const, content, at: now(), actions, links };
  await mutate(uid, (d) => void ((d.chats ??= {})[looperId] = [...(d.chats?.[looperId] ?? []), reply]));
  // Done only once the reply is saved, so a refresh at "done" always shows it.
  await live.done({ ok: !content.startsWith("I couldn't"), note: firstSentence(content) });
  return reply;
}
