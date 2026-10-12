// Pure steps of the looper builder: no database or model here, so test/draft.test.ts runs them on their own.

import { kindOf, KINDS, type MetricPreset, type Role, type WorkUnit } from "./roles.ts";
import type { Skill } from "./plan";

export type ToolPick = { slug: string; why: string; kind?: string }; // kind: the founder can swap it for their own tool

export type DraftData = {
  metric?: Pick<MetricPreset, "name" | "source" | "hint" | "unit" | "direction">;
  work?: WorkUnit;
  workOptions?: WorkUnit[]; // suggested by the model, your own looper only
  tools?: string[];
  toolOptions?: ToolPick[];
  picked?: string[]; // tools ticked before leaving to connect one
  skills?: Skill[];
  name?: string; // your own looper's name
  note?: string; // why the model could not suggest units of work
  trials?: { metric?: Trial; skills?: Record<string, Trial> }; // test runs before hire, skills keyed by trialKey
  stack?: Stack; // the founder's own tool per kind, in place of the role's defaults
};

/** Kind to toolkit: the help desk, CRM or inbox this founder runs, like { helpdesk: "crisp" }. */
export type Stack = Record<string, string>;

/** One stage of a test run: done, done with a caveat, or stopped. */
export type TrialStage = { name: string; ok: "yes" | "warn" | "no"; text: string };
/** A card a test run drafted. Nothing is saved or sent. `held` says why the guards kept it back. */
export type TrialCard = { title: string; detail: string; how: string; held?: string };
export type Trial = { at: string; stages: TrialStage[]; cards: TrialCard[] };

export type LooperDraft = { id: number; workspace_id: number; role: string; data: DraftData };

export const STEPS = ["Metric", "Unit of work", "Tools", "Skills", "Try it"] as const;

/** The first step that still needs an answer, 1-based. Skills written open the last step: try, then hire. */
export function nextStep(d: DraftData) {
  if (!d.metric) return 1;
  if (!d.work) return 2;
  if (!d.tools) return 3;
  if (!d.skills?.length) return 4;
  return 5;
}

/** A skill's test run belongs to what it does: a change to its name, tool, input or rules makes the old run stale. */
export function trialKey(s: Pick<Skill, "name" | "tool" | "input" | "action" | "rules">) {
  const text = [s.name, s.tool, s.input, s.action, s.rules].join("\n");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What approving a drafted card would do. */
export function cardHow(action: { tool_slug: string; arguments: Record<string, unknown> } | null, prSlug: string) {
  if (!action) return "You do it by hand";
  if (action.tool_slug === prSlug) {
    const files = Array.isArray(action.arguments.files) ? action.arguments.files.length : 0;
    return `Opens a pull request in ${String(action.arguments.repo ?? "your repo")}, ${files} file${files === 1 ? "" : "s"}`;
  }
  return `Runs ${action.tool_slug} when you approve`;
}

/** A unit of work the founder typed. One that names a pull request or GitHub ships as a pull request; the rest by hand. */
export function ownWork(text: string): WorkUnit {
  const pr = /pull request|\bPRs?\b|github/i.test(text);
  return { name: text, detail: "", action: pr ? "github_pr" : "manual", tool: pr ? "github" : "" };
}

/** "A blog post, written and shipped as a pull request to your site's GitHub repository" */
export const workLine = (w: WorkUnit) => (w.detail ? `${w.name}. ${w.detail}` : w.name);

/** Units of work for this draft: the role's own, or ones the model suggested. */
export const workOptions = (r: Role, d: DraftData) => (r.work.length ? r.work : (d.workOptions ?? []));

/** The founder's own tool in place of a role's default, when it does the same job. */
export const swap = (slug: string, stack?: Stack) => {
  const k = kindOf(slug);
  return (k && stack?.[k]) || slug;
};

/** The kind a toolkit fills for this founder: its own, or the kind a custom connector stands in for. */
export const kindIn = (slug: string, stack?: Stack) => kindOf(slug) ?? Object.keys(stack ?? {}).find((k) => stack![k] === slug);

/** The kinds a role's defaults belong to: its metrics, its units of work and the tools on its node. */
export function kindsOf(r: Role) {
  const slugs = [...r.metrics.map((m) => m.source), ...r.work.map((w) => w.tool), ...r.tools];
  return [...new Set(slugs.map(kindOf).filter((k): k is string => Boolean(k)))];
}

/** A stack for this role: the founder's picks, then for each other kind a tool already connected. */
export function stackFor(r: Role, connected: Set<string>, stack: Stack = {}): Stack {
  const out = { ...stack };
  for (const k of kindsOf(r)) {
    const on = KINDS[k].tools.find((t) => connected.has(t));
    if (!out[k] && on) out[k] = on;
  }
  return out;
}

/** A role's tools as this workspace runs them: defaults swapped for the connected tool of the same kind. */
export const toolsShown = (r: Role, connected: Set<string>) => [...new Set(r.tools.map((t) => swap(t, stackFor(r, connected))))];

/** The tools this looper needs: where the metric lives, where the work ships, and what the role reads. */
export function presetTools(r: Role, d: DraftData): ToolPick[] {
  const picks: ToolPick[] = [];
  // Each default goes in as the founder's own tool of the same kind, and keeps its kind so it can be swapped again.
  const add = (slug: string, why: string) => {
    const mine = swap(slug, d.stack);
    const kind = kindIn(slug, d.stack);
    if (mine && mine !== "manual" && mine !== "geo" && !picks.some((p) => p.slug === mine)) picks.push(kind ? { slug: mine, why, kind } : { slug: mine, why });
  };
  if (d.metric) add(d.metric.source, "Reads the metric every morning");
  if (d.work?.tool) add(d.work.tool, `Ships the work: ${d.work.name.replace(/^an? /i, "").toLowerCase()}`);
  for (const s of r.signals ?? []) add(s.tool, `Reads ${s.kind.replace(/_/g, " ")}s every day`);
  for (const s of r.setup ?? []) add(s.tool, s.name);
  return picks;
}

/** The role's preset routines that ship this unit of work, as skills. */
export function presetSkills(r: Role, w: WorkUnit | undefined, stack?: Stack): Skill[] {
  if (!w?.skills?.length) return [];
  return r.routines
    .filter((p) => w.skills!.includes(p.slug))
    .map((p) => ({ slug: p.slug, name: p.name, tool: swap(p.tool, stack), days: p.days, hour: p.hour, rules: p.rules, action: p.action ?? "tool", input: p.input ?? "" }));
}

/** Check a skill edited by hand: days 0 to 6, hour 6 to 18, rules present. */
export function cleanSkill(s: Partial<Skill>, fallback: Skill): Skill | null {
  const name = String(s.name ?? "").trim().slice(0, 80);
  const rules = String(s.rules ?? "").trim().slice(0, 2000);
  if (!name || !rules) return null;
  const days = [...new Set((s.days ?? []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
  const hour = Math.min(18, Math.max(6, Math.round(Number(s.hour ?? fallback.hour)) || fallback.hour));
  return { ...fallback, name, rules, days: days.length ? days : fallback.days, hour };
}
