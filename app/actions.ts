"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { endSession, isPaid, issueCode, redeemCode, requireUser, startSession, type User } from "@/lib/auth";
import { sendCode, sendInvite } from "@/lib/mail";
import { encrypt } from "@/lib/crypto";
import { modelFor, ping, PROVIDERS, type Provider } from "@/lib/llm";
import { ENGINES, OPENROUTER, pingOpenRouter } from "@/lib/geo";
import { linkAccount, listAccounts, TOOLKITS } from "@/lib/composio";
import { isCustom, parseEndpoints, PREFIX } from "@/lib/connectors";
import { connectableNames, connectedSet, fills, isConnected, withToolError } from "@/lib/tools";
import { role as findRole, KINDS, kindOf, type MetricPreset, type WorkUnit } from "@/lib/roles";
import { edited } from "@/lib/brief";
import { executeCard, fireLooper, markDone, readMetric, recordMetric, reopenSource, revertCard, runRoutine, type Card, type Looper } from "@/lib/engine";
import * as R from "@/lib/reflection";
import * as Talk from "@/lib/talk";
import { insertSkills, planLooper, planWaiting, runSetup, setupSteps } from "@/lib/plan";
import {
  cleanSkill,
  createDraft,
  loadDraft,
  ownWork,
  presetTools,
  saveDraft,
  stackFor,
  suggestTools,
  suggestWork,
  trialKey,
  workLine,
  workOptions,
  writeSkills,
  type DraftData,
  type ToolPick,
} from "@/lib/draft";
import { tryMetric, trySkill } from "@/lib/trial";
import {
  acceptInvites,
  composioUserOf,
  createWorkspace,
  currentWorkspace,
  isTeamPlan,
  setCurrentWorkspace,
  workspaceFor,
  wsPaid,
  type Workspace,
} from "@/lib/workspace";

/** `email` is set once a sign-in code has gone out, so the form shows the code step. */
export type FormState = { error?: string; ok?: string; email?: string } | undefined;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

/** Load a looper only if the signed-in user is a member of its workspace. */
async function own(looperId: number) {
  const u = await requireUser();
  const [l] = await sql<Looper>`
    select l.* from loopers l join members m on m.workspace_id = l.workspace_id
    where l.id = ${looperId} and m.user_id = ${u.id} and l.fired_at is null`;
  if (!l) redirect("/app");
  return { u, l };
}

async function ownCard(cardId: number) {
  const u = await requireUser();
  const [c] = await sql<{ id: number; looper_id: number }>`
    select c.id, c.looper_id from cards c join loopers l on l.id = c.looper_id join members m on m.workspace_id = l.workspace_id
    where c.id = ${cardId} and m.user_id = ${u.id} and l.fired_at is null`;
  if (!c) redirect("/app");
  return { ...c, u };
}

/** The current workspace, or a specific one the user belongs to. */
async function ws(u: User, id?: FormDataEntryValue | null): Promise<Workspace> {
  if (id) {
    const w = await workspaceFor(u.id, Number(id));
    if (!w) redirect("/app");
    return w;
  }
  return currentWorkspace(u);
}

/** A-team features: the workspace owner is on A-team or Bloody enterprise. */
const teamWs = (w: Workspace) => isTeamPlan(w.owner_plan) && wsPaid(w);

/* ---------------- auth ---------------- */

// Both pages run the same two steps: email in, code out; code in, session out.
// Sign up refuses an email that has an account, sign in refuses one that does not.
async function codeStep(f: FormData, mode: "signup" | "login"): Promise<FormState> {
  const email = str(f, "email").toLowerCase();
  if (!EMAIL.test(email)) return { error: "Enter an email like you@company.com." };
  const code = str(f, "code").replace(/\D/g, "");

  if (f.has("code") && !f.has("resend")) {
    if (code.length !== 6) return { email, error: "The code is 6 digits." };
    const ok = await redeemCode(email, code);
    if (!ok) return { email, error: "That code is wrong or expired. Send a new one." };
    let [u] = await sql<{ id: number }>`select id from users where email = ${email}`;
    if (!u) {
      [u] = await sql<{ id: number }>`
        insert into users (email, tz) values (${email}, ${ok.tz || "Europe/Amsterdam"})
        on conflict (email) do update set email = excluded.email returning id`;
    }
    await acceptInvites(u.id, email);
    await startSession(u.id);
    redirect("/app");
  }

  const [exists] = await sql`select 1 from users where email = ${email}`;
  // On-prem installs can limit sign up to their own domains: LOOPER_ALLOWED_EMAILS=@acme.com,@acme.co.uk
  const allowed = (process.env.LOOPER_ALLOWED_EMAILS || "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!exists && allowed.length && !allowed.some((d) => email.endsWith(d))) return { error: "This Looper only takes emails from your company's domain." };
  if (mode === "signup" && exists) return { error: "That email has an account. Sign in instead." };
  const [invited] = await sql`select 1 from invites where email = ${email}`;
  if (mode === "login" && !exists && !invited) return { error: "No account for that email. Start Pro to create one." };
  const sent = await issueCode(email, mode === "signup" ? str(f, "tz") || null : null);
  if (sent) await sendCode(email, sent);
  return { email, ok: sent ? `Code sent to ${email}. It works for 10 minutes.` : "A code went out under 30 seconds ago. Check your inbox." };
}

export async function signup(_: FormState, f: FormData) {
  return codeStep(f, "signup");
}

export async function login(_: FormState, f: FormData) {
  return codeStep(f, "login");
}

export async function logout() {
  await endSession();
  redirect("/login");
}

/* ---------------- settings ---------------- */

export async function saveModel(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const provider = str(f, "provider") as Provider;
  if (!PROVIDERS[provider]) return { error: "Pick a provider." };
  const key = str(f, "key");
  const model = str(f, "model") || PROVIDERS[provider].model;
  if (!PROVIDERS[provider].models.includes(model)) return { error: "Pick a model." };
  if (key.length < 20) return { error: "Paste the full API key." };
  try {
    await ping({ provider, model, key });
  } catch (e) {
    return { error: `${PROVIDERS[provider].name} said: ${(e as Error).message}` };
  }
  await sql`
    insert into model_keys (user_id, provider, model, key_enc, key_hint)
    values (${u.id}, ${provider}, ${model}, ${encrypt(key)}, ${key.slice(0, 6) + "…" + key.slice(-4)})
    on conflict (user_id) do update set provider = excluded.provider, model = excluded.model,
      key_enc = excluded.key_enc, key_hint = excluded.key_hint, created_at = now()`;
  // Loopers hired before the key was here plan their week now.
  after(() => planWaiting(u.id));
  revalidatePath("/app", "layout");
  return { ok: `Connected ${PROVIDERS[provider].name}, ${model}.` };
}

export async function saveTz(f: FormData) {
  const u = await requireUser();
  const tz = str(f, "tz");
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return;
  }
  await sql`update users set tz = ${tz} where id = ${u.id}`;
  revalidatePath("/app", "layout");
}

export async function connectTool(f: FormData) {
  const u = await requireUser();
  const toolkit = str(f, "toolkit");
  if (!TOOLKITS[toolkit] && !isCustom(toolkit)) return;
  const back = str(f, "back") || "/app/settings";
  // From a looper's dock: the tool joins that looper's tools, and an already connected tool needs no sign-in.
  const looper = f.get("looper") ? (await own(Number(f.get("looper")))).l : null;
  const w = await ws(u, looper ? String(looper.workspace_id) : f.get("ws"));
  if (looper) {
    await sql`update loopers set tools = array_append(tools, ${toolkit}) where id = ${looper.id} and not (${toolkit} = any(tools))`;
    const [c] = isCustom(toolkit)
      ? await sql`select 1 from connectors where workspace_id = ${w.id} and slug = ${toolkit.slice(PREFIX.length)}`
      : await sql`select 1 from ws_connections where workspace_id = ${w.id} and toolkit = ${toolkit} and status = 'ACTIVE'`;
    if (c) {
      revalidatePath(`/app/l/${looper.id}`);
      redirect(back);
    }
  }
  if (isCustom(toolkit)) redirect("/app/settings#connectors");
  let url: string;
  try {
    const link = await linkAccount(
      composioUserOf(w),
      toolkit,
      `${await origin()}/app/connect/callback?ws=${w.id}&back=${encodeURIComponent(back)}`,
    );
    url = link.redirect_url;
  } catch (e) {
    // A toolkit without an auth config, a bad key or a Composio outage lands back on the page with a line, not a crash.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`connectTool ${toolkit}:`, msg);
    const name = TOOLKITS[toolkit];
    redirect(
      withToolError(
        back,
        msg.startsWith("No Composio auth config")
          ? `${name} is not set up in Composio yet. It needs an auth config in the Composio dashboard.`
          : `Could not open the ${name} sign-in. Try again in a minute.`,
      ),
    );
  }
  redirect(url);
}

export async function syncConnections(wsId?: number) {
  const u = await requireUser();
  const w = await ws(u, wsId ? String(wsId) : null);
  // Oldest first, so after a reconnect the newest ACTIVE account is the one kept.
  const accounts = (await listAccounts(composioUserOf(w))).sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );
  for (const a of accounts) {
    const tk = a.toolkit.slug.toLowerCase();
    // ACTIVE wins over older failed attempts for the same toolkit.
    await sql`
      insert into ws_connections (workspace_id, toolkit, account_id, status) values (${w.id}, ${tk}, ${a.id}, ${a.status})
      on conflict (workspace_id, toolkit) do update set account_id = excluded.account_id, status = excluded.status, updated_at = now()
      where ws_connections.status <> 'ACTIVE' or excluded.status = 'ACTIVE'`;
  }
}

/* ---------------- onboarding and hire ---------------- */

/** "timetuna.com", "https://www.timetuna.com/" and "TimeTuna.com/pricing" all become https://timetuna.com style origins. */
function normalizeSite(raw: string) {
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!u.hostname.includes(".")) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export async function saveWebsite(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const site = normalizeSite(str(f, "website"));
  if (!site) return { error: "Enter your website, like timetuna.com." };
  const w = await ws(u);
  await sql`update workspaces set website = ${site} where id = ${w.id}`;
  // A workspace still named after nothing takes the site's name.
  await sql`update workspaces set name = ${site.replace(/^https?:\/\//, "")} where id = ${w.id} and name = 'My workspace'`;
  revalidatePath("/app", "layout");
  redirect(str(f, "back").startsWith("/app") ? str(f, "back") : "/app");
}

/* ---------------- looper builder ---------------- */

const DAY = 864e5;

async function draftOf(f: FormData) {
  const u = await requireUser();
  const d = await loadDraft(Number(f.get("draft")), u.id);
  if (!d) redirect("/app/hire");
  const w = await ws(u, String(d.workspace_id));
  return { u, w, d, r: findRole(d.role)! };
}

/** Only the owner's key runs the model; a member sees why it cannot. */
async function ownerModel(w: Workspace) {
  const cfg = await modelFor(w.owner_id);
  if (!cfg) throw new Error(w.role === "owner" ? "Connect your AI model first, in Settings." : `${w.owner_email} has not connected an AI model yet.`);
  return cfg;
}

const failed = (e: unknown): FormState => ({ error: `The model could not answer: ${(e as Error).message}`.slice(0, 300) });

/** Step 1: the metric and where it is read. Starts the draft. */
export async function draftMetric(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const existing = f.get("draft") ? await loadDraft(Number(f.get("draft")), u.id) : null;
  const w = await ws(u, existing ? String(existing.workspace_id) : null);
  if (!wsPaid(w)) return { error: w.role === "owner" ? "Start the Pro plan first." : "The workspace owner's plan has ended." };
  const r = findRole(existing?.role ?? str(f, "role"));
  if (!r || !r.live) return { error: "Pick a role." };

  let m: MetricPreset | undefined = r.metrics[Number(str(f, "metric"))];
  if (r.id === "custom") {
    const source = str(f, "source");
    const ok = source === "manual" || TOOLKITS[source] || (isCustom(source) && (await isConnected(w.id, source)));
    if (!ok) return { error: "Pick where it reads the metric." };
    // Direction comes from the model with the units of work below.
    m = { name: "", source, unit: "", direction: "up", hint: "" };
  }
  if (!m) return { error: "Pick the metric." };
  // A metric another tool can read the same way is read from the founder's own: their help desk, CRM or books.
  const kind = r.id === "custom" ? undefined : kindOf(m.source);
  let stack = stackFor(r, await connectedSet(w.id), existing?.data.stack);
  if (kind) {
    const src = str(f, "from") || stack[kind] || m.source;
    if (!(await fills(w.id, kind, src)) && src !== m.source) return { error: `Pick your ${KINDS[kind].name}.` };
    m = { ...m, source: src };
    stack = { ...stack, [kind]: src };
  }
  const name = m.source === "manual" || r.id === "custom" ? str(f, "mname").slice(0, 80) : m.name;
  if (!name) return { error: "Name the metric, like: Demo calls booked, last 7 days." };
  const metric = { name, source: m.source, hint: m.hint, unit: m.unit, direction: m.direction };

  const prev = existing?.data ?? {};
  const same = prev.metric && JSON.stringify({ ...prev.metric, direction: m.direction }) === JSON.stringify(metric);
  const lname = r.id === "custom" ? str(f, "lname").slice(0, 40) : "";
  if (r.id === "custom" && !lname) return { error: "Name the looper, like: Pipeline looper." };
  // A new metric resets what was picked from it; a role's own units of work stay.
  let data: DraftData = same
    ? { ...prev, name: lname || prev.name, stack }
    : { metric, work: r.work.length ? prev.work : undefined, name: lname || prev.name, stack };
  if (r.id === "custom" && !data.workOptions?.length) {
    // Without an answer the next step still takes a unit of work in the founder's words, and can ask again.
    data = await ownerModel(w)
      .then((cfg) => suggestWork(cfg, w.id, w.website, r, metric))
      .then(
      ({ units, direction }) => ({ ...data, metric: { ...data.metric!, direction }, workOptions: units, note: undefined }),
      (e) => ({ ...data, note: failed(e)?.error }),
    );
  }
  const id = existing ? existing.id : await createDraft(w.id, u.id, r.id, data);
  if (existing) await saveDraft(id, data);
  redirect(`/app/new/${id}?s=2`);
}

/** Step 2: the unit of work. `do=again` asks the model for other units. */
export async function draftWork(_: FormState, f: FormData): Promise<FormState> {
  const { w, d, r } = await draftOf(f);
  if (str(f, "do") === "again") {
    try {
      const { units } = await suggestWork(await ownerModel(w), w.id, w.website, r, d.data.metric!);
      await saveDraft(d.id, { ...d.data, workOptions: units, note: undefined });
    } catch (e) {
      return failed(e);
    }
    revalidatePath(`/app/new/${d.id}`);
    return { ok: "Three new units of work." };
  }
  const pick = str(f, "work");
  const options = workOptions(r, d.data);
  const own = str(f, "own").slice(0, 120);
  const work: WorkUnit | undefined = pick === "own" ? (own ? ownWork(own) : undefined) : options[Number(pick)];
  if (!work) return { error: pick === "own" ? "Describe the unit of work, like: A case study of one customer." : "Pick a unit of work." };
  const changed = JSON.stringify(work) !== JSON.stringify(d.data.work);
  let data: DraftData = changed ? { ...d.data, work, tools: undefined, toolOptions: undefined, skills: undefined } : d.data;
  if (!data.toolOptions) {
    try {
      data = { ...data, toolOptions: r.id === "custom" ? await suggestTools(await ownerModel(w), w.id, r, data) : presetTools(r, data) };
    } catch {
      // The tools step still lists where the metric lives and where the work ships.
      data = { ...data, toolOptions: presetTools(r, data) };
    }
  }
  await saveDraft(d.id, data);
  redirect(`/app/new/${d.id}?s=3`);
}

/** Step 3: the tools. `do=connect:<slug>` signs in to one of them and comes back. */
export async function draftTools(_: FormState, f: FormData): Promise<FormState> {
  const { w, d, r } = await draftOf(f);
  const names = await connectableNames(w.id);
  // A row swapped for the founder's own tool: `as_<slug>` names the pick. The metric follows its tool.
  let stack = { ...d.data.stack };
  let metric = d.data.metric;
  const options: ToolPick[] = [];
  for (const o of d.data.toolOptions ?? []) {
    const pick = str(f, `as_${o.slug}`);
    if (!o.kind || !pick || pick === o.slug || !(await fills(w.id, o.kind, pick))) {
      options.push(o);
      continue;
    }
    if (!options.some((x) => x.slug === pick)) options.push({ ...o, slug: pick });
    stack = { ...stack, [o.kind]: pick };
    if (metric?.source === o.slug) metric = { ...metric, source: pick };
  }
  const tools = [...new Set([...f.getAll("tool").map(String), str(f, "extra")])].filter((t) => t && (names[t] || options.some((o) => o.slug === t)));
  const extra = str(f, "extra");
  const toolOptions = extra && names[extra] && !options.some((o) => o.slug === extra) ? [...options, { slug: extra, why: "Added by you" }] : options;
  const act = str(f, "do");
  if (act.startsWith("connect:")) {
    await saveDraft(d.id, { ...d.data, metric, stack, toolOptions, picked: tools });
    const back = new FormData();
    back.set("toolkit", act.slice("connect:".length));
    back.set("ws", String(w.id));
    back.set("back", `/app/new/${d.id}?s=3`);
    return connectTool(back).then(() => undefined);
  }
  const changed = JSON.stringify(tools) !== JSON.stringify(d.data.tools);
  let data: DraftData = { ...d.data, metric, stack, toolOptions, tools, skills: changed ? undefined : d.data.skills };
  if (!data.skills?.length) {
    try {
      data = { ...data, skills: await writeSkills({ ...d, data }, w.website, w.owner_id) };
    } catch (e) {
      await saveDraft(d.id, data);
      return failed(e);
    }
  }
  await saveDraft(d.id, data);
  redirect(`/app/new/${d.id}?s=4`);
}

/** Step 4: the skills, edited by hand or by asking the model; `do=hire` hires the looper. */
export async function draftSkills(_: FormState, f: FormData): Promise<FormState> {
  const { w, d, r } = await draftOf(f);
  if (!wsPaid(w)) return { error: w.role === "owner" ? "Start the Pro plan first." : "The workspace owner's plan has ended." };
  const current = d.data.skills ?? [];
  // Hand edits first, so asking the model or hiring keeps them.
  const skills = current
    .map((s, i) =>
      cleanSkill(
        { name: str(f, `name_${i}`), rules: str(f, `rules_${i}`), hour: Number(str(f, `hour_${i}`)), days: f.getAll(`day_${i}`).map(Number) },
        s,
      ),
    )
    .map((s, i) => s ?? current[i]);
  const act = str(f, "do");
  let data: DraftData = { ...d.data, skills };

  if (act.startsWith("remove:")) {
    const i = Number(act.slice(7));
    data = { ...data, skills: skills.filter((_, j) => j !== i) };
    await saveDraft(d.id, data);
    revalidatePath(`/app/new/${d.id}`);
    return undefined;
  }
  if (act === "ask" || act === "again") {
    const ask = act === "ask" ? str(f, "ask").slice(0, 600) : "";
    if (act === "ask" && !ask) return { error: "Say what to change, like: two posts a week, on Tuesday and Thursday." };
    try {
      data = { ...data, skills: await writeSkills({ ...d, data }, w.website, w.owner_id, ask || "Write the routines again from scratch, different from these.") };
    } catch (e) {
      await saveDraft(d.id, data);
      return failed(e);
    }
    await saveDraft(d.id, data);
    revalidatePath(`/app/new/${d.id}`);
    return { ok: act === "ask" ? "Skills changed. Read them over, then hire." : "Skills written again." };
  }

  await saveDraft(d.id, data);
  if (act === "next") redirect(`/app/new/${d.id}?s=5`);
  if (act !== "hire") return { ok: "Saved." };
  if (!data.metric || !data.work || !data.skills?.length) return { error: "Every step needs an answer first." };
  const m = data.metric;
  const looperName = r.id === "custom" ? data.name || "My looper" : `${r.name.replace(/ manager$/, "")} looper`;
  const tools = [...new Set([m.source, ...(data.tools ?? [])])].filter((t) => TOOLKITS[t] || isCustom(t)).slice(0, 5);
  const date = new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10);
  // No target: the looper always works to improve the metric.
  const [l] = await sql<{ id: number }>`
    insert into loopers (user_id, workspace_id, role, name, metric_name, metric_source, metric_hint, unit, direction, target, target_date,
                         website, tools, work, plan_status)
    values (${w.owner_id}, ${w.id}, ${r.id}, ${looperName}, ${m.name}, ${m.source}, ${m.hint}, ${m.unit}, ${m.direction}, ${null}, ${date},
            ${w.website}, ${tools}, ${workLine(data.work)}, 'waiting')
    returning id`;
  await insertSkills(l.id, r.id, data.skills, "hire");
  await sql`delete from drafts where id = ${d.id}`;
  // The brief, buyer questions and setup steps come from the model in the background.
  after(() => planLooper(l.id));
  redirect(`/app/l/${l.id}`);
}

/** Step 5: test the metric read (`do=metric`) or one skill (`do=skill:<i>`) before hire. Saves the result on the draft only. */
export async function draftTry(_: FormState, f: FormData): Promise<FormState> {
  const { u, w, d } = await draftOf(f);
  const act = str(f, "do");
  const skills = d.data.skills ?? [];
  const i = act.startsWith("skill:") ? Number(act.slice(6)) : -1;
  if (act !== "metric" && !skills[i]) return { error: "Pick a skill to try." };
  const trial = act === "metric" ? await tryMetric(d, w) : await trySkill(d, w, skills[i]);
  // Another test run may have finished meanwhile; keep its result.
  const fresh = await loadDraft(d.id, u.id);
  if (!fresh) redirect("/app/hire");
  const trials = fresh.data.trials ?? {};
  // Runs of skills since edited or removed are stale; drop them.
  const live = new Set((fresh.data.skills ?? []).map(trialKey));
  const kept = Object.fromEntries(Object.entries(trials.skills ?? {}).filter(([k]) => live.has(k)));
  await saveDraft(d.id, {
    ...fresh.data,
    trials: act === "metric" ? { ...trials, skills: kept, metric: trial } : { ...trials, skills: { ...kept, [trialKey(skills[i])]: trial } },
  });
  revalidatePath(`/app/new/${d.id}`);
  return undefined;
}

/** Interest in running loopers on a ChatGPT, Grok or Cursor plan instead of an API key. */
export async function wantModelPlan(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const plan = str(f, "plan").slice(0, 20);
  await sql`insert into events (name, props, path) values ('model_plan_interest', ${JSON.stringify({ plan, user: u.id })}::jsonb, '/app')`;
  return { ok: "Noted. Until plan sign-in opens, an API key runs your loopers." };
}

export async function replan(f: FormData) {
  const { l } = await own(Number(f.get("looper")));
  after(() => planLooper(l.id));
  await sql`update loopers set plan_error = null where id = ${l.id}`;
  revalidatePath(`/app/l/${l.id}`);
}

/** Fire a looper: it stops running and leaves the team; its cards and history stay in the database. */
export async function fire(f: FormData) {
  const { l } = await own(Number(f.get("looper")));
  await fireLooper(l.id);
  revalidatePath("/app", "layout");
  // Fired from the team page: stay there. From the looper's own page: go to the next looper.
  if (f.get("back") === "/app/hire") redirect("/app/hire");
  const [next] = await sql<{ id: number }>`select id from loopers where workspace_id = ${l.workspace_id} and fired_at is null order by id limit 1`;
  redirect(next ? `/app/l/${next.id}` : "/app/hire");
}

export async function rerunSetup(_: FormState, f: FormData): Promise<FormState> {
  const { l } = await own(Number(f.get("looper")));
  try {
    const n = await runSetup(l.id, true);
    revalidatePath(`/app/l/${l.id}`);
    return { ok: n ? `Learned ${n} thing${n > 1 ? "s" : ""} again.` : "Nothing new: connect the tools it reads first." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A person rewrites what the looper learned at hire. The old text stays in history; routines read the new one. */
export async function editSetup(_: FormState, f: FormData): Promise<FormState> {
  const { u, l } = await own(Number(f.get("looper")));
  const step = str(f, "step");
  const text = String(f.get("text") ?? "").replace(/\r\n/g, "\n").trim();
  if (!(await setupSteps(l)).some((s) => s.id === step)) return { error: "This looper has no such note." };
  if (!text) return { error: "Write something, or press Learn again." };
  if (text.length > 6000) return { error: "Keep it under 6,000 characters." };
  if (text === l.setup?.[step]?.text) return { ok: "No changes." };
  const entry = edited(l.setup?.[step], text, u.email);
  await sql`update loopers set setup = setup || ${JSON.stringify({ [step]: entry })}::jsonb where id = ${l.id}`;
  revalidatePath(`/app/l/${l.id}`);
  return { ok: "Saved. Every card from now on follows it." };
}

/** What the business does, one or two sentences the looper reads before every routine. */
export async function editBrief(_: FormState, f: FormData): Promise<FormState> {
  const { l } = await own(Number(f.get("looper")));
  const text = str(f, "brief");
  if (text.length > 400) return { error: "Keep it under 400 characters." };
  await sql`update loopers set brief = ${text} where id = ${l.id}`;
  revalidatePath(`/app/l/${l.id}`);
  return { ok: "Saved." };
}

export async function setTarget(_: FormState, f: FormData): Promise<FormState> {
  const { l } = await own(Number(f.get("looper")));
  const target = Number(str(f, "target").replace(",", "."));
  const date = str(f, "date");
  if (!str(f, "target") || !Number.isFinite(target)) return { error: "The target is a number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date) <= new Date()) return { error: "Pick a date in the future." };
  await sql`update loopers set target = ${target}, target_date = ${date} where id = ${l.id}`;
  revalidatePath(`/app/l/${l.id}`);
  return { ok: "Saved. The next routine run works toward it." };
}

/* ---------------- metric ---------------- */

export async function enterMetric(f: FormData) {
  const { l } = await own(Number(f.get("looper")));
  const v = Number(str(f, "value").replace(",", "."));
  if (Number.isFinite(v)) await recordMetric(l.id, v, "entered by founder");
  revalidatePath(`/app/l/${l.id}`);
}

export async function readNow(_: FormState, f: FormData): Promise<FormState> {
  const { l } = await own(Number(f.get("looper")));
  try {
    const v = await readMetric(l);
    revalidatePath(`/app/l/${l.id}`);
    return { ok: `Read ${v}${l.unit}.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- board ---------------- */

export async function approve(f: FormData) {
  const c = await ownCard(Number(f.get("card")));
  await sql`update cards set status = 'approved', acted_by = ${c.u.id}, updated_at = now() where id = ${c.id} and status = 'proposed'`;
  after(() => executeCard(c.id));
  revalidatePath(`/app/l/${c.looper_id}`);
  revalidatePath("/app/all");
}

export async function reject(f: FormData) {
  const c = await ownCard(Number(f.get("card")));
  const [card] = await sql<Card & { workspace_id: number }>`
    update cards set status = 'rejected', reject_reason = ${str(f, "reason").slice(0, 500) || null}, acted_by = ${c.u.id}, updated_at = now()
    from loopers l where cards.id = ${c.id} and cards.status = 'proposed' and l.id = cards.looper_id
    returning cards.*, l.workspace_id`;
  if (card) await reopenSource(card);
  revalidatePath(`/app/l/${c.looper_id}`);
  revalidatePath("/app/all");
}

export async function done(f: FormData) {
  const c = await ownCard(Number(f.get("card")));
  // Nothing shipped, nothing done: a card without a link or a line would claim the next reading.
  const shipped = String(f.get("shipped") ?? "").trim().slice(0, 500);
  if (!shipped) return;
  await markDone(c.id, shipped);
  await sql`update cards set acted_by = ${c.u.id} where id = ${c.id}`;
  revalidatePath(`/app/l/${c.looper_id}`);
}

export async function retry(f: FormData) {
  const c = await ownCard(Number(f.get("card")));
  await sql`update cards set status = 'approved', acted_by = ${c.u.id}, updated_at = now() where id = ${c.id} and status = 'failed'`;
  after(() => executeCard(c.id));
  revalidatePath(`/app/l/${c.looper_id}`);
}

export async function undo(_: FormState, f: FormData): Promise<FormState> {
  const c = await ownCard(Number(f.get("card")));
  const err = await revertCard(c.id, c.u.id);
  revalidatePath(`/app/l/${c.looper_id}`);
  return err ? { error: err } : { ok: "Undone." };
}

/* ---------------- routines ---------------- */

async function ownRoutine(id: number) {
  const u = await requireUser();
  const [r] = await sql<{ id: number; looper_id: number }>`
    select r.id, r.looper_id from routines r join loopers l on l.id = r.looper_id join members m on m.workspace_id = l.workspace_id
    where r.id = ${id} and m.user_id = ${u.id} and l.fired_at is null`;
  if (!r) redirect("/app");
  return r;
}

export async function setMode(f: FormData) {
  const r = await ownRoutine(Number(f.get("routine")));
  const mode = str(f, "mode") === "auto" ? "auto" : "ask";
  await sql`update routines set mode = ${mode} where id = ${r.id}`;
  revalidatePath(`/app/l/${r.looper_id}`);
}

export async function runNow(_: FormState, f: FormData): Promise<FormState> {
  const r = await ownRoutine(Number(f.get("routine")));
  try {
    const n = await runRoutine(r.id);
    revalidatePath(`/app/l/${r.looper_id}`);
    return { ok: n ? `${n} new card${n > 1 ? "s" : ""} on the board.` : "Nothing met the rules this run." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ---------------- reflection ---------------- */

async function ownReflection(id: number) {
  const u = await requireUser();
  const [r] = await sql<{ id: number; looper_id: number }>`
    select r.id, r.looper_id from reflections r join loopers l on l.id = r.looper_id join members m on m.workspace_id = l.workspace_id
    where r.id = ${id} and m.user_id = ${u.id} and l.fired_at is null`;
  if (!r) redirect("/app");
  return { u, r };
}

export async function startReflection(_: FormState, f: FormData): Promise<FormState> {
  const { r } = await ownReflection(Number(f.get("reflection")));
  try {
    await R.openChat(r.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/app/l/${r.looper_id}`);
}

export async function sendReflection(_: FormState, f: FormData): Promise<FormState> {
  const { u, r } = await ownReflection(Number(f.get("reflection")));
  const text = str(f, "text");
  if (!text) return;
  try {
    await R.reply(r.id, text.slice(0, 4000), u.email);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/app/l/${r.looper_id}`);
}

export async function proposeDiff(_: FormState, f: FormData): Promise<FormState> {
  const { r } = await ownReflection(Number(f.get("reflection")));
  try {
    await R.propose(r.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath(`/app/l/${r.looper_id}`);
}

export async function acceptDiff(f: FormData) {
  const { u, r } = await ownReflection(Number(f.get("reflection")));
  const edited: Record<number, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith("rules-")) edited[Number(k.slice(6))] = String(v);
  await R.accept(r.id, edited, u.tz, u.id);
  revalidatePath(`/app/l/${r.looper_id}`);
}

/* ---------------- chat with a looper ---------------- */

export async function talk(_: FormState, f: FormData): Promise<FormState> {
  const { u, l } = await own(Number(f.get("looper")));
  // Suggestion buttons submit `ask`; the textarea submits `text`.
  const text = (str(f, "text") || str(f, "ask")).slice(0, 4000);
  if (!text) return;
  try {
    await Talk.send(l.id, text, u.id, u.tz);
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    revalidatePath(`/app/l/${l.id}`);
  }
}

async function ownTalk(id: number) {
  const u = await requireUser();
  const [t] = await sql<{ id: number; looper_id: number }>`
    select t.id, t.looper_id from talk t join loopers l on l.id = t.looper_id join members m on m.workspace_id = l.workspace_id
    where t.id = ${id} and m.user_id = ${u.id} and l.fired_at is null`;
  if (!t) redirect("/app");
  return { u, t };
}

export async function applyChange(_: FormState, f: FormData): Promise<FormState> {
  const { u, t } = await ownTalk(Number(f.get("talk")));
  try {
    const ok = await Talk.apply(t.id, Number(f.get("i")), u.id, u.email);
    return { ok };
  } catch (e) {
    return { error: (e as Error).message };
  } finally {
    revalidatePath(`/app/l/${t.looper_id}`);
  }
}

export async function dismissChange(f: FormData) {
  const { t } = await ownTalk(Number(f.get("talk")));
  await Talk.dismiss(t.id, Number(f.get("i")));
  revalidatePath(`/app/l/${t.looper_id}`);
}

/* ---------------- workspaces and collaborators ---------------- */

export async function switchWorkspace(f: FormData) {
  const u = await requireUser();
  const w = await ws(u, f.get("ws"));
  await setCurrentWorkspace(w.id);
  redirect(str(f, "back").startsWith("/app") ? str(f, "back") : "/app");
}

export async function newWorkspace(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const name = str(f, "name").slice(0, 60);
  if (!name) return { error: "Name it after the product, brand or client." };
  const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from workspaces where owner_id = ${u.id}`;
  if (n > 0 && !(isTeamPlan(u.plan) && isPaid(u))) return { error: "Pro has 1 workspace. A-team has unlimited workspaces." };
  const site = str(f, "website") ? normalizeSite(str(f, "website")) : "";
  if (site === null) return { error: "Enter the website like timetuna.com, or leave it empty." };
  const id = await createWorkspace(u, name, site);
  await setCurrentWorkspace(id);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function renameWorkspace(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const w = await ws(u, f.get("ws"));
  const name = str(f, "name").slice(0, 60);
  if (!name) return { error: "The name cannot be empty." };
  await sql`update workspaces set name = ${name} where id = ${w.id}`;
  revalidatePath("/app", "layout");
  return { ok: "Saved." };
}

export async function invite(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const w = await ws(u, f.get("ws"));
  if (!teamWs(w)) return { error: "Collaborators come with A-team: unlimited people in every workspace." };
  const email = str(f, "email").toLowerCase();
  if (!EMAIL.test(email)) return { error: "Enter an email like ana@company.com." };
  const [existing] = await sql<{ id: number }>`select id from users where email = ${email}`;
  if (existing) {
    await sql`insert into members (workspace_id, user_id, role) values (${w.id}, ${existing.id}, 'member') on conflict do nothing`;
  } else {
    await sql`insert into invites (workspace_id, email, invited_by) values (${w.id}, ${email}, ${u.id})
      on conflict (workspace_id, email) do update set invited_by = excluded.invited_by, created_at = now()`;
  }
  await sendInvite(email, { from: u.email, workspace: w.name, url: `${await origin()}/${existing ? "login" : "signup"}?email=${encodeURIComponent(email)}` });
  revalidatePath("/app/settings");
  return { ok: existing ? `${email} is in ${w.name} now. We emailed them.` : `Invite sent to ${email}. They join when they sign up.` };
}

export async function removeMember(f: FormData) {
  const u = await requireUser();
  const w = await ws(u, f.get("ws"));
  const who = Number(f.get("user"));
  const email = str(f, "email");
  // The owner removes anyone but themselves; a member can only leave.
  if (who && who !== w.owner_id && (w.role === "owner" || who === u.id)) {
    await sql`delete from members where workspace_id = ${w.id} and user_id = ${who}`;
  }
  if (email && w.role === "owner") await sql`delete from invites where workspace_id = ${w.id} and email = ${email}`;
  revalidatePath("/app", "layout");
  if (who === u.id) redirect("/app");
}

/* ---------------- email preferences ---------------- */

export async function saveNotify(f: FormData) {
  const u = await requireUser();
  await sql`update users set notify = ${f.get("notify") === "on"}, weekly = ${f.get("weekly") === "on"} where id = ${u.id}`;
  revalidatePath("/app/settings");
}

/* ---------------- custom connectors ---------------- */

export async function addConnector(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const w = await ws(u, f.get("ws"));
  if (!teamWs(w)) return { error: "Custom connectors come with A-team and Bloody enterprise." };
  const name = str(f, "name").slice(0, 40);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
  if (!slug) return { error: "Name the connector, like: Orders API." };
  let base: URL;
  try {
    base = new URL(str(f, "base"));
    if (!/^https?:$/.test(base.protocol)) throw new Error();
  } catch {
    return { error: "Base URL looks like https://api.example.com/v1." };
  }
  if (base.protocol === "http:" && process.env.LOOPER_ALLOW_PRIVATE_HOSTS !== "1") return { error: "Use https for the base URL." };
  let endpoints;
  try {
    endpoints = parseEndpoints(str(f, "endpoints"));
  } catch (e) {
    return { error: (e as Error).message };
  }
  const secret = str(f, "secret");
  const header = str(f, "header") || "Authorization";
  if (!/^[A-Za-z0-9-]{1,60}$/.test(header)) return { error: "The auth header is a name like Authorization or X-API-Key." };
  await sql`
    insert into connectors (workspace_id, slug, name, base_url, auth_header, auth_enc, endpoints)
    values (${w.id}, ${slug}, ${name}, ${base.toString().replace(/\/$/, "")}, ${header}, ${secret ? encrypt(secret) : null}, ${JSON.stringify(endpoints)})
    on conflict (workspace_id, slug) do update set name = excluded.name, base_url = excluded.base_url, auth_header = excluded.auth_header,
      auth_enc = coalesce(excluded.auth_enc, connectors.auth_enc), endpoints = excluded.endpoints`;
  revalidatePath("/app/settings");
  return { ok: `${name} saved with ${endpoints.length} endpoint${endpoints.length > 1 ? "s" : ""}. Loopers in ${w.name} can use it now.` };
}

export async function deleteConnector(f: FormData) {
  const u = await requireUser();
  const w = await ws(u, f.get("ws"));
  await sql`delete from connectors where workspace_id = ${w.id} and id = ${Number(f.get("id"))}`;
  revalidatePath("/app/settings");
}

/* ---------------- AI answer engines for GEO ---------------- */

export async function saveEngine(_: FormState, f: FormData): Promise<FormState> {
  const u = await requireUser();
  const key = str(f, "key");
  if (key.length < 20) return { error: "Paste the full API key." };
  try {
    await pingOpenRouter(key);
  } catch (e) {
    return { error: `OpenRouter said: ${(e as Error).message}` };
  }
  await sql`insert into engine_keys (user_id, engine, key_enc, key_hint) values (${u.id}, ${OPENROUTER}, ${encrypt(key)}, ${key.slice(0, 6) + "…" + key.slice(-4)})
    on conflict (user_id, engine) do update set key_enc = excluded.key_enc, key_hint = excluded.key_hint, created_at = now()`;
  // Keys saved per engine before OpenRouter are no longer read.
  await sql`delete from engine_keys where user_id = ${u.id} and engine <> ${OPENROUTER}`;
  revalidatePath("/app/settings");
  return { ok: `OpenRouter added. The next GEO reading asks ${ENGINES.map((e) => e.name).join(", ")} too.` };
}

export async function removeEngine() {
  const u = await requireUser();
  await sql`delete from engine_keys where user_id = ${u.id}`;
  revalidatePath("/app/settings");
}
