import { sql } from "./db";
import { json, modelFor, type ModelConfig } from "./llm";
import { connectableNames } from "./tools";
import { role as findRole, kindOf, type ActionKind, type Role } from "./roles";
import { actionsOf } from "./spec";
import { siteText, writePlan, type Skill } from "./plan";
import { presetSkills, presetTools, workLine, type DraftData, type LooperDraft, type ToolPick } from "./draft-steps";

export * from "./draft-steps";

// The looper builder at /app/new: metric, unit of work, tools, skills, one screen each.
// A predefined role fills every step from its spec; your own looper gets each step suggested by the model.
// The draft lives in `drafts` until hire turns it into a looper.

export async function loadDraft(id: number, userId: number) {
  const [d] = await sql<LooperDraft>`
    select d.id, d.workspace_id, d.role, d.data from drafts d join members m on m.workspace_id = d.workspace_id
    where d.id = ${id} and m.user_id = ${userId}`;
  return d ?? null;
}

export async function saveDraft(id: number, data: DraftData) {
  await sql`update drafts set data = ${JSON.stringify(data)}::jsonb, updated_at = now() where id = ${id}`;
}

export async function createDraft(workspaceId: number, userId: number, roleId: string, data: DraftData) {
  const [d] = await sql<{ id: number }>`
    insert into drafts (workspace_id, created_by, role, data) values (${workspaceId}, ${userId}, ${roleId}, ${JSON.stringify(data)}::jsonb)
    returning id`;
  return d.id;
}

/** Your own looper: 3 units of work that move this metric for this business, and which way the metric should go. */
export async function suggestWork(cfg: ModelConfig, workspaceId: number, website: string, r: Role, m: NonNullable<DraftData["metric"]>) {
  const TOOLKITS = await connectableNames(workspaceId);
  const SLUGS = Object.keys(TOOLKITS);
  const ACTIONS = actionsOf(r);
  const site = website ? await siteText(website) : "";
  const out = await json<{ lower_is_better: boolean; units: { name: string; detail: string; action: string; tool: string }[] }>(
    cfg,
    [
      "You help a founder set up a looper: an AI hire that owns one business metric and proposes one card at a time for the founder to approve.",
      "A unit of work is what one card ships, like a blog post, an email to one person, a change to one campaign.",
      "Decide if the metric improves when it goes down, like churn, cost per lead or response time.",
      "Suggest the 3 units of work that would move this metric most for this business, most useful first.",
      "Plain words, sentence case. No em dashes, no buzzwords.",
    ].join("\n"),
    [
      `Website: ${website || "none given"}`,
      site && `Homepage text:\n${site}`,
      `Metric: ${m.name}`,
      `Metric source: ${m.source === "manual" ? "the founder enters it" : (TOOLKITS[m.source] ?? m.source)}`,
      `Toolkits that can be connected: ${SLUGS.map((s) => `${s} (${TOOLKITS[s]})`).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "units",
    {
      type: "object",
      additionalProperties: false,
      required: ["lower_is_better", "units"],
      properties: {
        lower_is_better: { type: "boolean", description: "True when the metric improves as it goes down" },
        units: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "detail", "action", "tool"],
            properties: {
              name: { type: "string", description: "Starts with A or An, under 50 characters, like: A blog post" },
              detail: { type: "string", description: "How it ships, under 90 characters, like: Drafted in Gmail, sent after you approve it" },
              action: {
                type: "string",
                enum: ACTIONS,
                description: "tool: one tool call. github_pr: a pull request to the website's repository, for a new or changed page. manual: the founder does it from the card.",
              },
              tool: { type: "string", enum: [...SLUGS, ""], description: "Toolkit it ships through, or empty when the founder does it by hand." },
            },
          },
        },
      },
    },
  );
  const units = out.units.slice(0, 3).map((u) => ({
    name: u.name.slice(0, 60),
    detail: u.detail.slice(0, 120),
    action: (ACTIONS.includes(u.action as ActionKind) ? u.action : "manual") as ActionKind,
    tool: u.action === "github_pr" && ACTIONS.includes("github_pr") ? "github" : TOOLKITS[u.tool] ? u.tool : "",
  }));
  return { units, direction: (out.lower_is_better ? "down" : "up") as "up" | "down" };
}

/** Your own looper: 1 to 3 tools for this metric and unit of work, each with the reason. */
export async function suggestTools(cfg: ModelConfig, workspaceId: number, r: Role, d: DraftData): Promise<ToolPick[]> {
  const base = presetTools(r, d);
  const TOOLKITS = await connectableNames(workspaceId);
  const SLUGS = Object.keys(TOOLKITS);
  const out = await json<{ tools: { slug: string; why: string }[] }>(
    cfg,
    "You pick the tools a looper connects: an AI hire that owns one business metric. Pick 1 to 3, fewer is better. Each reason is under 60 characters, plain words, no em dashes.",
    [
      `Metric: ${d.metric?.name}, read from ${d.metric?.source === "manual" ? "the founder" : (TOOLKITS[d.metric?.source ?? ""] ?? d.metric?.source)}`,
      d.work && `Unit of work: ${workLine(d.work)}`,
      base.length && `Already picked: ${base.map((b) => TOOLKITS[b.slug] ?? b.slug).join(", ")}. Add only what is missing.`,
      `Toolkits that can be connected: ${SLUGS.map((s) => `${s} (${TOOLKITS[s]})`).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
    "tools",
    {
      type: "object",
      additionalProperties: false,
      required: ["tools"],
      properties: {
        tools: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["slug", "why"],
            properties: { slug: { type: "string", enum: SLUGS }, why: { type: "string", description: "Like: Reads which pages bring signups" } },
          },
        },
      },
    },
  );
  const more = out.tools.filter((t) => TOOLKITS[t.slug] && !base.some((b) => b.slug === t.slug)).map((t) => {
      const kind = kindOf(t.slug);
      return { slug: t.slug, why: t.why.slice(0, 80), ...(kind ? { kind } : {}) };
    });
  return [...base, ...more].slice(0, 3);
}

/** Skills for the draft: the role's presets for this unit of work, or written by the model. `ask` rewrites the current ones. */
export async function writeSkills(d: LooperDraft, website: string, ownerId: number, ask?: string): Promise<Skill[]> {
  const r = findRole(d.role)!;
  if (!ask) {
    const preset = presetSkills(r, d.data.work, d.data.stack);
    if (preset.length) return preset;
  }
  const cfg = await modelFor(ownerId);
  if (!cfg) throw new Error("Connect your AI model first, in Settings.");
  const m = d.data.metric!;
  const plan = await writePlan(cfg, {
    workspaceId: d.workspace_id,
    website,
    role: d.role,
    metric: { name: m.name, hint: m.hint, source: m.source, direction: m.direction },
    work: d.data.work ? workLine(d.data.work) : undefined,
    workAction: d.data.work?.action,
    tools: d.data.tools,
    presets: false,
    change: ask ? { skills: d.data.skills ?? [], ask } : undefined,
  });
  return plan.skills;
}

