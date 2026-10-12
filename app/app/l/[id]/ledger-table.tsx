"use client";

import { useMemo, useState } from "react";
import type { Column } from "@/lib/roles";

// One signal's ledger as a table: columns come from the role spec, a header click sorts, the
// status chips filter. Rows arrive already read; nothing here talks to the server.

export type Row = { id: number; key: string; status: string; data: Record<string, unknown> };

const STATUS: Record<string, string> = { open: "Open", carded: "On a card", done: "Shipped", won: "Worked", lost: "Did not move", dropped: "Dropped" };

/** A field's value; older reads used other names for the page URL, so a URL column falls back to any URL. */
function value(r: Row, c: Column): unknown {
  const v = r.data[c.key];
  if (v !== undefined || c.type !== "url") return v;
  return Object.values(r.data).find((x) => typeof x === "string" && /^https?:\/\//.test(x));
}

function num(v: unknown) {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace("%", "")) : NaN;
  return Number.isFinite(n) ? n : null;
}

function sortValue(r: Row, c: Column | null): number | string {
  if (!c) return r.key.toLowerCase();
  const v = value(r, c);
  if (c.type === "list") return Array.isArray(v) ? v.length : 0;
  if (c.type === "url" || c.type === "text") return typeof v === "string" ? v.toLowerCase() : "";
  const n = num(v);
  if (n === null) return c.type === "pos" ? Infinity : -Infinity;
  return c.type === "pct" && n > 1 ? n / 100 : n;
}

function Cell({ r, c }: { r: Row; c: Column }) {
  const v = value(r, c);
  if (c.type === "list") {
    const xs = Array.isArray(v) ? v.map(String).slice(0, 4) : [];
    return <td className={xs.length ? undefined : "dim2"}>{xs.length ? xs.join(", ") : "none"}</td>;
  }
  if (c.type === "text") return <td title={typeof v === "string" ? v : undefined}>{typeof v === "string" ? v : ""}</td>;
  if (c.type === "url") {
    if (typeof v !== "string" || !v) return <td />;
    let path = v;
    try {
      path = new URL(v).pathname;
    } catch {}
    return (
      <td className="u">
        <a href={v} target="_blank" rel="noreferrer" title={v}>
          {path}
        </a>
      </td>
    );
  }
  const n = num(v);
  if (n === null) return <td className="n" />;
  const text =
    c.type === "pct" ? `${(n > 1 ? n : n * 100).toFixed(1)}%` : c.type === "pos" ? n.toFixed(1) : Math.round(n).toLocaleString("en-US");
  return <td className="n tab">{text}</td>;
}

export default function LedgerTable({ keyLabel, columns, rows }: { keyLabel: string; columns: Column[]; rows: Row[] }) {
  // -1 sorts by the row key; null keeps the ledger order (open first, newest read first).
  const [by, setBy] = useState<number | null>(null);
  const [asc, setAsc] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.status, (m.get(r.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => Object.keys(STATUS).indexOf(a[0]) - Object.keys(STATUS).indexOf(b[0]));
  }, [rows]);

  const shown = useMemo(() => {
    const xs = status ? rows.filter((r) => r.status === status) : rows;
    if (by === null) return xs;
    const c = by < 0 ? null : columns[by];
    return [...xs].sort((a, b) => {
      const x = sortValue(a, c);
      const y = sortValue(b, c);
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return asc ? d : -d;
    });
  }, [rows, status, by, asc, columns]);

  const sort = (i: number) => {
    if (by === i) setAsc(!asc);
    else {
      setBy(i);
      // Position reads best low to high; counts read best high to low.
      setAsc(i < 0 || ["pos", "url", "text"].includes(columns[i].type));
    }
  };
  const aria = (i: number) => (by === i ? (asc ? "ascending" : "descending") : undefined);

  return (
    <>
      {counts.length > 1 && (
        <div className="xlt-f" role="group" aria-label="Filter by status">
          <button type="button" aria-pressed={status === null} onClick={() => setStatus(null)}>
            All <span className="tab">{rows.length}</span>
          </button>
          {counts.map(([s, n]) => (
            <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(status === s ? null : s)}>
              {STATUS[s] ?? s} <span className="tab">{n}</span>
            </button>
          ))}
        </div>
      )}
      <div className="xlt-w">
        <table className="xlt">
          <thead>
            <tr>
              <th aria-sort={aria(-1)}>
                <button type="button" onClick={() => sort(-1)}>
                  {keyLabel}
                </button>
              </th>
              {columns.map((c, i) => (
                <th key={c.key} aria-sort={aria(i)} className={c.type === "list" || c.type === "url" || c.type === "text" ? undefined : "n"}>
                  <button type="button" onClick={() => sort(i)}>
                    {c.label}
                  </button>
                </th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="k">{r.key}</td>
                {columns.map((c) => (
                  <Cell key={c.key} r={r} c={c} />
                ))}
                <td>
                  <span className={r.status === "open" ? "dim2" : "pill"}>{STATUS[r.status] ?? r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
