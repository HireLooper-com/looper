import type { Ask, Card, DB, Looper, Run } from "./types";
import { cardAssignee } from "./types";
import { occurrences } from "./schedule";

// Everything waiting on the owner, across loopers: questions, cards for them, runs that failed.

export type InboxItem =
  | { kind: "ask"; key: string; looperId: string; at: string; ask: Ask }
  | { kind: "card"; key: string; looperId: string; at: string; card: Card }
  | { kind: "failed"; key: string; looperId: string; at: string; run: Run; count: number };

/** The latest run of each skill, when it failed and the owner hasn't dismissed it. */
function failedSkills(db: Pick<DB, "runs" | "loopers">, looperId?: string) {
  const out: { run: Run; count: number }[] = [];
  const live = new Set(db.loopers.map((l) => l.id));
  const bySkill = new Map<string, Run[]>();
  for (const r of db.runs) {
    if ((looperId && r.looperId !== looperId) || !live.has(r.looperId) || r.status === "running") continue;
    const k = `${r.looperId}:${r.skillId}`;
    bySkill.set(k, [...(bySkill.get(k) ?? []), r]);
  }
  for (const runs of bySkill.values()) {
    const last = runs.at(-1)!;
    if (last.status !== "error" || last.dismissed) continue;
    let count = 0;
    for (let i = runs.length - 1; i >= 0 && runs[i].status === "error"; i--) count++;
    out.push({ run: last, count });
  }
  return out;
}

export function inboxItems(db: Pick<DB, "asks" | "cards" | "runs" | "loopers">, looperId?: string): InboxItem[] {
  const live = new Set(db.loopers.map((l) => l.id));
  const mine = (id: string) => live.has(id) && (!looperId || id === looperId);
  const items: InboxItem[] = [
    ...db.asks.filter((a) => a.status === "open" && mine(a.looperId)).map((ask) => ({ kind: "ask" as const, key: `ask:${ask.id}`, looperId: ask.looperId, at: ask.createdAt, ask })),
    ...db.cards
      .filter((c) => c.column !== "done" && mine(c.looperId) && cardAssignee(c) === "you")
      .map((card) => ({ kind: "card" as const, key: `card:${card.id}`, looperId: card.looperId, at: card.updatedAt, card })),
    ...failedSkills(db, looperId).map(({ run, count }) => ({ kind: "failed" as const, key: `run:${run.id}`, looperId: run.looperId, at: run.finishedAt ?? run.startedAt, run, count })),
  ];
  const rank = { ask: 0, card: 1, failed: 2 };
  return items.sort((a, b) => rank[a.kind] - rank[b.kind] || b.at.localeCompare(a.at));
}

export function needsYouCount(db: Pick<DB, "asks" | "cards" | "runs" | "loopers">, looperId: string) {
  return inboxItems(db, looperId).length;
}

// — Metric helpers shared by the rail, header and brief —

export function metricNow(l: Looper) {
  return l.metric.history.at(-1)?.value;
}

/** Change over the last `days` days: latest reading minus the last reading before the window. */
export function metricDelta(l: Looper, days: number, now = Date.now()) {
  const h = l.metric.history;
  if (h.length < 2) return undefined;
  const since = new Date(now - days * 86_400_000).toISOString();
  const before = [...h].reverse().find((p) => p.at < since) ?? h[0];
  const last = h.at(-1)!;
  if (before === last) return undefined;
  return last.value - before.value;
}

/** "▲3" / "▼3" / "flat", and whether that direction is good for this metric. */
export function trend(l: Looper, delta: number | undefined) {
  if (delta === undefined) return { text: "", good: undefined as boolean | undefined };
  if (delta === 0) return { text: "flat", good: undefined };
  const n = Math.abs(delta);
  const shown = Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: n >= 10_000 ? "compact" : "standard" }).format(n);
  return { text: `${delta > 0 ? "▲" : "▼"}${shown}`, good: l.metric.direction === "up" ? delta > 0 : delta < 0 };
}

// — Daily brief —

export interface BriefLine {
  looper: Pick<Looper, "id" | "name" | "color" | "status">;
  metric: { name: string; value?: number; target: number; unit: string; delta?: number; good?: boolean; trend: string };
  done: number;
  failed: number;
  rows: number;
  cardsDone: number;
  needsYou: number;
  next?: { skill: string; at: string };
  /** the latest finished run's first sentence */
  latest?: string;
}

const firstSentence = (s: string) => {
  const flat = s.replace(/\s+/g, " ").trim();
  const m = flat.match(/^(.{20,180}?[.!?])(\s|$)/);
  return m ? m[1] : flat.slice(0, 160) + (flat.length > 160 ? "…" : "");
};

/** What happened in the last day per looper, and what's next today. Pure: no model call. */
export function dailyBrief(db: Pick<DB, "asks" | "cards" | "runs" | "loopers">, now = Date.now()): BriefLine[] {
  const since = new Date(now - 86_400_000).toISOString();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return db.loopers.map((l) => {
    const runs = db.runs.filter((r) => r.looperId === l.id && r.status !== "running" && (r.finishedAt ?? r.startedAt) >= since);
    const delta = metricDelta(l, 1, now);
    const t = trend(l, delta);
    const next =
      l.status === "active"
        ? l.skills
            .flatMap((s) => occurrences(s.schedule, new Date(now), endOfDay).slice(0, 1).map((at) => ({ skill: s.name, at: at.toISOString() })))
            .sort((a, b) => a.at.localeCompare(b.at))[0]
        : undefined;
    const latest = [...runs].reverse().find((r) => r.status === "success" && r.summary);
    return {
      looper: { id: l.id, name: l.name, color: l.color, status: l.status },
      metric: { name: l.metric.name, value: metricNow(l), target: l.metric.target, unit: l.metric.unit, delta, good: t.good, trend: t.text },
      done: runs.filter((r) => r.status === "success").length,
      failed: runs.filter((r) => r.status === "error").length,
      rows: runs.reduce((n, r) => n + (r.stats?.rows ?? 0), 0),
      cardsDone: db.cards.filter((c) => c.looperId === l.id && c.column === "done" && c.updatedAt >= since).length,
      needsYou: needsYouCount(db, l.id),
      next,
      latest: latest ? firstSentence(latest.summary) : undefined,
    };
  });
}
