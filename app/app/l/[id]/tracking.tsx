import type { Looper } from "@/lib/engine";
import { ledger } from "@/lib/memory";
import { role as findRole } from "@/lib/roles";
import { when } from "./shared";
import LedgerTable from "./ledger-table";

// What the looper reads every day besides its metric (signals, the ledger its routines pick from),
// one table per signal. Read only. What it learned at hire lives on the Brief tab.

const TITLE: Record<string, [string, string]> = {
  query: ["Search queries", "Query"],
  ai_answer: ["Buyer questions in AI answers", "Question"],
};

export default async function TrackingTab({ l, tz }: { l: Looper; tz: string }) {
  const signals = findRole(l.role)?.signals ?? [];
  const rows = await Promise.all(signals.map((s) => ledger.list(l.workspace_id, l.id, s.kind, 100)));

  if (!signals.length) return <p className="dim">This looper reads only its metric. Nothing else to track.</p>;

  return (
    <>
      {signals.map((s, i) => {
        const [title, keyLabel] = TITLE[s.kind] ?? [s.kind, "Item"];
        return (
          <section key={s.kind}>
            <h2>
              {title}{" "}
              <span className="c">
                {rows[i].length} tracked
                {l.signals_at?.[s.kind] ? `, read ${when(new Date(l.signals_at[s.kind]), tz)}` : ", read once a day"}
              </span>
            </h2>
            {rows[i].length ? (
              <LedgerTable
                keyLabel={keyLabel}
                columns={s.columns}
                rows={rows[i].map((x) => ({ id: x.id, key: x.key, status: x.status, data: x.data }))}
              />
            ) : (
              <p className="dim">{s.read}</p>
            )}
          </section>
        );
      })}
    </>
  );
}
