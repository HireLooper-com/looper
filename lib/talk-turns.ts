// Pure parts of the looper chat (lib/talk.ts), kept apart so tests run without a database.

export type ChangeStatus = "proposed" | "applied" | "dismissed";
type Base = { why: string; status: ChangeStatus; by?: string; note?: string }; // by, note: who applied it and what happened

/** What the looper may propose in chat. Nothing applies until a person presses Apply. */
export type Change = Base &
  (
    | { kind: "rules"; routine_id: number; name: string; from_version: number; from: string; to: string }
    | { kind: "schedule"; routine_id: number; name: string; from: Slot; to: Slot }
    | { kind: "routine"; name: string; tool: string; days: number[]; hour: number; rules: string }
    | { kind: "target"; from: Goal; to: Goal }
    | { kind: "brief"; from: string; to: string }
    | { kind: "run"; routine_id: number; name: string }
  );
export type Slot = { days: number[]; hour: number; mode: "ask" | "auto" };
export type Goal = { target: number | null; date: string };

export type TalkRow = { id: number; role: "user" | "assistant"; content: string; changes: Change[] };

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Days 0 = Mon ... 6 = Sun, deduplicated and sorted. Empty when nothing valid is left. */
export function cleanDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [];
  return [...new Set(days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}

export const slotText = (s: Slot) =>
  `${s.days.map((d) => DAY[d]).join(", ")} ${String(s.hour).padStart(2, "0")}:00, ${s.mode === "auto" ? "runs alone" : "asks first"}`;

/** One line per change, for the model's memory of what it proposed and what happened to it. */
export function changeLine(c: Change) {
  const what =
    c.kind === "rules" ? `new rules for ${c.name}`
    : c.kind === "schedule" ? `${c.name}: ${slotText(c.to)}`
    : c.kind === "routine" ? `new routine ${c.name}`
    : c.kind === "target" ? `target ${c.to.target ?? "unset"} by ${c.to.date}`
    : c.kind === "brief" ? "a new brief"
    : `run ${c.name} now`;
  return `[proposed ${what}: ${c.status}]`;
}

/**
 * The stored chat as model turns: the last `max` messages, starting on a founder turn
 * (the API wants the first turn from the user), with each reply's proposals and their status.
 */
export function toTurns(rows: TalkRow[], max = 30) {
  const tail = rows.slice(-max);
  while (tail.length && tail[0].role !== "user") tail.shift();
  return tail.map((r) => ({
    role: r.role,
    content: r.role === "assistant" && r.changes.length ? [r.content, ...r.changes.map(changeLine)].filter(Boolean).join("\n") : r.content || "(no text)",
  }));
}
