"use server";

import { nanoid } from "nanoid";
import { after } from "next/server";
import { designDatabase, fillDatabase } from "@/lib/agent";
import { coerce, mutateDatabase, newDatabase, readDatabase, TEMPLATES } from "@/lib/database";
import { read } from "@/lib/db";
import { progressWriter, readProgress } from "@/lib/progress";
import { requireUid } from "@/lib/session";
import type { DbColumnType, DbRow, LooperDatabase } from "@/lib/types";

const now = () => new Date().toISOString();

async function owned(looperId: string) {
  const uid = await requireUid();
  if (!(await read(uid)).loopers.some((l) => l.id === looperId)) throw new Error("Looper not found");
  return uid;
}

/** Run a change against the looper's database and return the new state for the UI. */
async function change(looperId: string, fn: (db: LooperDatabase) => void): Promise<LooperDatabase> {
  const uid = await owned(looperId);
  return mutateDatabase(uid, looperId, (box) => {
    if (!box.db) throw new Error("This looper has no database yet.");
    fn(box.db);
    return box.db;
  });
}

export async function getLooperDatabase(looperId: string) {
  const uid = await owned(looperId);
  return readDatabase(uid, looperId);
}

/** Let the looper design its own database from its mission, skills, apps and past runs.
 * Returns the error text instead of throwing: production hides thrown server-action messages. */
export async function generateLooperDatabase(looperId: string): Promise<{ since: number } | { error: string }> {
  try {
    const uid = await owned(looperId);
    // Designing takes a model call; do it in the background and let the page follow design:<id>.
    const running = await readProgress(uid, `design:${looperId}`);
    if (running && !running.done && Date.now() - running.since < 5 * 60_000) return { since: running.since };
    const name = (await read(uid)).loopers.find((l) => l.id === looperId)?.name ?? "The looper";
    const live = progressWriter(uid, `design:${looperId}`, { label: `${name}'s database`, href: `/loopers/${looperId}?tab=database`, done: "is designed", failed: "couldn't be designed" });
    live.push("Choosing what one row is and which columns it needs…");
    after(async () => {
      try {
        const db = await designDatabase(uid, looperId);
        // Nothing to pre-fill from past runs: have the looper pull rows from its sources next.
        await live.done({ ok: true, note: db.rows.length ? `${db.rows.length} rows from past work` : "Filling it from its sources next" });
        if (db.rows.length === 0) await fillDatabase(uid, looperId, "manual").catch(() => undefined);
      } catch (e) {
        await live.done({ error: e instanceof Error ? e.message : String(e) });
      }
    });
    return { since: live.since };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Start a background run that fills the database from the looper's connected sources. */
export async function fillLooperDatabase(looperId: string): Promise<{ ok: true } | { error: string }> {
  try {
    const uid = await owned(looperId);
    after(() => fillDatabase(uid, looperId, "manual").then(() => undefined).catch(() => undefined));
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The latest "Fill database" run, so the UI can show when it finished and what it said. */
export async function latestFillRun(looperId: string) {
  const uid = await owned(looperId);
  const run = (await read(uid)).runs.filter((r) => r.looperId === looperId && r.skillId === "fill-database").at(-1);
  return run ? { status: run.status, startedAt: run.startedAt, summary: run.summary } : null;
}

export async function createLooperDatabase(looperId: string, template: keyof typeof TEMPLATES) {
  const uid = await owned(looperId);
  const t = TEMPLATES[template] ?? TEMPLATES.blank;
  return mutateDatabase(uid, looperId, (box) => (box.db ??= newDatabase(t.name, t.rowNoun, t.columns)));
}

export async function renameDatabase(looperId: string, name: string) {
  return change(looperId, (db) => void (db.name = name.trim() || db.name));
}

export async function addDbRow(looperId: string) {
  return change(looperId, (db) => {
    const row: DbRow = { id: nanoid(8), cells: {}, createdBy: "user", createdAt: now(), updatedAt: now() };
    db.rows.push(row);
  });
}

export async function updateDbCell(looperId: string, rowId: string, columnId: string, value: unknown) {
  return change(looperId, (db) => {
    const row = db.rows.find((r) => r.id === rowId);
    const col = db.columns.find((c) => c.id === columnId);
    if (!row || !col) throw new Error("Row or column not found");
    row.cells[col.id] = coerce(col, value);
    row.updatedAt = now();
  });
}

export async function deleteDbRow(looperId: string, rowId: string) {
  return change(looperId, (db) => void (db.rows = db.rows.filter((r) => r.id !== rowId)));
}

export async function addDbColumn(looperId: string, name: string, type: DbColumnType, options: string[] = []) {
  return change(looperId, (db) => {
    db.columns.push({ id: nanoid(6), name: name.trim() || "Untitled", type, options: type === "select" ? options : undefined });
  });
}

export async function renameDbColumn(looperId: string, columnId: string, name: string) {
  return change(looperId, (db) => {
    const col = db.columns.find((c) => c.id === columnId);
    if (col && name.trim()) col.name = name.trim();
  });
}

export async function deleteDbColumn(looperId: string, columnId: string) {
  return change(looperId, (db) => {
    db.columns = db.columns.filter((c) => c.id !== columnId);
    for (const r of db.rows) delete r.cells[columnId];
  });
}
