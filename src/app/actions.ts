"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { chiefReply, defaultRetroSkill, looperChatReply, runRetro, runSkill } from "@/lib/agent";
import { getUser, isLocalServer, mutate, read, toPublic } from "@/lib/db";
import { appFromName, MCP_APPS } from "@/lib/apps";
import * as composioApi from "@/lib/composio";
import { kv } from "@/lib/kv";
import { readProgress } from "@/lib/progress";
import { deleteDatabase } from "@/lib/database";
import { testIntegration } from "@/lib/integrations";
import * as chatgpt from "@/lib/oauth/chatgpt";
import * as grok from "@/lib/oauth/grok";
import { clearSession, currentUser, requireUid, requireUser, setSession } from "@/lib/session";
import type { AppRef, Card, Column, GrokRoute, Integration, IntegrationKind, Looper, Provider, Skill } from "@/lib/types";
import { ACCENTS } from "@/lib/types";

const now = () => new Date().toISOString();
const done = <T,>(v: T) => {
  revalidatePath("/", "layout");
  return v;
};

export async function getState() {
  const user = await requireUser();
  return toPublic(await read(user.id), user);
}

// — Sign-in —

/** Not a secret: remembers which user last signed in on this browser so ChatGPT reuses their app registration. */
const HINT_COOKIE = "cl_hint";

/** Production hides thrown server-action messages; actions the UI explains return them instead. */
type Result<T> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function startChatGPTLogin() {
  return attempt(startChatGPTLoginInner);
}

async function startChatGPTLoginInner() {
  if (!isLocalServer()) throw new Error("OpenAI only allows ChatGPT sign-in for apps running on your own machine. Use Grok here, or run Chieflooper locally.");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
  const port = host.split(":")[1] ?? "80";
  const signedIn = await currentUser();
  const hintUid = signedIn?.id ?? (await cookies()).get(HINT_COOKIE)?.value;
  const known = hintUid ? await getUser(hintUid) : undefined;
  const clientId = known ? (await read(known.id)).settings.chatgptClientId : undefined;
  return chatgpt.startSignIn({ port, origin, linkUid: signedIn?.id, clientId, loginHint: known?.email });
}

export async function startGrokLogin() {
  return attempt(async () => grok.startDevice((await currentUser())?.id));
}

export async function pollGrokLogin(flowId: string) {
  const r = await grok.pollDevice(flowId);
  if (r.status !== "connected") return { status: r.status };
  if (!r.linked) {
    await setSession(r.uid);
    (await cookies()).set(HINT_COOKIE, r.uid, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86400 });
  }
  return done({ status: "connected" as const });
}

export async function signOutApp() {
  await clearSession();
  return true;
}

export async function disconnectSubscription(provider: Provider) {
  const uid = await requireUid();
  if (provider === "openai") await chatgpt.signOut(uid);
  else await grok.signOut(uid);
  return done(true);
}

// — Model settings —

export async function saveModelSettings(input: { provider: Provider; model: string; apiKey?: string; useKey?: boolean }) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    db.settings.provider = input.provider;
    if (input.model.trim()) db.settings.models[input.provider] = input.model.trim();
    if (input.apiKey?.trim()) db.settings.apiKeys[input.provider] = input.apiKey.trim();
    if (input.useKey !== undefined) db.settings.authMode[input.provider] = input.useKey ? "key" : "oauth";
  });
  return done(true);
}

export async function removeKey(provider: Provider) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    delete db.settings.apiKeys[provider];
    if (db.settings.oauth[provider]) db.settings.authMode[provider] = "oauth";
  });
  return done(true);
}

export async function setGrokRoute(route: GrokRoute) {
  const uid = await requireUid();
  await mutate(uid, (db) => void (db.settings.grokRoute = route));
  return done(true);
}

export async function listPlanModels(provider: Provider) {
  const uid = await requireUid();
  if (provider === "openai") return chatgpt.listChatGPTModels(uid);
  return [];
}

// — Chief —
export async function askChief(text: string) {
  const uid = await requireUid();
  return done(await chiefReply(uid, text));
}

export async function askLooper(looperId: string, text: string) {
  const uid = await requireUid();
  return done(await looperChatReply(uid, looperId, text));
}

export async function clearLooperChat(looperId: string) {
  const uid = await requireUid();
  await mutate(uid, (db) => void ((db.chats ??= {})[looperId] = []));
  return done(true);
}

/** Live steps for a reply or run in progress: target is "chief", "chat:<looperId>" or "run:<runId>". */
export async function getProgress(target: string) {
  const uid = await requireUid();
  if (!/^(chief|chat:[\w-]+|run:[\w-]+)$/.test(target)) return [];
  return readProgress(uid, target);
}

export async function clearChief() {
  const uid = await requireUid();
  await mutate(uid, (db) => void (db.chief = []));
  return done(true);
}

// — Integrations —

export async function addIntegration(input: { name: string; kind: IntegrationKind; url: string; headerName?: string; headerValue?: string }) {
  const uid = await requireUid();
  const url = new URL(input.url.trim());
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Use an https:// MCP URL");
  const integration: Integration = {
    id: nanoid(8),
    name: input.name.trim() || input.kind,
    kind: input.kind,
    url: url.toString(),
    headers: input.headerName?.trim() && input.headerValue?.trim() ? { [input.headerName.trim()]: input.headerValue.trim() } : {},
    enabled: true,
  };
  await mutate(uid, (db) => void db.settings.integrations.push(integration));
  return done(integration.id);
}

export async function toggleIntegration(id: string) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const i = db.settings.integrations.find((x) => x.id === id);
    if (i) i.enabled = !i.enabled;
  });
  return done(true);
}

export async function removeIntegration(id: string) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    db.settings.integrations = db.settings.integrations.filter((x) => x.id !== id);
    for (const l of db.loopers) if (Array.isArray(l.integrationIds)) l.integrationIds = l.integrationIds.filter((x) => x !== id);
  });
  return done(true);
}

export async function checkIntegration(id: string) {
  const uid = await requireUid();
  const i = (await read(uid)).settings.integrations.find((x) => x.id === id);
  if (!i) return { ok: false as const, error: "Not found" };
  return testIntegration(i);
}

// — Loopers —
export async function createLooper(input: { name: string; emoji: string; mission: string; metricName: string; unit: string; direction: "up" | "down"; target: number; current?: number; apps?: string[] }) {
  const uid = await requireUid();
  const apps = await composioApi.resolveApps((input.apps ?? []).map(appFromName));
  const id = await mutate(uid, (db) => {
    const looper: Looper = {
      id: nanoid(8),
      name: input.name.trim(),
      emoji: input.emoji || "◎",
      color: ACCENTS[db.loopers.length % ACCENTS.length],
      mission: input.mission.trim(),
      metric: {
        name: input.metricName.trim(),
        unit: input.unit.trim(),
        direction: input.direction,
        target: input.target,
        history: input.current === undefined || Number.isNaN(input.current) ? [] : [{ at: now(), value: input.current, note: "baseline" }],
      },
      skills: [defaultRetroSkill()],
      integrationIds: "all",
      apps: apps.filter((a, i, all) => all.findIndex((b) => b.slug === a.slug) === i),
      status: "active",
      createdAt: now(),
    };
    db.loopers.push(looper);
    return looper.id;
  });
  return done(id);
}

export async function updateLooper(id: string, patch: Partial<Pick<Looper, "name" | "emoji" | "mission" | "status" | "integrationIds" | "color">> & { target?: number }) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const l = db.loopers.find((x) => x.id === id);
    if (!l) return;
    const { target, ...rest } = patch;
    Object.assign(l, rest);
    if (target !== undefined) l.metric.target = target;
  });
  return done(true);
}

export async function deleteLooper(id: string) {
  const uid = await requireUid();
  await deleteDatabase(uid, id);
  await mutate(uid, (db) => {
    db.loopers = db.loopers.filter((x) => x.id !== id);
    db.cards = db.cards.filter((x) => x.looperId !== id);
    db.runs = db.runs.filter((x) => x.looperId !== id);
    db.retros = db.retros.filter((x) => x.looperId !== id);
  });
  return done(true);
}

export async function recordMetric(id: string, value: number, note?: string) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    db.loopers.find((x) => x.id === id)?.metric.history.push({ at: now(), value, note: note || "manual entry" });
  });
  return done(true);
}

export async function saveSkill(looperId: string, skill: Omit<Skill, "id"> & { id?: string }) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const l = db.loopers.find((x) => x.id === looperId);
    if (!l) return;
    const existing = skill.id && l.skills.find((s) => s.id === skill.id);
    if (existing) Object.assign(existing, skill);
    else l.skills.push({ ...skill, id: nanoid(8) });
  });
  return done(true);
}

export async function deleteSkill(looperId: string, skillId: string) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const l = db.loopers.find((x) => x.id === looperId);
    if (l) l.skills = l.skills.filter((s) => s.id !== skillId);
  });
  return done(true);
}

export async function runLooperSkill(looperId: string, skillId: string) {
  const uid = await requireUid();
  return done(await runSkill(uid, looperId, skillId, "manual"));
}

export async function holdRetro(looperId: string) {
  const uid = await requireUid();
  return done(await runRetro(uid, looperId, "manual"));
}

// — Kanban —
export async function addCard(looperId: string, title: string, column: Column = "todo", assignee: "looper" | "you" = "looper") {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const card: Card = { id: nanoid(8), looperId, title: title.trim(), description: "", column, assignee, createdBy: "user", createdAt: now(), updatedAt: now() };
    db.cards.push(card);
  });
  return done(true);
}

export async function moveCard(cardId: string, column: Column) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const c = db.cards.find((x) => x.id === cardId);
    if (c) Object.assign(c, { column, updatedAt: now() });
  });
  return done(true);
}

export async function editCard(cardId: string, patch: { title?: string; description?: string; assignee?: "looper" | "you" }) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const c = db.cards.find((x) => x.id === cardId);
    if (c) Object.assign(c, patch, { updatedAt: now() });
  });
  return done(true);
}

export async function deleteCard(cardId: string) {
  const uid = await requireUid();
  await mutate(uid, (db) => void (db.cards = db.cards.filter((x) => x.id !== cardId)));
  return done(true);
}

// — Apps (per looper) —

type AppState = "connected" | "not_connected" | "unavailable";
interface AppRow extends AppRef {
  state: AppState;
  detail: string;
  setup?: string[];
  /** connected accounts of this app (Composio), e.g. several Stripe accounts */
  accounts?: { id: string; label: string }[];
}

export async function looperAppStatus(looperId: string): Promise<{ composio: boolean; apps: AppRow[] }> {
  const uid = await requireUid();
  const db = await read(uid);
  const looper = db.loopers.find((l) => l.id === looperId);
  if (!looper) throw new Error("Looper not found");
  const composio = composioApi.hasComposio();
  const accounts = composio ? await composioApi.activeAccounts(uid).catch(() => new Map<string, composioApi.Account[]>()) : new Map<string, composioApi.Account[]>();
  const local = isLocalServer();
  const repairs = new Map<string, { slug: string; name: string; logo?: string }>();

  const apps = await Promise.all(
    (looper.apps ?? []).map(async (original): Promise<AppRow> => {
      let app = original;
      if (app.via === "mcp") {
        const preset = MCP_APPS[app.slug];
        const integration = db.settings.integrations.find((i) => i.app === app.slug && i.enabled);
        if (preset?.localOnly && !local)
          return { ...app, state: "unavailable", detail: `${app.name} runs on your own machine. Open Chieflooper locally to connect it.` };
        if (integration) return { ...app, state: "connected", detail: `Read-only via ${integration.url.replace(/^https?:\/\//, "")}` };
        return { ...app, state: "not_connected", detail: "Runs on your machine through a small MCP server. Payments are blocked.", setup: preset?.setup };
      }
      if (!composio) return { ...app, state: "not_connected", detail: "Needs Composio on the server" };
      let tk = await composioApi.getToolkit(app.slug).catch(() => null);
      if (!tk) {
        // Older loopers stored a guessed slug ("googlesearchconsole"); look the name up in the catalog.
        const found = await composioApi.resolveToolkit(app.name).catch(() => null);
        if (found) {
          tk = await composioApi.getToolkit(found.slug).catch(() => null);
          if (tk) repairs.set(app.slug, { slug: tk.slug, name: tk.name, logo: found.logo });
          app = { ...app, slug: found.slug };
        }
      }
      if (!tk) return { ...app, state: "unavailable", detail: "Not found in the app catalog. Remove it or add it through a hub in Settings." };
      const logo = app.logo ?? tk.meta?.logo;
      const list = (accounts.get(app.slug) ?? []).map((a) => ({ id: a.id, label: composioApi.accountLabel(a) }));
      if (list.length)
        return {
          ...app,
          name: tk.name,
          logo,
          state: "connected",
          accounts: list,
          detail: list.length === 1 ? `Connected as ${list[0].label}` : `${list.length} accounts connected`,
        };
      return { ...app, name: tk.name, logo, state: "not_connected", detail: (tk.composio_managed_auth_schemes ?? []).length ? `Sign in with ${tk.name}` : `Paste your ${tk.name} key on a secure Composio page` };
    }),
  );

  // Remember fixed slugs, logos and canonical names so runs, Chief and tiles use them.
  const known = new Map(apps.map((a) => [a.slug, a]));
  if (repairs.size || apps.some((a) => a.logo && !looper.apps?.find((x) => x.slug === a.slug)?.logo))
    await mutate(uid, (d) => {
      const l = d.loopers.find((x) => x.id === looperId);
      if (!l?.apps) return;
      l.apps = l.apps.map((a) => {
        const fixed = repairs.get(a.slug);
        const slug = fixed?.slug ?? a.slug;
        return { ...a, slug, name: fixed?.name ?? known.get(slug)?.name ?? a.name, logo: fixed?.logo ?? known.get(slug)?.logo ?? a.logo };
      });
      l.apps = l.apps.filter((a, i, all) => all.findIndex((b) => b.slug === a.slug) === i);
    });
  return { composio, apps };
}

/** Start Composio's hosted connect page for one app; returns the URL to open.
 * `another` adds a further account of an app that's already connected (e.g. a second Stripe). */
export async function connectApp(looperId: string, slug: string, another = false) {
  return attempt(() => connectAppInner(looperId, slug, another));
}

async function connectAppInner(looperId: string, slug: string, another: boolean) {
  const uid = await requireUid();
  let alias: string | undefined;
  if (another) {
    const existing = (await composioApi.activeAccounts(uid)).get(slug) ?? [];
    const taken = new Set(existing.map((a) => a.alias).filter(Boolean));
    let n = existing.length + 1;
    while (taken.has(`${slug}-${n}`)) n++;
    alias = `${slug}-${n}`;
  }
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const callback = `${origin}/connect/callback?looper=${encodeURIComponent(looperId)}&app=${encodeURIComponent(slug)}`;
  const link = await composioApi.linkAccount(uid, slug, callback, alias);
  // The callback's query string isn't proof: remember which account we started for whom.
  await kv.set(`composio-link:${link.connected_account_id}`, { uid, looperId, slug }, 3600);
  return link.redirect_url;
}

/** Connect an MCP-based app (e.g. bunq): check the server answers, then save it with payment tools blocked. */
export async function connectMcpApp(looperId: string, slug: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const uid = await requireUid();
  const preset = MCP_APPS[slug];
  if (!preset) return { ok: false, error: "Unknown app" };
  if (preset.localOnly && !isLocalServer()) return { ok: false, error: `${preset.name} only works when Chieflooper runs on your machine.` };
  const probe: Integration = { id: "probe", name: preset.name, kind: "custom", url: preset.url, headers: {}, enabled: true, app: slug, deniedTools: preset.deniedTools };
  const test = await testIntegration(probe);
  if (!test.ok) return { ok: false, error: `Couldn't reach ${preset.name} at ${preset.url}. Is bunq-mcp running? (${test.error})` };
  await mutate(uid, (db) => {
    const existing = db.settings.integrations.find((i) => i.app === slug);
    if (existing) Object.assign(existing, { url: preset.url, deniedTools: preset.deniedTools, enabled: true });
    else db.settings.integrations.push({ ...probe, id: nanoid(8) });
  });
  return done({ ok: true });
}

export async function searchApps(q: string): Promise<AppRef[]> {
  await requireUid();
  const query = q.trim().toLowerCase();
  const mcp = Object.entries(MCP_APPS)
    .filter(([slug, a]) => slug.includes(query) || a.name.toLowerCase().includes(query))
    .map(([slug, a]) => ({ slug, name: a.name, via: "mcp" as const, logo: a.logo }));
  if (!composioApi.hasComposio()) return mcp.length ? mcp : [appFromName(q)];
  const found = await composioApi.searchToolkits(q).catch(() => []);
  return [...mcp, ...found.map((t) => ({ slug: t.slug, name: t.name, logo: t.logo, via: "composio" as const }))];
}

export async function addLooperApp(looperId: string, app: AppRef) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const l = db.loopers.find((x) => x.id === looperId);
    if (l && !l.apps?.some((a) => a.slug === app.slug)) l.apps = [...(l.apps ?? []), app];
  });
  return done(true);
}

export async function removeLooperApp(looperId: string, slug: string) {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const l = db.loopers.find((x) => x.id === looperId);
    if (l?.apps) l.apps = l.apps.filter((a) => a.slug !== slug);
  });
  return done(true);
}

/** Disconnect one account of an app (it stops working for every looper). */
export async function disconnectAccount(accountId: string) {
  const uid = await requireUid();
  // Only the signed-in user's own accounts can be removed.
  const mine = (await composioApi.listAccounts(uid)).some((a) => a.id === accountId);
  if (!mine) throw new Error("That connection isn't yours.");
  await composioApi.deleteAccount(accountId);
  return done(true);
}
