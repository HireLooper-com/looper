import Link from "next/link";
import type { ReactNode } from "react";
import type { WorkspaceRow } from "@/lib/admin";
import { cx } from "./ui";

// Building blocks for /admin. Server-rendered: nothing here reaches the browser but the numbers shown.

export const money = (n: number) => `$${n.toLocaleString("en", { minimumFractionDigits: n !== 0 && Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 })}`;
export const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");
export const hours = (h?: number) => (h === undefined ? "–" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)}h` : `${Math.round(h / 24)}d`);
export const ago = (iso?: string) => {
  if (!iso) return "never";
  const m = (Date.now() - Date.parse(iso)) / 60_000;
  return m < 60 ? `${Math.max(1, Math.round(m))}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
export const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" }) : "–");

export function Section({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mt-12", className)}>
      <h2 className="text-[1.25rem] font-semibold tracking-[-0.01em]">
        {title} {hint && <span className="font-normal text-faint">{hint}</span>}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile p-4">
      <div className="text-[0.8125rem] text-mute">{label}</div>
      <div className="mt-1 text-[1.5rem] font-semibold tracking-[-0.02em] tabular-nums">{value}</div>
      {sub && <div className="text-[0.75rem] text-faint tabular-nums">{sub}</div>}
    </div>
  );
}

/** A dense table that scrolls sideways inside its tile on narrow screens. */
export function Table({ head, rows, empty }: { head: { label: string; right?: boolean }[]; rows: ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="tile px-4 py-4 text-[0.875rem] text-mute">{empty}</p>;
  return (
    <div className="tile overflow-x-auto">
      <table className="w-full min-w-[640px] text-[0.875rem]">
        <thead>
          <tr className="border-b border-line text-left text-[0.75rem] text-mute">
            {head.map((h) => (
              <th key={h.label} className={cx("px-4 py-2.5 font-medium", h.right && "text-right")}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={cx("px-4 py-2.5 align-top", head[j]?.right && "text-right tabular-nums")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkspaceCell({ row }: { row: Pick<WorkspaceRow, "id" | "name" | "owner"> }) {
  return (
    <Link href={`/admin/${row.id}`} className="block min-w-0 hover:underline">
      <div className="truncate font-medium">{row.name}</div>
      <div className="truncate text-[0.75rem] text-mute">{row.owner.email ?? "no email"}</div>
    </Link>
  );
}

export const planLabel = (r: Pick<WorkspaceRow, "plan" | "status" | "comped">) =>
  r.comped ? "Comped" : r.plan ? (r.status === "active" ? r.plan : `${r.plan} · ${r.status?.replace("_", " ")}`) : "No plan";

/** One step of the funnel: how many got here, as a bar against everyone who signed up. */
export function FunnelBar({ label, count, total, prev }: { label: string; count: number; total: number; prev?: number }) {
  const lost = prev !== undefined ? prev - count : 0;
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-[0.875rem] sm:grid-cols-[12rem_minmax(0,1fr)_7rem]">
      <div className="truncate">{label}</div>
      <div className="h-5 rounded-[4px] bg-ink/[0.05]" title={`${label}: ${count} of ${total}${lost > 0 ? `, ${lost} stopped before this step` : ""}`}>
        <div className="h-full rounded-[4px] bg-ink" style={{ width: total ? `${(count / total) * 100}%` : 0 }} />
      </div>
      <div className="text-right tabular-nums">
        {count} <span className="text-faint">{pct(count, total)}</span>
      </div>
    </div>
  );
}
