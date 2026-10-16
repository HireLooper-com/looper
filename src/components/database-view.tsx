"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDbColumn,
  addDbRow,
  createLooperDatabase,
  deleteDbColumn,
  fillLooperDatabase,
  latestFillRun,
  deleteDbRow,
  generateLooperDatabase,
  getLooperDatabase,
  renameDatabase,
  renameDbColumn,
  updateDbCell,
} from "@/app/db-actions";
import type { DbColumn, DbColumnType, DbRow, DbValue, LooperDatabase } from "@/lib/types";
import { DB_COLUMN_TYPES } from "@/lib/types";
import { Bot, Button, cx } from "./ui";

function Tag({ col, value }: { col: DbColumn; value: string }) {
  // Colour by option position; light and dark palettes live in globals.css (.tag[data-c]).
  const i = Math.max(0, col.options?.indexOf(value) ?? 0) % 9;
  return (
    <span data-c={i} className="tag inline-flex max-w-full items-center truncate rounded-[4px] px-1.5 py-[1px] text-[0.8125rem] leading-5">
      {value}
    </span>
  );
}

const TEMPLATE_CARDS = [
  { id: "transactions", icon: "🧾", title: "Transactions", text: "One row per bank transaction: amount, VAT rate, invoice found, status. For VAT and bookkeeping." },
  { id: "content", icon: "✍️", title: "Content pipeline", text: "One row per blog post or idea: status, keyword, URL, clicks. For SEO and content." },
  { id: "leads", icon: "🎯", title: "Leads", text: "One row per lead: stage, last contact, value. For sales and outreach." },
  { id: "blank", icon: "▦", title: "Blank", text: "Start with a name and a status column and shape it yourself." },
] as const;

function display(col: DbColumn, v: DbValue) {
  if (v === null || v === undefined || v === "") return "";
  if (col.type === "currency" && typeof v === "number") return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(v);
  if (col.type === "number" && typeof v === "number") return new Intl.NumberFormat("en").format(v);
  if (col.type === "date") {
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
  }
  return String(v);
}

export function DatabaseView({ looperId, looperName, color }: { looperId: string; looperName: string; color?: import("@/lib/types").Accent }) {
  const [db, setDb] = useState<LooperDatabase | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [designing, setDesigning] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const designStarted = useRef(false);
  const [fillingUntil, setFillingUntil] = useState(0);
  const [fillStartedAt, setFillStartedAt] = useState("");
  const [fillResult, setFillResult] = useState<{ ok: boolean; text: string } | null>(null);
  const filling = fillingUntil > 0;

  const load = useCallback(() => getLooperDatabase(looperId).then(setDb).catch((e) => setError(String(e?.message ?? e))), [looperId]);
  useEffect(() => {
    load();
    // Loopers write rows while they run; refresh now and then (often while a fill runs).
    const t = setInterval(() => {
      load();
      setFillingUntil((u) => (u && Date.now() > u ? 0 : u));
      if (filling)
        latestFillRun(looperId).then((r) => {
          // Our fill has finished once a fill run started after we asked is no longer running.
          if (r && r.startedAt >= fillStartedAt && r.status !== "running") {
            setFillingUntil(0);
            setFillResult({ ok: r.status === "success", text: r.summary });
          }
        });
    }, filling ? 4000 : 15000);
    return () => clearInterval(t);
  }, [load, filling, looperId, fillStartedAt]);

  const beginFilling = () => {
    setFillResult(null);
    setFillStartedAt(new Date(Date.now() - 5000).toISOString());
    setFillingUntil(Date.now() + 5 * 60_000);
  };

  const startFill = () => {
    setError(null);
    fillLooperDatabase(looperId).then((r) => {
      if ("error" in r) setError(r.error);
      else beginFilling();
    });
  };

  const design = () => {
    setError(null);
    setShowTemplates(false);
    setDesigning(true);
    generateLooperDatabase(looperId)
      .then((r) => {
        if ("db" in r) {
          setDb(r.db);
          if (r.filling) beginFilling();
        }
        else {
          setError(r.error);
          setShowTemplates(true);
        }
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setShowTemplates(true);
      })
      .finally(() => setDesigning(false));
  };

  // No database yet: the looper designs one from what it knows, once per visit.
  useEffect(() => {
    if (db !== null || designStarted.current) return;
    designStarted.current = true;
    design();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, looperId]);

  const run = async (p: Promise<LooperDatabase>) => {
    setError(null);
    try {
      setDb(await p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      load();
    }
  };

  const setCell = (row: DbRow, col: DbColumn, value: DbValue) => {
    // Optimistic: show the edit now, then take the server's coerced value.
    setDb((d) => d && { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, cells: { ...r.cells, [col.id]: value } } : r)) });
    run(updateDbCell(looperId, row.id, col.id, value));
  };

  const rows = useMemo(() => {
    if (!db) return [];
    const q = search.trim().toLowerCase();
    let list = q ? db.rows.filter((r) => Object.values(r.cells).some((v) => String(v ?? "").toLowerCase().includes(q))) : db.rows;
    if (sort) {
      list = [...list].sort((a, b) => {
        const x = a.cells[sort.col];
        const y = b.cells[sort.col];
        if (x == null || x === "") return 1;
        if (y == null || y === "") return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return list;
  }, [db, search, sort]);

  if (db === undefined) return <div className="tile p-8 text-[0.9375rem] text-mute">Loading database…</div>;

  if (db === null)
    return (
      <div className="tile p-8">
        {designing || !showTemplates ? (
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="animate-bounce [animation-duration:1.6s]">
              <Bot color={color} size={64} seed={looperId} />
            </div>
            <div>
              <div className="text-[1.375rem] font-semibold tracking-[-0.02em]">{looperName} is designing a database</div>
              <p className="mx-auto mt-1 max-w-[52ch] text-[0.9375rem] text-mute">
                From the mission, metric, skills and apps, with rows filled in from past runs. This takes a few seconds.
              </p>
            </div>
            <button onClick={() => setShowTemplates(true)} className="text-[0.8125rem] text-blue hover:underline">
              Or start from a template
            </button>
          </div>
        ) : (
          <>
            <div className="text-[1.5rem] font-semibold tracking-[-0.02em]">Start {looperName}&apos;s database</div>
            {error && <p className="mt-2 rounded-[10px] bg-red/8 px-3 py-2 text-[0.875rem] text-red">{looperName} couldn&apos;t design it: {error}</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={design}
              >
                Let {looperName} design it
              </Button>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TEMPLATE_CARDS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => run(createLooperDatabase(looperId, t.id))}
                  className="flex gap-3 rounded-[14px] border border-line p-4 text-left transition-colors hover:border-blue hover:bg-blue/[0.03]"
                >
                  <span className="text-[1.5rem] leading-none">{t.icon}</span>
                  <span>
                    <span className="block font-semibold">{t.title}</span>
                    <span className="mt-0.5 block text-[0.8125rem] leading-snug text-mute">{t.text}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );

  const peekRow = db.rows.find((r) => r.id === peek) ?? null;

  return (
    <div className="tile overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pb-3 pt-5">
        <div className="min-w-0">
          <InlineText
            value={db.name}
            onCommit={(v) => run(renameDatabase(looperId, v))}
            className="text-[1.625rem] font-bold tracking-[-0.02em]"
          />
          <div className="text-[0.8125rem] text-mute">
            {db.rows.length} {db.rowNoun}
            {db.rows.length === 1 ? "" : "s"}
            {search && ` · ${rows.length} shown`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="h-8 w-40 rounded-[8px] bg-ink/[0.04] px-3 text-[0.8125rem] outline-none placeholder:text-faint focus:bg-panel focus:ring-2 focus:ring-blue/30"
          />
          <Button size="sm" variant="soft" onClick={startFill} disabled={filling}>
            {filling ? "Filling…" : "Fill from sources"}
          </Button>
          <Button size="sm" onClick={() => run(addDbRow(looperId))}>
            New
          </Button>
        </div>
      </div>
      {error && <div className="mx-6 mb-3 rounded-[10px] bg-red/8 px-3 py-2 text-[0.8125rem] text-red">{error}</div>}
      {fillResult && !filling && (
        <div className={cx("mx-6 mb-3 whitespace-pre-wrap rounded-[12px] px-3 py-2 text-[0.8125rem]", fillResult.ok ? "bg-green/10 text-green-deep" : "bg-red/8 text-red")}>
          <div className="mb-0.5 font-semibold">{fillResult.ok ? `${looperName} finished filling` : `${looperName} couldn't fill the database`}</div>
          {fillResult.text.slice(0, 1200)}
          <button onClick={() => setFillResult(null)} className="ml-2 underline opacity-70">
            Dismiss
          </button>
        </div>
      )}
      {filling && (
        <div className="mx-6 mb-3 flex items-center gap-3 rounded-[12px] bg-blue/[0.07] px-3 py-2 text-[0.8125rem] text-ink-2">
          <Bot color={color} size={22} seed={looperId} />
          {looperName} is reading the sources and adding {db.rowNoun}s. Rows appear here as they&apos;re added; it can take a few minutes. Anything missing lands on the Kanban as a card for you.
        </div>
      )}

      <div className="overflow-x-auto border-t border-line">
        <table className="w-max min-w-full border-collapse text-[0.875rem]">
          <thead>
            <tr className="text-left text-[0.8125rem] text-mute">
              <th className="sticky left-0 z-10 w-9 border-b border-line bg-panel" />
              {db.columns.map((col) => (
                <ColumnHeader
                  key={col.id}
                  col={col}
                  sort={sort?.col === col.id ? sort.dir : 0}
                  onSort={(dir) => setSort(dir ? { col: col.id, dir } : null)}
                  onRename={(name) => run(renameDbColumn(looperId, col.id, name))}
                  onDelete={() => confirm(`Delete column "${col.name}" and its values?`) && run(deleteDbColumn(looperId, col.id))}
                />
              ))}
              <th className="border-b border-line px-2 font-normal">
                <AddColumn onAdd={(name, type, options) => run(addDbColumn(looperId, name, type, options))} />
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="group hover:bg-ink/[0.018]">
                <td className="sticky left-0 z-10 w-9 border-b border-line bg-panel px-1 group-hover:bg-ink/[0.02]">
                  <button
                    onClick={() => setPeek(row.id)}
                    className="invisible flex h-6 w-7 items-center justify-center rounded-[5px] text-[0.75rem] text-mute hover:bg-ink/[0.06] group-hover:visible"
                    aria-label="Open row"
                    title="Open"
                  >
                    ⤢
                  </button>
                </td>
                {db.columns.map((col) => (
                  <td key={col.id} className="h-9 min-w-[150px] max-w-[320px] border-b border-r border-line px-2 align-middle last:border-r-0">
                    <Cell col={col} value={row.cells[col.id] ?? null} onChange={(v) => setCell(row, col, v)} />
                  </td>
                ))}
                <td className="border-b border-line" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={() => run(addDbRow(looperId))} className="w-full px-6 py-2.5 text-left text-[0.875rem] text-faint hover:bg-ink/[0.02] hover:text-ink">
        + New {db.rowNoun}
      </button>

      {peekRow && (
        <RowPeek
          db={db}
          row={peekRow}
          onClose={() => setPeek(null)}
          onChange={(col, v) => setCell(peekRow, col, v)}
          onDelete={() => {
            setPeek(null);
            run(deleteDbRow(looperId, peekRow.id));
          }}
        />
      )}
    </div>
  );
}

function InlineText({ value, onCommit, className }: { value: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  // Take the new value when it changes from outside (e.g. a looper edited it).
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cx("w-full min-w-0 bg-transparent outline-none", className)}
    />
  );
}

function typeIcon(t: DbColumnType) {
  return DB_COLUMN_TYPES.find((x) => x.id === t)?.icon ?? "Aa";
}

function ColumnHeader({ col, sort, onSort, onRename, onDelete }: { col: DbColumn; sort: 0 | 1 | -1; onSort: (d: 0 | 1 | -1) => void; onRename: (n: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <th ref={ref} className="relative min-w-[150px] border-b border-r border-line font-normal">
      <button onClick={() => setOpen((o) => !o)} className="flex h-9 w-full items-center gap-1.5 px-2 hover:bg-ink/[0.03]">
        <span className="w-4 shrink-0 text-center text-[0.75rem] text-faint">{typeIcon(col.type)}</span>
        <span className="truncate">{col.name}</span>
        {sort !== 0 && <span className="text-blue">{sort === 1 ? "↑" : "↓"}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-9 z-30 w-56 rounded-[10px] border border-ink/[0.08] bg-panel p-1 text-[0.875rem] text-ink shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
          <div className="p-1">
            <InlineText value={col.name} onCommit={onRename} className="rounded-[6px] bg-ink/[0.04] px-2 py-1.5" />
          </div>
          {[
            ["Sort ascending", () => onSort(1)],
            ["Sort descending", () => onSort(-1)],
            ...(sort !== 0 ? [["Clear sort", () => onSort(0)] as const] : []),
          ].map(([label, fn]) => (
            <button key={label as string} onClick={() => { (fn as () => void)(); setOpen(false); }} className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-ink/[0.04]">
              {label as string}
            </button>
          ))}
          <button onClick={() => { setOpen(false); onDelete(); }} className="block w-full rounded-[6px] px-2 py-1.5 text-left text-red hover:bg-red/8">
            Delete column
          </button>
        </div>
      )}
    </th>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string, type: DbColumnType, options: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<DbColumnType>("text");
  const [options, setOptions] = useState("");
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[1rem] text-faint hover:bg-ink/[0.05] hover:text-ink" aria-label="Add column">
        +
      </button>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAdd(name, type, options.split(",").map((o) => o.trim()).filter(Boolean));
            setOpen(false);
            setName("");
            setOptions("");
          }}
          className="absolute right-0 top-8 z-30 flex w-64 flex-col gap-2 rounded-[10px] border border-ink/[0.08] bg-panel p-3 text-ink shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Column name" className="rounded-[6px] bg-ink/[0.04] px-2 py-1.5 outline-none" />
          <div className="grid grid-cols-2 gap-1">
            {DB_COLUMN_TYPES.map((t) => (
              <button type="button" key={t.id} onClick={() => setType(t.id)} className={cx("flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[0.8125rem]", type === t.id ? "bg-blue/10 text-blue" : "hover:bg-ink/[0.04]")}>
                <span className="w-4 text-center text-faint">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
          {type === "select" && <input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Options, comma-separated" className="rounded-[6px] bg-ink/[0.04] px-2 py-1.5 text-[0.8125rem] outline-none" />}
          <Button size="sm" type="submit" disabled={!name.trim()}>
            Add column
          </Button>
        </form>
      )}
    </div>
  );
}

function Cell({ col, value, onChange }: { col: DbColumn; value: DbValue; onChange: (v: DbValue) => void }) {
  const [editing, setEditing] = useState(false);

  if (col.type === "checkbox")
    return (
      <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 cursor-pointer accent-blue" />
    );

  if (col.type === "select") return <SelectCell col={col} value={value == null ? null : String(value)} onChange={onChange} />;

  if (editing) {
    const inputType = col.type === "date" ? "date" : col.type === "number" || col.type === "currency" ? "number" : "text";
    return (
      <input
        autoFocus
        type={inputType}
        step="any"
        defaultValue={value == null ? "" : String(value)}
        onBlur={(e) => {
          setEditing(false);
          if (e.target.value !== (value == null ? "" : String(value))) onChange(e.target.value === "" ? null : e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-full rounded-[4px] bg-panel px-1 outline-none ring-2 ring-blue/40"
      />
    );
  }

  const text = display(col, value);
  return (
    <div onClick={() => setEditing(true)} className={cx("min-h-7 cursor-text truncate py-1", (col.type === "number" || col.type === "currency") && "text-right tabular-nums")}>
      {col.type === "url" && text ? (
        <a href={text} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-ink-2 underline decoration-black/20 underline-offset-2 hover:decoration-black/60">
          {text.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      ) : (
        text || <span className="text-transparent">·</span>
      )}
    </div>
  );
}

function SelectCell({ col, value, onChange }: { col: DbColumn; value: string | null; onChange: (v: DbValue) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const options = (col.options ?? []).filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(true)} className="min-h-7 cursor-pointer py-1">
        {value ? <Tag col={col} value={value} /> : <span className="text-transparent">·</span>}
      </div>
      {open && (
        <div className="absolute left-0 top-0 z-30 w-56 rounded-[10px] border border-ink/[0.08] bg-panel p-1 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && q.trim()) pick(options[0] ?? q.trim());
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search or create"
            className="mb-1 w-full rounded-[6px] bg-ink/[0.04] px-2 py-1.5 text-[0.8125rem] outline-none"
          />
          {options.map((o) => (
            <button key={o} onClick={() => pick(o)} className="flex w-full items-center rounded-[6px] px-2 py-1 hover:bg-ink/[0.04]">
              <Tag col={col} value={o} />
            </button>
          ))}
          {q.trim() && !col.options?.some((o) => o.toLowerCase() === q.trim().toLowerCase()) && (
            <button onClick={() => pick(q.trim())} className="w-full rounded-[6px] px-2 py-1.5 text-left text-[0.8125rem] hover:bg-ink/[0.04]">
              Create <b>{q.trim()}</b>
            </button>
          )}
          {value && (
            <button onClick={() => pick(null)} className="w-full rounded-[6px] px-2 py-1.5 text-left text-[0.8125rem] text-mute hover:bg-ink/[0.04]">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Notion-style side peek: every property of one row. */
function RowPeek({ db, row, onClose, onChange, onDelete }: { db: LooperDatabase; row: DbRow; onClose: () => void; onChange: (col: DbColumn, v: DbValue) => void; onDelete: () => void }) {
  const titleCol = db.columns.find((c) => c.type === "text");
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <aside className="flex h-full w-full max-w-[560px] flex-col overflow-y-auto bg-panel shadow-[-20px_0_60px_rgba(0,0,0,0.12)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-3 text-[0.8125rem] text-mute">
          <button onClick={onClose} className="rounded-[6px] px-2 py-1 hover:bg-ink/[0.05]">
            ⇥ Close
          </button>
          <button onClick={() => confirm("Delete this row?") && onDelete()} className="rounded-[6px] px-2 py-1 text-red hover:bg-red/8">
            Delete
          </button>
        </div>
        <div className="px-10 pb-10">
          <div className="text-[2rem] font-bold leading-tight tracking-[-0.02em]">
            {titleCol ? (
              <InlineText value={String(row.cells[titleCol.id] ?? "")} onCommit={(v) => onChange(titleCol, v)} className="placeholder:text-faint" />
            ) : (
              "Untitled"
            )}
          </div>
          <div className="mt-6 flex flex-col">
            {db.columns
              .filter((c) => c !== titleCol)
              .map((col) => (
                <div key={col.id} className="grid grid-cols-[160px_minmax(0,1fr)] items-center gap-2 rounded-[6px] py-0.5 hover:bg-ink/[0.02]">
                  <div className="flex items-center gap-2 px-1 text-[0.875rem] text-mute">
                    <span className="w-4 text-center text-[0.75rem] text-faint">{typeIcon(col.type)}</span>
                    <span className="truncate">{col.name}</span>
                  </div>
                  <div className="px-1 text-[0.875rem]">
                    <Cell col={col} value={row.cells[col.id] ?? null} onChange={(v) => onChange(col, v)} />
                  </div>
                </div>
              ))}
          </div>
          <div className="mt-8 border-t border-line pt-4 text-[0.75rem] text-faint">
            Added by {row.createdBy === "looper" ? "the looper" : "you"} · {new Date(row.createdAt).toLocaleString()} · updated {new Date(row.updatedAt).toLocaleString()}
          </div>
        </div>
      </aside>
    </div>
  );
}
