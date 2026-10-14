"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { chiefReply, defaultRetroSkill, runRetro, runSkill } from "@/lib/agent";
import { getUser, isLocalServer, mutate, read, toPublic } from "@/lib/db";
import { testIntegration } from "@/lib/integrations";
import * as chatgpt from "@/lib/oauth/chatgpt";
import * as grok from "@/lib/oauth/grok";
import { clearSession, currentUser, requireUid, requireUser, setSession } from "@/lib/session";
import type { Card, Column, GrokRoute, Integration, IntegrationKind, Looper, Provider, Skill } from "@/lib/types";
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

export async function startChatGPTLogin() {
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
  const signedIn = await currentUser();
  return grok.startDevice(signedIn?.id);
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
export async function createLooper(input: { name: string; emoji: string; mission: string; metricName: string; unit: string; direction: "up" | "down"; target: number; current?: number }) {
  const uid = await requireUid();
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
export async function addCard(looperId: string, title: string, column: Column = "todo") {
  const uid = await requireUid();
  await mutate(uid, (db) => {
    const card: Card = { id: nanoid(8), looperId, title: title.trim(), description: "", column, createdBy: "user", createdAt: now(), updatedAt: now() };
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

export async function editCard(cardId: string, patch: { title?: string; description?: string }) {
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
