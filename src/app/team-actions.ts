"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { hireLooper, looperChatReply, looperSpec, proposeLooper, runSkill, type LooperSpec } from "@/lib/agent";
import { readCanvas } from "@/lib/canvas";
import { readDatabase } from "@/lib/database";
import { mutate, read } from "@/lib/db";
import { requireUid } from "@/lib/session";

// Actions behind the inbox, inline questions, the command palette and the hiring flow.
// They return { ok, error } instead of throwing: production hides thrown messages.

type Result<T = true> = { ok: true; value: T } | { ok: false; error: string };
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    const value = await fn();
    revalidatePath("/", "layout");
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Answer a looper's question or approval. The answer goes into its chat as your message and it
 * replies (and carries on) in the background.
 */
export async function answerAsk(askId: string, answer: string, note?: string) {
  return attempt(async () => {
    const uid = await requireUid();
    const ask = await mutate(uid, (db) => {
      const a = db.asks.find((x) => x.id === askId);
      if (!a) throw new Error("That question is gone.");
      if (a.status !== "open") throw new Error("Already answered.");
      a.status = "answered";
      a.answer = note?.trim() ? `${answer} — ${note.trim()}` : answer;
      a.answeredAt = new Date().toISOString();
      return a;
    });
    const text =
      ask.kind === "approval"
        ? `${answer === "Approve" ? "Approved" : "Not approved"}: ${ask.question}${note?.trim() ? `\n${note.trim()}` : ""}`
        : `${ask.question}\n→ ${answer}${note?.trim() ? `\n${note.trim()}` : ""}`;
    after(() => looperChatReply(uid, ask.looperId, text).then(() => undefined).catch(() => undefined));
    return ask.looperId;
  });
}

export async function dismissAsk(askId: string) {
  return attempt(async () => {
    const uid = await requireUid();
    await mutate(uid, (db) => {
      const a = db.asks.find((x) => x.id === askId);
      if (a && a.status === "open") a.status = "dismissed";
    });
    return true as const;
  });
}

/** Start a skill without waiting for it; the chat shows its live steps. */
export async function startSkill(looperId: string, skillId: string) {
  return attempt(async () => {
    const uid = await requireUid();
    const looper = (await read(uid)).loopers.find((l) => l.id === looperId);
    const skill = looper?.skills.find((s) => s.id === skillId);
    if (!looper || !skill) throw new Error("Skill not found");
    after(() => runSkill(uid, looperId, skillId, "manual").then(() => undefined).catch(() => undefined));
    return skill.name;
  });
}

/** Retry failed skills (all of a looper's, or one run's skill) and clear them from the inbox. */
export async function retryFailed(looperId: string, runId?: string) {
  return attempt(async () => {
    const uid = await requireUid();
    const skills = await mutate(uid, (db) => {
      const failed = db.runs.filter((r) => r.looperId === looperId && r.status === "error" && !r.dismissed && (!runId || r.id === runId));
      for (const r of failed) r.dismissed = true;
      const live = new Set(db.loopers.find((l) => l.id === looperId)?.skills.map((s) => s.id) ?? []);
      return [...new Set(failed.map((r) => r.skillId))].filter((id) => live.has(id));
    });
    after(() => Promise.all(skills.map((id) => runSkill(uid, looperId, id, "manual").catch(() => undefined))).then(() => undefined));
    return skills.length;
  });
}

export async function dismissRuns(looperId: string, runId?: string) {
  return attempt(async () => {
    const uid = await requireUid();
    await mutate(uid, (db) => {
      for (const r of db.runs) if (r.looperId === looperId && r.status === "error" && (!runId || r.id === runId)) r.dismissed = true;
    });
    return true as const;
  });
}

// — Hiring —

export async function draftHire(goal: string) {
  return attempt(async () => {
    const uid = await requireUid();
    if (goal.trim().length < 8) throw new Error("Say a bit more about the goal.");
    return proposeLooper(uid, goal.trim());
  });
}

export async function confirmHire(spec: LooperSpec) {
  return attempt(async () => {
    const uid = await requireUid();
    const r = await hireLooper(uid, looperSpec.parse(spec));
    return { id: r.id, name: r.name, firstSkillId: r.firstSkill?.id, firstSkillName: r.firstSkill?.name };
  });
}

// — Command palette search —

export interface Hit {
  kind: "chat" | "row" | "card" | "canvas";
  looperId: string;
  title: string;
  detail: string;
  href: string;
}

/** Search what the loopers know: chats, database rows, cards and canvas notes. */
export async function searchEverything(q: string): Promise<Hit[]> {
  const uid = await requireUid();
  const query = q.trim().toLowerCase();
  if (query.length < 2) return [];
  const db = await read(uid);
  const has = (s?: string) => !!s && s.toLowerCase().includes(query);
  const around = (s: string) => {
    const i = s.toLowerCase().indexOf(query);
    const flat = s.replace(/\s+/g, " ");
    return (i > 40 ? "…" : "") + flat.slice(Math.max(0, i - 40), i + 80);
  };
  const hits: Hit[] = [];
  for (const l of db.loopers) {
    for (const c of db.cards.filter((c) => c.looperId === l.id && (has(c.title) || has(c.description))).slice(-5))
      hits.push({ kind: "card", looperId: l.id, title: c.title, detail: `${l.name} · Kanban`, href: `/loopers/${l.id}?tab=board` });
    for (const m of (db.chats?.[l.id] ?? []).filter((m) => has(m.content)).slice(-4))
      hits.push({ kind: "chat", looperId: l.id, title: around(m.content), detail: `${l.name} · Chat`, href: `/loopers/${l.id}?tab=chat` });
  }
  const tables = await Promise.all(db.loopers.map(async (l) => ({ l, t: await readDatabase(uid, l.id).catch(() => null), c: await readCanvas(uid, l.id).catch(() => null) })));
  for (const { l, t, c } of tables) {
    if (t) {
      const title = t.columns[0];
      for (const r of t.rows.filter((r) => Object.values(r.cells).some((v) => has(String(v ?? "")))).slice(0, 6))
        hits.push({ kind: "row", looperId: l.id, title: String(r.cells[title?.id] ?? "Row"), detail: `${l.name} · ${t.name}`, href: `/loopers/${l.id}?tab=database` });
    }
    for (const it of (c?.items ?? []).filter((i) => has(i.text) || has(i.title) || has(i.url)).slice(0, 4))
      hits.push({ kind: "canvas", looperId: l.id, title: it.title || around(it.text || it.url || ""), detail: `${l.name} · Canvas`, href: `/loopers/${l.id}?tab=canvas` });
  }
  for (const m of db.chief.filter((m) => has(m.content)).slice(-4))
    hits.push({ kind: "chat", looperId: "chief", title: around(m.content), detail: "Chief", href: "/chief" });
  return hits.slice(0, 30);
}
