import "server-only";
import { tool, type ToolSet } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { kv } from "./kv";
import type { DbColumn, DbColumnType, DbRow, DbValue, LooperDatabase } from "./types";

// Each looper's database lives under its own key, so a few thousand rows don't bloat the workspace.
const key = (uid: string, looperId: string) => `db:${uid}:${looperId}`;
const now = () => new Date().toISOString();

interface Box {
  db: LooperDatabase | null;
}

export async function readDatabase(uid: string, looperId: string): Promise<LooperDatabase | null> {
  return (await kv.get<Box>(key(uid, looperId)))?.db ?? null;
}

/** Locked read-modify-write. `box.db` is null until a database is created; assign it to create one. */
export function mutateDatabase<T>(uid: string, looperId: string, fn: (box: Box) => T | Promise<T>) {
  return kv.update<Box, T>(key(uid, looperId), () => ({ db: null }), fn);
}

export async function deleteDatabase(uid: string, looperId: string) {
  await kv.delete(key(uid, looperId));
}

export const columnSpec = z.object({
  name: z.string(),
  type: z.enum(["text", "number", "currency", "date", "select", "checkbox", "url"]),
  options: z.array(z.string()).optional().describe("for select columns"),
});
export type ColumnSpec = z.infer<typeof columnSpec>;

export function newDatabase(name: string, rowNoun: string, columns: ColumnSpec[]): LooperDatabase {
  return { name, rowNoun, columns: columns.map((c) => ({ id: nanoid(6), name: c.name, type: c.type, options: c.type === "select" ? (c.options ?? []) : undefined })), rows: [] };
}

/** Ready-made databases for common loopers. */
export const TEMPLATES: Record<string, { label: string; name: string; rowNoun: string; columns: ColumnSpec[] }> = {
  transactions: {
    label: "Transactions (VAT, bookkeeping)",
    name: "Transactions",
    rowNoun: "bank transaction",
    columns: [
      { name: "Description", type: "text" },
      { name: "Date", type: "date" },
      { name: "Amount", type: "currency" },
      { name: "Counterparty", type: "text" },
      { name: "Source", type: "select", options: ["bunq", "Stripe", "Other"] },
      { name: "VAT rate", type: "select", options: ["21%", "9%", "0%", "Reverse charge", "Exempt", "Unknown"] },
      { name: "VAT amount", type: "currency" },
      { name: "Invoice found", type: "checkbox" },
      { name: "Invoice link", type: "url" },
      { name: "Status", type: "select", options: ["Unmatched", "Matched", "Needs review", "Private"] },
    ],
  },
  content: {
    label: "Content pipeline (SEO, blog)",
    name: "Blog posts",
    rowNoun: "blog post",
    columns: [
      { name: "Title", type: "text" },
      { name: "Status", type: "select", options: ["Idea", "Drafting", "In review", "Published"] },
      { name: "Target keyword", type: "text" },
      { name: "Search intent", type: "select", options: ["Informational", "Commercial", "Navigational"] },
      { name: "URL", type: "url" },
      { name: "Published", type: "date" },
      { name: "Clicks (28d)", type: "number" },
      { name: "Impressions (28d)", type: "number" },
    ],
  },
  leads: {
    label: "Leads (sales, outreach)",
    name: "Leads",
    rowNoun: "lead",
    columns: [
      { name: "Name", type: "text" },
      { name: "Company", type: "text" },
      { name: "Email", type: "text" },
      { name: "Stage", type: "select", options: ["New", "Contacted", "Replied", "Call booked", "Won", "Lost"] },
      { name: "Last contact", type: "date" },
      { name: "Value", type: "currency" },
    ],
  },
  blank: { label: "Blank", name: "Database", rowNoun: "item", columns: [{ name: "Name", type: "text" }, { name: "Status", type: "select", options: ["To do", "Doing", "Done"] }] },
};

/** Coerce a loose value (from a model or an input) to the column's type. */
export function coerce(col: DbColumn, value: unknown): DbValue {
  if (value === null || value === undefined || value === "") return null;
  switch (col.type) {
    case "number":
    case "currency": {
      const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.,-]/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
    case "checkbox":
      return value === true || ["true", "yes", "1", "x", "✓"].includes(String(value).toLowerCase());
    case "date": {
      const d = new Date(String(value));
      return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
    }
    case "select": {
      const v = String(value).trim();
      const match = col.options?.find((o) => o.toLowerCase() === v.toLowerCase());
      if (match) return match;
      col.options = [...(col.options ?? []), v];
      return v;
    }
    default:
      return String(value);
  }
}

const byName = (db: LooperDatabase, name: string) => db.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());

function rowToNamed(db: LooperDatabase, r: DbRow) {
  return { id: r.id, ...Object.fromEntries(db.columns.map((c) => [c.name, r.cells[c.id] ?? null])) };
}

function applyValues(db: LooperDatabase, row: DbRow, values: Record<string, unknown>) {
  const unknown: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    const col = byName(db, name);
    if (!col) unknown.push(name);
    else row.cells[col.id] = coerce(col, value);
  }
  row.updatedAt = now();
  return unknown;
}

/** Tools a looper uses to keep its database current. Rows are addressed by id, columns by name. */
export function databaseTools(uid: string, looperId: string): ToolSet {
  const values = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).describe("column name → value");
  return {
    db_describe: tool({
      description: "Show your database: what a row is, its columns (with types and select options) and how many rows it has.",
      inputSchema: z.object({}),
      execute: async () => {
        const db = await readDatabase(uid, looperId);
        if (!db) return { database: null, note: "No database yet. Create one with db_create." };
        return { name: db.name, row: db.rowNoun, rows: db.rows.length, columns: db.columns.map((c) => ({ name: c.name, type: c.type, options: c.options })) };
      },
    }),
    db_create: tool({
      description: "Create your database if you don't have one. One row = one unit of your work (e.g. one bank transaction, one blog post).",
      inputSchema: z.object({ name: z.string(), rowNoun: z.string(), columns: z.array(columnSpec).min(1).max(20) }),
      execute: ({ name, rowNoun, columns }) =>
        mutateDatabase(uid, looperId, (box) => {
          if (box.db) return { error: "A database already exists. Use db_add_column to extend it." };
          box.db = newDatabase(name, rowNoun, columns);
          return { created: name };
        }),
    }),
    db_query: tool({
      description: "Find rows. Filter by exact column values (\"\" matches an empty cell) and/or a text search across all columns. Returns up to `limit` rows from `offset`, with their ids.",
      inputSchema: z.object({ where: values.optional(), search: z.string().optional(), limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) }),
      execute: async ({ where, search, limit, offset }) => {
        const db = await readDatabase(uid, looperId);
        if (!db) return { rows: [], note: "No database yet." };
        const q = search?.toLowerCase();
        const rows = db.rows.filter((r) => {
          for (const [name, v] of Object.entries(where ?? {})) {
            const col = byName(db, name);
            if (!col || String(r.cells[col.id] ?? "").toLowerCase() !== String(v ?? "").toLowerCase()) return false;
          }
          return !q || Object.values(r.cells).some((v) => String(v ?? "").toLowerCase().includes(q));
        });
        return { total: rows.length, rows: rows.slice(offset, offset + limit).map((r) => rowToNamed(db, r)) };
      },
    }),
    db_add_rows: tool({
      description:
        "Add new rows. Never add a row that's already there: db_query first by its identifying values (date + amount + counterparty, URL, email…) and update the existing row with db_update_rows instead. Rows identical to an existing one are skipped.",
      inputSchema: z.object({ rows: z.array(values).min(1).max(100) }),
      execute: ({ rows }) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet. Create one with db_create." };
          const unknown = new Set<string>();
          // Same values in every column = the same row; catches re-adds the looper didn't query for.
          const key = (r: DbRow) => JSON.stringify(db.columns.map((c) => r.cells[c.id] ?? null));
          const seen = new Map(db.rows.map((r) => [key(r), r.id]));
          const ids: string[] = [];
          const duplicates: string[] = [];
          for (const v of rows) {
            const row: DbRow = { id: nanoid(8), cells: {}, createdBy: "looper", createdAt: now(), updatedAt: now() };
            applyValues(db, row, v).forEach((u) => unknown.add(u));
            const existing = seen.get(key(row));
            if (existing) {
              duplicates.push(existing);
              continue;
            }
            seen.set(key(row), row.id);
            db.rows.push(row);
            ids.push(row.id);
          }
          return {
            added: ids.length,
            ids,
            ignoredColumns: [...unknown],
            ...(duplicates.length ? { skippedDuplicates: duplicates.length, existingIds: duplicates } : {}),
          };
        }),
    }),
    db_update_rows: tool({
      description: "Update existing rows by id with new column values.",
      inputSchema: z.object({ updates: z.array(z.object({ id: z.string(), values })).min(1).max(100) }),
      execute: ({ updates }) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet." };
          let updated = 0;
          const missing: string[] = [];
          for (const u of updates) {
            const row = db.rows.find((r) => r.id === u.id);
            if (!row) missing.push(u.id);
            else {
              applyValues(db, row, u.values);
              updated++;
            }
          }
          return { updated, missing };
        }),
    }),
    db_delete_rows: tool({
      description:
        "Delete rows you own: by id, or every row matching `where` (exact column values; \"\" matches an empty cell). Use it to remove duplicates, junk or rows the owner asks to drop. Deleting is permanent, so db_query first and pass exact ids when you can.",
      inputSchema: z.object({ ids: z.array(z.string()).max(500).optional(), where: values.optional() }),
      execute: ({ ids, where }) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet." };
          if (!ids?.length && !where) return { error: "Pass ids or where." };
          const unknown = Object.keys(where ?? {}).filter((n) => !byName(db, n));
          if (unknown.length) return { error: `Unknown columns: ${unknown.join(", ")}` };
          const wanted = new Set(ids ?? []);
          const matches = (r: DbRow) =>
            (ids?.length ? wanted.has(r.id) : true) &&
            Object.entries(where ?? {}).every(([n, v]) => String(r.cells[byName(db, n)!.id] ?? "").toLowerCase() === String(v ?? "").toLowerCase());
          const missing = (ids ?? []).filter((id) => !db.rows.some((r) => r.id === id));
          const before = db.rows.length;
          db.rows = db.rows.filter((r) => !matches(r));
          return { deleted: before - db.rows.length, rows: db.rows.length, ...(missing.length ? { missing } : {}) };
        }),
    }),
    db_dedupe: tool({
      description:
        "Remove duplicate rows. Rows with the same values in `keys` (e.g. Date + Amount + Counterparty) count as one; the row with the most filled cells is kept and the rest deleted. Run with dryRun first to see what would go.",
      inputSchema: z.object({ keys: z.array(z.string()).min(1), dryRun: z.boolean().default(false) }),
      execute: ({ keys, dryRun }) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet." };
          const cols = keys.map((k) => byName(db, k));
          const unknown = keys.filter((_, i) => !cols[i]);
          if (unknown.length) return { error: `Unknown columns: ${unknown.join(", ")}` };
          const filled = (r: DbRow) => Object.values(r.cells).filter((v) => v !== null && v !== "" && v !== false).length;
          const groups = new Map<string, DbRow[]>();
          for (const r of db.rows) {
            const k = JSON.stringify(cols.map((c) => String(r.cells[c!.id] ?? "").trim().toLowerCase()));
            groups.set(k, [...(groups.get(k) ?? []), r]);
          }
          const drop = new Set<string>();
          for (const rows of groups.values()) {
            if (rows.length < 2) continue;
            const keep = rows.reduce((a, b) => (filled(b) > filled(a) ? b : a));
            rows.forEach((r) => r !== keep && drop.add(r.id));
          }
          if (!dryRun) db.rows = db.rows.filter((r) => !drop.has(r.id));
          return { [dryRun ? "wouldDelete" : "deleted"]: drop.size, rows: db.rows.length, sample: [...drop].slice(0, 20) };
        }),
    }),
    db_add_column: tool({
      description: "Add a column when you need to track something new.",
      inputSchema: columnSpec,
      execute: (spec) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet." };
          if (byName(db, spec.name)) return { error: `Column ${spec.name} exists` };
          db.columns.push({ id: nanoid(6), name: spec.name, type: spec.type as DbColumnType, options: spec.type === "select" ? (spec.options ?? []) : undefined });
          return { added: spec.name };
        }),
    }),
    db_update_column: tool({
      description: "Rename a column, change its type, or replace its select options. Existing values are converted to the new type.",
      inputSchema: z.object({ column: z.string(), name: z.string().optional(), type: columnSpec.shape.type.optional(), options: z.array(z.string()).optional() }),
      execute: ({ column, name, type, options }) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet." };
          const col = byName(db, column);
          if (!col) return { error: `No column ${column}` };
          if (name?.trim() && name.trim().toLowerCase() !== col.name.toLowerCase() && byName(db, name.trim())) return { error: `Column ${name} exists` };
          if (name?.trim()) col.name = name.trim();
          if (type) col.type = type;
          if (col.type === "select") col.options = options ?? col.options ?? [];
          else col.options = undefined;
          if (type) for (const r of db.rows) r.cells[col.id] = coerce(col, r.cells[col.id]);
          return { updated: col.name, type: col.type, options: col.options };
        }),
    }),
    db_delete_column: tool({
      description: "Delete a column and its values from every row. Permanent.",
      inputSchema: z.object({ column: z.string() }),
      execute: ({ column }) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet." };
          const col = byName(db, column);
          if (!col) return { error: `No column ${column}` };
          db.columns = db.columns.filter((c) => c !== col);
          for (const r of db.rows) delete r.cells[col.id];
          return { deleted: col.name };
        }),
    }),
    db_rename: tool({
      description: "Rename your database or change what one row is.",
      inputSchema: z.object({ name: z.string().optional(), rowNoun: z.string().optional() }),
      execute: ({ name, rowNoun }) =>
        mutateDatabase(uid, looperId, ({ db }) => {
          if (!db) return { error: "No database yet." };
          if (name?.trim()) db.name = name.trim();
          if (rowNoun?.trim()) db.rowNoun = rowNoun.trim();
          return { name: db.name, row: db.rowNoun };
        }),
    }),
  };
}

/** One line for the looper's brief. */
export function describeDatabase(db: LooperDatabase | null) {
  if (!db) return "You have no database yet. If your work has a natural unit (a transaction, a post, a lead), create one with db_create.";
  return `Your database "${db.name}" has ${db.rows.length} rows; one row = one ${db.rowNoun}. Columns: ${db.columns.map((c) => `${c.name} (${c.type}${c.options?.length ? `: ${c.options.join("/")}` : ""})`).join(", ")}. Keep it current: add new ${db.rowNoun}s, update their status as you work, and query it before acting.`;
}
