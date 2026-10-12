import { pushHistory, withRepo } from "./brief";
import { sql } from "./db";
import { getPublic } from "./net";
import { connectableNames, githubFor, isConnected, runTool, toolkitNames, toolsFor, wsById } from "./tools";
import { json, modelFor, withTools, type LocalTool, type ModelConfig } from "./llm";
import { role as findRole, type ActionKind, type SetupStep } from "./roles";
import { actionsOf, routineFrom, setupOf } from "./spec";
import { readTools } from "./publish";
import { toolDef, type Looper } from "./engine";

// At hire the founder gives a website and one metric. The model writes the rest:
// a one-line brief, the week's routines with v1 rules (unless the role has presets), the tools
// it needs and, when the role reads AI answers, the 10 buyer questions it asks every day.
// Then the role's setup steps run: what the looper learns once, like where the site's pages live.

const planSchema = (SLUGS: string[], ACTIONS: string[], INPUTS: string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["brief", "routines", "tools", "questions"],
  properties: {
    brief: { type: "string", description: "What the business sells and to whom, one sentence, from the website." },
    routines: {
      type: "array",
      description: "3 or 4 routines that move the metric.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "tool", "days", "hour", "rules", "action", "input"],
        properties: {
          name: { type: "string", description: "Starts with a verb, under 40 characters, like: Rewrite titles on page 2 results" },
          tool: {
            type: "string",
            enum: [...SLUGS, ""],
            description: "Toolkit the routine works in; for github_pr, the toolkit it reads its data from, or github. Empty for work the founder does by hand.",
          },
          days: { type: "array", items: { type: "integer" }, description: "0 = Mon ... 6 = Sun" },
          hour: { type: "integer", description: "Local hour, 6 to 18" },
          rules: { type: "string", description: "3 to 5 lines of `key: value`, like `pick: pages ranking 5 to 15, last 28 days`. Numbers in every line." },
          action: {
            type: "string",
            enum: ACTIONS,
            description:
              "tool: cards are one tool call. github_pr: cards are a pull request to the website's repository; use it for any new or changed page, post or file on the site. manual: the founder does the work from a full draft on the card.",
          },
          input: { type: "string", enum: [...INPUTS, ""], description: "The daily read the routine picks from, or empty." },
        },
      },
    },
    tools: { type: "array", items: { type: "string", enum: SLUGS }, description: "Toolkits the founder should connect, most useful first, at most 4." },
    questions: {
      type: "array",
      items: { type: "string" },
      description: "Only when asked for: 10 questions a buyer would ask an AI assistant before buying this kind of product, without naming the brand. Otherwise empty.",
    },
  },
});

type Plan = {
  brief: string;
  routines: { name: string; tool: string; days: number[]; hour: number; rules: string; action: string; input: string }[];
  tools: string[];
  questions: string[];
};

/** Visible text of the homepage, at most 6,000 characters. Public hosts only, on every redirect hop. */
export async function siteText(website: string) {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(website) ? website : `https://${website}`);
  } catch {
    return "";
  }
  try {
    const r = await getPublic(url);
    if (!r || !r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return "";
    const html = (await r.text()).slice(0, 400_000);
    const title = html.match(/<title[^>]*>([^<]*)/i)?.[1] ?? "";
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "";
    const body = html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    return [title && `Title: ${title}`, desc && `Description: ${desc}`, body].filter(Boolean).join("\n").slice(0, 6000);
  } catch {
    return "";
  }
}

export type Skill = { name: string; tool: string; days: number[]; hour: number; rules: string; action: ActionKind; input: string; slug?: string };

export type PlanInput = {
  workspaceId: number;
  website: string;
  role: string;
  metric: { name: string; hint: string; source: string; direction: string };
  work?: string; // the unit of work picked in the builder
  workAction?: ActionKind | ""; // what that unit ships as; limits what the routines may do
  tools?: string[]; // tools picked in the builder; routines work in these
  presets: boolean; // routines are already set; the model writes the brief, tools and questions only
  change?: { skills: Skill[]; ask: string }; // rewrite these skills as the founder asks
};

/** Whether this looper asks the buyer questions every day. */
export const asksQuestions = (roleId: string, source: string) =>
  source === "geo" || Boolean(findRole(roleId)?.signals?.some((x) => x.tool === "geo"));

/** One model call: the brief, routines with v1 rules, the tools to connect and, when the role reads AI answers, buyer questions. */
export async function writePlan(cfg: ModelConfig, p: PlanInput) {
  // Plan only with tools the founder can connect today.
  const TOOLKITS = await connectableNames(p.workspaceId);
  const picked = (p.tools ?? []).filter((t) => TOOLKITS[t]);
  const SLUGS = Object.keys(TOOLKITS);
  const r = findRole(p.role);
  const site = p.website ? await siteText(p.website) : "";
  const roleActions = actionsOf(r);
  // A unit of work shipped through a tool or a pull request keeps by-hand cards for what the looper cannot do itself.
  const ACTIONS: ActionKind[] = p.workAction ? [...new Set<ActionKind>([p.workAction, "manual"])] : roleActions;
  const INPUTS = (r?.signals ?? []).map((x) => x.kind);
  const asks = asksQuestions(p.role, p.metric.source);
  const prompt = [
    `Website: ${p.website || "none given"}`,
    site ? `Homepage text:\n${site}` : "The homepage could not be read. Work from the website name and the metric.",
    `Role: ${r?.name ?? p.role}`,
    `Metric: ${p.metric.name}. ${p.metric.hint}`,
    `Metric source: ${p.metric.source === "manual" ? "the founder enters it" : p.metric.source === "geo" ? "AI answers to buyer questions" : TOOLKITS[p.metric.source] ?? p.metric.source}`,
    `Higher is ${p.metric.direction === "up" ? "better" : "worse"}. There is no target: the looper always works to improve the metric.`,
    p.work && `Unit of work: ${p.work}. Every card a routine proposes is one of these.`,
    picked.length && `Tools the founder picked: ${picked.map((t) => `${t} (${TOOLKITS[t]})`).join(", ")}. Routines work in these tools.`,
    r?.guide ?? "",
    r?.signals?.length && `Daily reads a routine can pick from: ${r.signals.map((x) => `${x.kind} (${x.read})`).join("; ")}`,
    p.presets ? "Routines are already set for this role. Return an empty routines list." : "",
    p.change &&
      [
        "Current routines:",
        ...p.change.skills.map((x, i) => `${i + 1}. ${x.name} | tool ${x.tool || "by hand"} | days ${x.days.join(",")} | hour ${x.hour} | action ${x.action}\n${x.rules}`),
        `The founder asks: ${p.change.ask}`,
        "Return the full list of routines with that change made. Keep what they did not ask to change as it is.",
      ].join("\n"),
    asks ? "Write the 10 buyer questions." : "",
    `Toolkits that can be connected: ${SLUGS.map((s) => `${s} (${TOOLKITS[s]})`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const plan = await json<Plan>(
    cfg,
    [
      "You set up a looper: an AI hire that owns one business metric and works on a weekly calendar of routines.",
      "Each routine runs at its days and hour and proposes cards the founder approves. Write routines that move the metric within weeks.",
      "Spread routines across the week, at most 2 on one day. Rules are short `key: value` lines with numbers, never prose.",
      "Anything that publishes, spends money or emails a customer is a draft the founder approves.",
      "Plain words. No em dashes, no buzzwords.",
    ].join("\n"),
    prompt,
    "plan",
    planSchema(SLUGS, ACTIONS, INPUTS),
  );

  const skills: Skill[] = p.presets
    ? []
    : plan.routines
        .filter((x) => x.name && x.rules && x.days?.length)
        .slice(0, p.change ? 6 : 4)
        .map((rt) => {
          const days = [...new Set(rt.days.filter((d) => d >= 0 && d <= 6))].sort();
          const action = ACTIONS.includes(rt.action as ActionKind) ? (rt.action as ActionKind) : ACTIONS.includes("manual") ? "manual" : ACTIONS[0];
          // A pull request routine ships through GitHub and keeps the tool it reads its data from, like Search Console.
          const tool = TOOLKITS[rt.tool] ? rt.tool : action === "github_pr" ? "github" : "";
          return {
            name: rt.name.slice(0, 80),
            tool,
            days: days.length ? days : [0],
            hour: Math.min(18, Math.max(6, Math.round(rt.hour))),
            rules: rt.rules.slice(0, 2000),
            action,
            input: INPUTS.includes(rt.input) ? rt.input : "",
          };
        });
  if (!p.presets && !skills.length) throw new Error("The model returned no routines");
  // The metric's own tool stays in the dock, whatever the model picked, even before it has a Composio auth config.
  const ALL = await toolkitNames(p.workspaceId);
  const own = [p.metric.source, ...picked, ...(r?.signals ?? []).map((x) => x.tool), ...(r?.setup ?? []).map((x) => x.tool)];
  const tools = [...new Set([...own, ...plan.tools, ...skills.map((x) => x.tool)].filter((t) => (own.includes(t) ? ALL[t] : TOOLKITS[t])))].slice(0, 5);
  return {
    brief: plan.brief.slice(0, 400),
    skills,
    tools,
    questions: asks ? plan.questions.filter(Boolean).slice(0, 10) : [],
  };
}

/** Insert a looper's routines, each with its v1 rules. */
export async function insertSkills(looperId: number, roleId: string, skills: Skill[], source: string) {
  const r = findRole(roleId);
  let n = 0;
  for (const rt of skills) {
    n++;
    const preset = r?.routines.find((x) => x.slug === rt.slug);
    const x = routineFrom(r, { tool: rt.tool, action: rt.action, input: rt.input || undefined, check: preset?.check });
    const [row] = await sql<{ id: number }>`
      insert into routines (looper_id, slug, name, tool, days, hour, input, action, check_days, check_read, check_tool)
      values (${looperId}, ${rt.slug || `routine-${n}`}, ${rt.name.slice(0, 80)}, ${rt.tool}, ${rt.days}, ${rt.hour},
              ${x.input}, ${x.action}, ${x.check_days}, ${x.check_read}, ${x.check_tool})
      on conflict (looper_id, slug) do nothing returning id`;
    if (row) await sql`insert into routine_versions (routine_id, version, rules, source) values (${row.id}, 1, ${rt.rules}, ${source})`;
  }
}

/**
 * Write the looper's routines. Claims the looper first, so a hire, a key save and
 * a scheduler tick can all call this without planning twice. Returns false when
 * there is nothing to do or no model yet. A looper hired from the builder already has
 * its routines and tools; this writes its brief and buyer questions and runs setup.
 */
export async function planLooper(looperId: number) {
  const [pre] = await sql<{ user_id: number }>`select user_id from loopers where id = ${looperId} and fired_at is null and plan_status in ('waiting','failed')`;
  if (!pre) return false;
  const cfg = await modelFor(pre.user_id);
  if (!cfg) return false;
  const [l] = await sql<Looper>`
    update loopers set plan_status = 'planning', plan_error = null, plan_at = now()
    where id = ${looperId} and plan_status in ('waiting','failed') returning *`;
  if (!l) return false;

  try {
    const [{ n: preset }] = await sql<{ n: number }>`select count(*)::int as n from routines where looper_id = ${l.id}`;
    const plan = await writePlan(cfg, {
      workspaceId: l.workspace_id,
      website: l.website,
      role: l.role,
      metric: { name: l.metric_name, hint: l.metric_hint, source: l.metric_source, direction: l.direction },
      work: l.work,
      tools: l.tools,
      presets: preset > 0,
    });
    await insertSkills(l.id, l.role, plan.skills, "plan");
    // Tools picked in the builder stay as they are.
    const tools = l.work && l.tools.length ? l.tools : plan.tools;
    await sql`update loopers set plan_status = 'ready', brief = ${plan.brief}, tools = ${tools},
      prompts = ${JSON.stringify(plan.questions)} where id = ${l.id}`;
    await runSetup(l.id).catch((e) => console.error(`setup looper ${l.id}:`, (e as Error).message));
    return true;
  } catch (e) {
    await sql`update loopers set plan_status = 'failed', plan_error = ${String((e as Error).message).slice(0, 500)} where id = ${l.id}`;
    return false;
  }
}

/** Plan every looper of this user that is still waiting for a model. */
export async function planWaiting(userId: number) {
  const ls = await sql<{ id: number }>`select id from loopers where user_id = ${userId} and fired_at is null and plan_status in ('waiting','failed')`;
  for (const l of ls) await planLooper(l.id);
}

/** The setup steps of one looper: its role's, plus the repo step once a routine ships pull requests. */
export async function setupSteps(l: Pick<Looper, "id" | "role">) {
  const rows = await sql<{ action: string }>`select distinct action from routines where looper_id = ${l.id}`;
  return setupOf(findRole(l.role), rows.map((r) => r.action));
}

/**
 * Run the looper's setup steps that have not succeeded yet. A step whose tool is not connected
 * waits; the tick runs it again once the tool is there. `force` runs every step again.
 */
export async function runSetup(looperId: number, force = false) {
  const [l] = await sql<Looper>`select * from loopers where id = ${looperId}`;
  if (!l) return 0;
  const steps = await setupSteps(l);
  if (!steps.length) return 0;
  const cfg = await modelFor(l.user_id);
  if (!cfg) return 0;
  let n = 0;
  for (const step of steps) {
    if (!force && l.setup?.[step.id]?.status === "done") continue;
    const prev = l.setup?.[step.id];
    const result = await setupStep(l, step, cfg).then(
      (text) => (text ? { status: "done", text } : { status: "waiting", text: "" }),
      (e) => ({ status: "failed", text: String((e as Error).message).slice(0, 500) }),
    );
    // A failed or empty read keeps notes the looper already had; a new read moves them, edits included, into history.
    const entry = result.status !== "done" && prev?.status === "done" ? prev : { ...result, at: new Date().toISOString(), history: pushHistory(prev) };
    await sql`update loopers set setup = setup || ${JSON.stringify({ [step.id]: entry })}::jsonb where id = ${l.id}`;
    if (result.status === "done") n++;
  }
  return n;
}

/** One setup step. Empty when its tool is not connected yet. */
async function setupStep(l: Looper, step: SetupStep, cfg: NonNullable<Awaited<ReturnType<typeof modelFor>>>) {
  let tools: LocalTool[] = [];
  if (step.tool) {
    if (!(await isConnected(l.workspace_id, step.tool))) return "";
    const ws = await wsById(l.workspace_id);
    tools =
      step.tool === "github"
        ? readTools(await githubFor(ws), step.id === "repo" ? l.repo : "")
        : (await toolsFor(l.workspace_id, step.tool, 30)).map((t) => toolDef(t, (a) => runTool(ws, t.slug, a)));
  }
  const out = await withTools(
    cfg,
    "You set up a looper: an AI hire that owns one business metric. Learn what it needs once, by reading. Never change anything. Plain words, no em dashes.",
    [
      `Website: ${l.website || "none given"}`,
      l.brief && `What the business does: ${l.brief}`,
      // A repository a person picked is a given: the step learns how it is laid out, never which one it is.
      step.id === "repo" && l.repo && `The repository is ${l.repo}, picked by the founder. Read it; never look for another.`,
      step.ask,
      "Answer in under 200 words, short `key: value` lines, nothing else.",
    ]
      .filter(Boolean)
      .join("\n"),
    tools,
    12,
  );
  if (!out.trim()) throw new Error("The model returned nothing");
  const text = out.trim().slice(0, 3000);
  return step.id === "repo" && l.repo ? withRepo(text, l.repo) : text;
}

/** Loopers with a setup step still to do whose tool may be connected now, tried at most every 6 hours. */
export function setupPending(l: Looper, steps: SetupStep[], now = new Date()) {
  return steps.some((s) => {
    const st = l.setup?.[s.id];
    return !st || (st.status !== "done" && now.getTime() - new Date(st.at).getTime() > 6 * 3600e3);
  });
}
