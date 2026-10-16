"use server";

import { nanoid } from "nanoid";
import { coerce, mutateDatabase, newDatabase, readDatabase, TEMPLATES } from "@/lib/database";
import { read } from "@/lib/db";
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
