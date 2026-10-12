import { isConnected, toolkitNames } from "./tools";
import { modelFor } from "./llm";
import { role as findRole } from "./roles";
import { measureMetric, planCards, type Looper } from "./engine";
import { fetchSignal } from "./signals";
import { PR_SLUG } from "./publish";
import { cardHow, workLine, type LooperDraft, type Trial, type TrialStage } from "./draft-steps";
import type { Skill } from "./plan";
import type { Workspace } from "./workspace";

// Test runs in the builder, before hire. They run the same code a hired looper runs, on the
// owner's key and the workspace's tools, and save nothing: no reading, no ledger row, no card.

const now = () => new Date().toISOString();
/** A model provider's 401 says the key is wrong; anything else is shown as the provider said it. */
const why = (e: unknown) => {
  const msg = String((e as Error).message ?? e);
  return /\b401\b|authentication_error|invalid[_ ]x?-?api[_ ]key|incorrect api key/i.test(msg)
    ? "Your AI key was rejected. Update it in Settings."
    : msg.slice(0, 400);
};
const fail = (stages: TrialStage[], name: string, e: unknown): Trial => ({ at: now(), stages: [...stages, { name, ok: "no", text: why(e) }], cards: [] });

/** The looper this draft would hire, not saved. Its id 0 matches no card, reading or ledger row. */
function draftLooper(d: LooperDraft, w: Workspace): Looper {
  const m = d.data.metric!;
  return {
    id: 0,
    user_id: w.owner_id,
    workspace_id: w.id,
    role: d.role,
    name: d.data.name || "Looper",
    metric_name: m.name,
    metric_source: m.source,
    metric_hint: m.hint,
    unit: m.unit,
    direction: m.direction,
    target: null,
    target_date: "",
    created_at: new Date(),
    website: w.website,
    brief: "",
    tools: d.data.tools ?? [],
    prompts: [],
    plan_status: "ready",
    plan_error: null,
    setup: {},
    signals_at: {},
    work: d.data.work ? workLine(d.data.work) : "",
    repo: d.data.repo ?? "",
    fired_at: null,
  };
}

async function model(w: Workspace) {
  const cfg = await modelFor(w.owner_id);
  if (!cfg) throw new Error(w.role === "owner" ? "Add your AI key in Settings first." : `${w.owner_email} has not added an AI key yet.`);
  return cfg;
}

/** Read the metric once from its tool, as the daily read will. */
export async function tryMetric(d: LooperDraft, w: Workspace): Promise<Trial> {
  const m = d.data.metric!;
  const names = await toolkitNames(w.id);
  const tool = names[m.source] ?? m.source;
  if (m.source === "manual") return { at: now(), stages: [{ name: "Reading", ok: "warn", text: "You enter it yourself." }], cards: [] };
  if (m.source === "geo")
    return {
      at: now(),
      stages: [{ name: "Reading", ok: "warn", text: "First reading comes right after hire." }],
      cards: [],
    };
  const stages: TrialStage[] = [];
  if (!(await isConnected(w.id, m.source)))
    return { at: now(), stages: [{ name: "Tool", ok: "no", text: `Connect ${tool} first.` }], cards: [] };
  stages.push({ name: "Tool", ok: "yes", text: `${tool} connected.` });
  try {
    const { value } = await measureMetric(draftLooper(d, w), await model(w));
    stages.push({ name: "Reading", ok: "yes", text: `${m.name.split(",")[0]}: ${value.toLocaleString("en-US")}${m.unit && m.unit.length < 3 ? m.unit : m.unit ? ` ${m.unit}` : ""}` });
    return { at: now(), stages, cards: [] };
  } catch (e) {
    return fail(stages, "Reading", e);
  }
}

/** Run one skill once: tools, the signal it picks from, what it reads, the cards it drafts and what the guards hold back. */
export async function trySkill(d: LooperDraft, w: Workspace, s: Skill): Promise<Trial> {
  const stages: TrialStage[] = [];
  const names = await toolkitNames(w.id);
  const name = (slug: string) => names[slug] ?? slug;
  const looper = draftLooper(d, w);
  let cfg;
  try {
    cfg = await model(w);
  } catch (e) {
    return fail(stages, "Model", e);
  }

  // 1. Where it acts.
  if (s.action === "github_pr") {
    if (!(await isConnected(w.id, "github"))) stages.push({ name: "Tool", ok: "warn", text: "GitHub not connected, so cards are by hand." });
    else if (!d.data.repo) return { at: now(), stages: [{ name: "Repo", ok: "no", text: "Pick the repository above first. Pull requests go there and nowhere else." }], cards: [] };
    else stages.push({ name: "Repo", ok: "yes", text: `Reads ${d.data.repo} only.` });
  } else if (s.action === "manual" || !s.tool) {
    stages.push({ name: "Tool", ok: "yes", text: "Cards are manual." });
  } else {
    stages.push(
      (await isConnected(w.id, s.tool))
        ? { name: "Tool", ok: "yes", text: `${name(s.tool)} connected.` }
        : { name: "Tool", ok: "warn", text: `${name(s.tool)} not connected, so cards are manual.` },
    );
  }

  // 2. The daily read it picks from, read once now instead of from the ledger.
  let rows: { key: string; status: "open"; data: Record<string, unknown> }[] | undefined;
  const signal = s.input ? findRole(d.role)?.signals?.find((x) => x.kind === s.input) : undefined;
  if (signal) {
    if (signal.tool === "geo") {
      stages.push({ name: "Data", ok: "warn", text: "AI answers come after hire." });
    } else if (!(await isConnected(w.id, signal.tool))) {
      stages.push({ name: "Data", ok: "warn", text: `${name(signal.tool)} not connected, so no data.` });
    } else {
      try {
        const got = await fetchSignal(looper, cfg, signal);
        rows = got.slice(0, 60).map((r) => ({ ...r, status: "open" as const }));
        stages.push({
          name: "Data",
          ok: got.length ? "yes" : "warn",
          text: got.length ? `${got.length} rows from ${name(signal.tool)}.` : `${name(signal.tool)} returned no data.`,
        });
      } catch (e) {
        stages.push({ name: "Data", ok: "no", text: why(e) });
      }
    }
  }

  // 3. The run itself: read, plan, guard.
  try {
    const out = await planCards(
      looper,
      { id: 0, name: s.name, tool: s.tool, mode: "ask", looper_id: 0, input: s.input, action: s.action },
      { version: 1, rules: s.rules },
      cfg,
      rows,
    );
    if (findRole(d.role)?.sitePages)
      stages.push(
        out.pages
          ? { name: "Site", ok: "yes", text: `${out.pages} pages already published.` }
          : { name: "Site", ok: "warn", text: "No sitemap found, so it cannot see what is already published." },
      );
    stages.push(
      out.readCount
        ? { name: "Research", ok: "yes", text: out.findings.trim().slice(0, 4000) || "Nothing to report." }
        : { name: "Research", ok: "warn", text: "Planned from the rules only." },
    );
    stages.push(
      out.keep.length
        ? { name: "Cards", ok: "yes", text: `${out.keep.length} card${out.keep.length > 1 ? "s" : ""}.` }
        : { name: "Cards", ok: "warn", text: "No cards. Nothing met the rules." },
    );
    if (out.dropped.length) stages.push({ name: "Held back", ok: "warn", text: out.dropped.map((x) => `${x.title}: ${x.why}.`).join("\n").slice(0, 600) });
    return {
      at: now(),
      stages,
      cards: [
        ...out.keep.map((c) => ({ title: c.title, detail: c.detail.slice(0, 2500), how: cardHow(c.action, PR_SLUG) })),
        ...out.dropped.map((x) => ({ title: x.title, detail: "", how: "", held: x.why })),
      ],
    };
  } catch (e) {
    return fail(stages, "Run", e);
  }
}
