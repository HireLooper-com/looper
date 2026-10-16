import "server-only";
import { isStepCount, Output, streamText, tool, type ModelMessage, type ToolSet } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { listUsers, mutate, read } from "./db";
import { composioTools, resolveApps } from "./composio";
import { connectTools, integrationsFor } from "./integrations";
import { getModel, hasCredentials } from "./llm";
import { describeSchedule, isDue } from "./schedule";
import { appFromName } from "./apps";
import type { AppRef, Card, Column, DB, Looper, Retro, Run, Settings, Skill, ToolCallLog } from "./types";
import { ACCENTS } from "./types";

const now = () => new Date().toISOString();
const DAY = 86_400_000;
const columnSchema = z.enum(["backlog", "todo", "doing", "done"]);

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
}

/**
 * Every call streams: ChatGPT plan usage requires stream:true and store:false, and the same
 * path works for API keys. Integration tools stay out of the request until `find_tools` picks them,
 * so a hub with thousands of tools costs a handful of definitions per step.
 */
async function callModel(uid: string, settings: Settings, opts: CallOptions, output?: Parameters<typeof streamText>[0]["output"]) {
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
  const result = streamText({
    model: m.model,
    instructions: opts.instructions,
    ...(opts.messages ? { messages: opts.messages } : { prompt: opts.prompt ?? "" }),
    tools: Object.keys(all).length ? m.wrapTools(all) : undefined,
    providerOptions: m.providerOptions,
    stopWhen: isStepCount(opts.maxSteps ?? 12),
    prepareStep: hasExternal ? () => ({ activeTools: [...Object.keys(base), "find_tools", ...discovered] }) : undefined,
    output,
    // Subscription usage errors (limits) shouldn't be retried automatically.
    maxRetries: (settings.authMode[settings.provider] ?? "key") === "oauth" ? 0 : 2,
    onError: ({ error }) => {
      failure = error;
    },
  });
  await result.consumeStream();
  if (failure) throw failure;
  return result;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ——— Looper context and built-in tools ———

function metricLine(l: Looper) {
  const last = l.metric.history.at(-1);
  return `${l.metric.name}: ${last ? `${last.value} ${l.metric.unit}` : "no reading yet"} (target ${l.metric.target} ${l.metric.unit}, ${l.metric.direction === "up" ? "higher is better" : "lower is better"})`;
}

function looperBrief(db: DB, l: Looper) {
  const cards = db.cards.filter((c) => c.looperId === l.id && c.column !== "done");
  const retro = db.retros.filter((r) => r.looperId === l.id).at(-1);
  return [
    `You are ${l.name}, a looper: an autonomous operator who owns exactly one business metric and works in loops.`,
    `Mission: ${l.mission}`,
    `Your metric — ${metricLine(l)}. Everything you do should move this number.`,
    `Recent metric history: ${l.metric.history.slice(-8).map((p) => `${p.at.slice(0, 10)}=${p.value}`).join(", ") || "none"}.`,
    `Open kanban cards:\n${cards.map((c) => `- [${c.column}] ${c.id}: ${c.title}`).join("\n") || "- none"}`,
    retro ? `Your last retro said to try next:\n${retro.tryNext.map((t) => `- ${t}`).join("\n")}` : "",
    `Your skills: ${l.skills.map((s) => `${s.name} (${describeSchedule(s.schedule)})`).join("; ")}.`,
    "Work rules: keep your kanban board current (add cards for work you plan, move them as you go). When you learn the latest metric value from a real source, record it with metric_record. To use an external app (CRM, email, social, analytics, docs, …), call find_tools with the app and action, then call the tool it returns. Never invent data. Finish with a 2–4 sentence summary of what you did and what changed.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function boardTools(uid: string, looperId: string, actor: Card["createdBy"]): ToolSet {
  return {
    kanban_list: tool({
      description: "List the cards on your kanban board.",
      inputSchema: z.object({}),
      execute: async () => (await read(uid)).cards.filter((c) => c.looperId === looperId),
    }),
    kanban_add_card: tool({
      description: "Add a card to your kanban board.",
      inputSchema: z.object({ title: z.string(), description: z.string().default(""), column: columnSchema.default("todo") }),
      execute: ({ title, description, column }) =>
        mutate(uid, (db) => {
          const card: Card = { id: nanoid(8), looperId, title, description, column, createdBy: actor, createdAt: now(), updatedAt: now() };
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

export async function runSkill(uid: string, looperId: string, skillId: string, trigger: Run["trigger"] = "manual") {
  const db = await read(uid);
  const looper = db.loopers.find((l) => l.id === looperId);
  const skill = looper?.skills.find((s) => s.id === skillId);
  if (!looper || !skill) throw new Error("Looper or skill not found");
  if (skill.kind === "retro") return runRetro(uid, looperId, trigger, skill);

  const run = await startRun(uid, looper, skill, trigger);
  const ext = await connectTools(integrationsFor(looper, db.settings));
  const composioSlugs = (await resolveApps((looper.apps ?? []).filter((a) => a.via === "composio")).catch(() => [])).map((a) => a.slug);
  const apps = await composioTools(uid, composioSlugs).catch((e) => ({ tools: {}, connected: [] as string[], missing: composioSlugs, error: errorText(e) }));
  ext.tools = { ...ext.tools, ...apps.tools };
  ext.connected.push(...apps.connected);
  if (apps.missing.length) ext.failed.push(...apps.missing.map((slug) => ({ name: `${slug} (not connected yet)`, error: "" })));
  try {
    const hasExternal = Object.keys(ext.tools).length > 0;
    const result = await callModel(uid, db.settings, {
      instructions: looperBrief(db, looper),
      prompt: [
        `Run your skill "${skill.name}" now.`,
        skill.instructions,
        hasExternal ? `Connected integrations: ${ext.connected.join(", ")}.` : "No external integrations are connected; work with your board and say what integration would help.",
        ext.failed.length ? `Unavailable: ${ext.failed.map((f) => f.name).join(", ")}. If you need one of these, add a card asking the user to connect it on your Apps tab.` : "",
      ].join("\n\n"),
      tools: boardTools(uid, looper.id, "looper"),
      external: ext.tools,
      maxSteps: 25,
    });
    const text = await result.text;
    await finishRun(uid, run.id, { status: "success", summary: text, toolCalls: logToolCalls(await result.steps) });
    return { ...run, status: "success" as const, summary: text };
  } catch (error) {
    const summary = errorText(error);
    await finishRun(uid, run.id, { status: "error", summary });
    return { ...run, status: "error" as const, summary };
  } finally {
    await ext.close();
  }
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
    const result = await callModel(
      uid,
      db.settings,
      {
        instructions: looperBrief(db, looper),
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
        d.cards.push({ id: nanoid(8), looperId, title: c.title, description: c.description, column: "todo", createdBy: "looper", createdAt: now(), updatedAt: now() });
    });
    const summary = `Retro: effectiveness ${retro.effectiveness}/5. Next: ${retro.tryNext.join("; ")}`;
    await finishRun(uid, run.id, { status: "success", summary });
    return { ...run, status: "success" as const, summary };
  } catch (error) {
    const summary = errorText(error);
    await finishRun(uid, run.id, { status: "error", summary });
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

/** Run every user's due skills. Called by the in-process ticker or a cron hitting /api/tick. */
let ticking = false;
export async function tick() {
  if (ticking) return { started: [] as string[] };
  ticking = true;
  const started: string[] = [];
  try {
    for (const user of await listUsers()) {
      const db = await read(user.id);
      if (!hasCredentials(db.settings)) continue;
      const due = db.loopers.filter((l) => l.status === "active").flatMap((l) => l.skills.filter((s) => isDue(s)).map((s) => ({ l, s })));
      for (const { l, s } of due) {
        await runSkill(user.id, l.id, s.id, "schedule");
        started.push(`${user.id}/${l.name}/${s.name}`);
      }
    }
    return { started };
  } finally {
    ticking = false;
  }
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
      description: "List connected integration hubs (MCP servers) that loopers can use.",
      inputSchema: z.object({}),
      execute: async () => (await read(uid)).settings.integrations.map((i) => ({ id: i.id, name: i.name, kind: i.kind, enabled: i.enabled })),
    }),
    create_looper: tool({
      description: "Hire a new looper. Each looper owns exactly ONE business metric. Give it 1–4 work skills on sensible schedules; a weekly retro skill is added automatically.",
      inputSchema: z.object({
        name: z.string().describe("short, human first name–style, e.g. 'Ivy'"),
        emoji: z.string().default("◎"),
        mission: z.string(),
        metric: z.object({ name: z.string(), unit: z.string(), direction: z.enum(["up", "down"]), target: z.number(), current: z.number().optional() }),
        skills: z.array(skillInput).min(1).max(4),
        apps: z.array(z.string()).max(8).default([]).describe("apps the looper needs, by name, e.g. ['Stripe', 'Gmail', 'bunq']"),
        starterCards: z.array(z.string()).max(5).default([]),
      }),
      execute: async (input) => {
        const apps = await resolveApps(dedupeApps(input.apps.map(appFromName)));
        return mutate(uid, (db) => {
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
              history: input.metric.current === undefined ? [] : [{ at: now(), value: input.metric.current, note: "baseline from Chief" }],
            },
            skills: [...input.skills.map(toSkill), defaultRetroSkill()],
            integrationIds: "all",
            apps,
            status: "active",
            createdAt: now(),
          };
          db.loopers.push(looper);
          if (looper.apps?.length) links.push({ label: `Connect ${looper.apps.map((a) => a.name).join(", ")} for ${looper.name}`, href: `/loopers/${looper.id}?tab=apps` });
          for (const title of input.starterCards)
            db.cards.push({ id: nanoid(8), looperId: looper.id, title, description: "", column: "todo", createdBy: "chief", createdAt: now(), updatedAt: now() });
          actions.push(`Hired ${looper.name}`);
          return { id: looper.id, name: looper.name };
        });
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
        return mutate(uid, (db) => {
          const l = findLooper(db, input.looper);
          if (added.length) {
            l.apps = dedupeApps([...(l.apps ?? []), ...added]);
            links.push({ label: `Connect apps for ${l.name}`, href: `/loopers/${l.id}?tab=apps` });
          }
          if (input.mission) l.mission = input.mission;
          if (input.target !== undefined) l.metric.target = input.target;
          if (input.status) l.status = input.status;
          if (input.addSkills) l.skills.push(...input.addSkills.map(toSkill));
          actions.push(`Updated ${l.name}`);
          return { ok: true };
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
          return { ok: true };
        }),
    }),
    assign_card: tool({
      description: "Put a task on a looper's kanban board.",
      inputSchema: z.object({ looper: z.string(), title: z.string(), description: z.string().default("") }),
      execute: ({ looper, title, description }) =>
        mutate(uid, (db) => {
          const l = findLooper(db, looper);
          db.cards.push({ id: nanoid(8), looperId: l.id, title, description, column: "todo", createdBy: "chief", createdAt: now(), updatedAt: now() });
          actions.push(`Assigned "${title}" to ${l.name}`);
          return { ok: true };
        }),
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

const CHIEF_INSTRUCTIONS = `You are Chief, the head of a team of loopers. A looper is an AI operator hired to move exactly one business metric. It has one kanban board, a calendar of scheduled skills, and a retro board where it judges its own effectiveness.

Your job: turn the user's goals into loopers, manage them, and report on them. When the user wants something done repeatedly, propose a looper (name, one metric with unit/direction/target, 1–4 scheduled skills that name the apps to use) and hire it with create_looper — don't ask more than one clarifying question first. One metric per looper, always; split goals that have two metrics into two loopers.

Always pass the apps the looper needs in create_looper.apps (e.g. a VAT looper with a bunq account, Stripe income and invoices in Gmail → ["bunq", "Stripe", "Gmail"]). The app shows the user one-click Connect buttons for them right after hiring, so say "connect them with the button below" rather than explaining setup.

Be brief and concrete. Use plain text with short lists.`;

export async function chiefReply(uid: string, userText: string) {
  const db = await read(uid);
  const userMsg = { id: nanoid(8), role: "user" as const, content: userText, at: now() };
  await mutate(uid, (d) => void d.chief.push(userMsg));

  const history: ModelMessage[] = [...db.chief.slice(-30), userMsg].map((m) => ({ role: m.role, content: m.content }));
  const actions: string[] = [];
  const links: { label: string; href: string }[] = [];
  let content: string;
  try {
    const team = db.loopers.map((l) => `- ${l.name} (${l.status}): ${metricLine(l)}`).join("\n") || "- nobody hired yet";
    const result = await callModel(uid, db.settings, {
      instructions: `${CHIEF_INSTRUCTIONS}\n\nToday is ${new Date().toDateString()}.\nCurrent team:\n${team}\nIntegration hubs: ${db.settings.integrations.filter((i) => i.enabled).map((i) => i.name).join(", ") || "none"}`,
      messages: history,
      tools: chiefTools(uid, actions, links),
      maxSteps: 12,
    });
    content = (await result.text) || (actions.length ? "Done." : "…");
  } catch (error) {
    content = `I couldn't reach the model: ${errorText(error)}`;
  }
  const reply = { id: nanoid(8), role: "assistant" as const, content, at: now(), actions, links };
  await mutate(uid, (d) => void d.chief.push(reply));
  return reply;
}
