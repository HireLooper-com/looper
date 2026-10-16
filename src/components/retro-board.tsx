"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { holdRetro } from "@/app/actions";
import type { Looper, Retro } from "@/lib/types";
import { Button, Panel, cx, fmt } from "./ui";

const LANES = [
  { key: "wentWell", label: "Went well", dot: "bg-green", note: "border-l-[3px] border-green" },
  { key: "didntGoWell", label: "Didn't go well", dot: "bg-orange", note: "border-l-[3px] border-orange" },
  { key: "tryNext", label: "Try next", dot: "bg-lavender", note: "border-l-[3px] border-lavender" },
] as const;

export function RetroBoard({ looper, retros }: { looper: Looper; retros: Retro[]; running?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(retros.length - 1);
  const retro = retros[Math.min(index, retros.length - 1)];

  const hold = () =>
    start(async () => {
      setError(null);
      const run = await holdRetro(looper.id);
      if (run.status === "error") setError(run.summary);
      setIndex(Number.MAX_SAFE_INTEGER);
      router.refresh();
    });

  const holdButton = (
    <Button onClick={hold} disabled={pending}>
      {pending ? `${looper.name} is reflecting…` : "Hold a retro now"}
    </Button>
  );

  if (!retro)
    return (
      <Panel className="flex flex-col items-center gap-4 px-6 py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-lavender/15 text-[1.75rem] text-lavender">↺</span>
        <div className="text-[1.25rem] font-medium tracking-[-0.02em]">No retros yet</div>
        <p className="max-w-[48ch] text-[0.875rem] text-mute">
          {looper.name} reviews its own runs, cards and metric movement, scores its effectiveness from 1 to 5, and turns lessons into new cards. It runs on the retro skill&apos;s schedule, or now.
        </p>
        {holdButton}
        {error && <p className="text-[0.8125rem] text-orange">{error}</p>}
      </Panel>
    );

  const delta = retro.metricStart !== undefined && retro.metricEnd !== undefined ? retro.metricEnd - retro.metricStart : undefined;
  const good = delta !== undefined && (looper.metric.direction === "up" ? delta > 0 : delta < 0);
  const pos = retros.indexOf(retro);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
        <div className="tile p-5">
          <div className="eyebrow">Self-rated effectiveness</div>
          <div className="mt-2 flex items-end gap-3">
            <span className="text-[2.75rem] font-medium leading-none tracking-[-0.04em]">{retro.effectiveness}<span className="text-faint">/5</span></span>
            <div className="mb-1.5 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className={cx("h-2 w-5 rounded-full", n <= retro.effectiveness ? "bg-green" : "bg-ink/[0.09]")} />
              ))}
            </div>
          </div>
        </div>
        <div className="tile p-5">
          <div className="eyebrow">{looper.metric.name}</div>
          <div className="mt-2 text-[1.75rem] font-medium tabular-nums tracking-[-0.03em]">
            {fmt(retro.metricStart)} → {fmt(retro.metricEnd)}
          </div>
          {delta !== undefined && (
            <div className={cx("text-[0.8125rem]", good ? "text-green-deep" : "text-orange")}>
              {delta > 0 ? "+" : ""}{fmt(delta)} {looper.metric.unit}
            </div>
          )}
        </div>
        <div className="tile p-5">
          <div className="eyebrow">Period</div>
          <div className="mt-2 text-[1.125rem] font-medium tracking-[-0.02em]">
            {new Date(retro.periodStart).toLocaleDateString([], { month: "short", day: "numeric" })} – {new Date(retro.periodEnd).toLocaleDateString([], { month: "short", day: "numeric" })}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <Button size="sm" variant="ghost" disabled={pos <= 0} onClick={() => setIndex(pos - 1)}>← Older</Button>
            <span className="text-[0.75rem] text-faint">{pos + 1} of {retros.length}</span>
            <Button size="sm" variant="ghost" disabled={pos >= retros.length - 1} onClick={() => setIndex(pos + 1)}>Newer →</Button>
          </div>
        </div>
        <div className="flex flex-col items-start justify-center gap-2">
          {holdButton}
          {error && <p className="max-w-60 text-[0.75rem] text-orange">{error}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {LANES.map((lane) => (
          <div key={lane.key} className="rounded-[20px] bg-ink/[0.07] p-2">
            <div className="flex items-center gap-2 px-2 py-2 text-[0.8125rem] font-medium">
              <span className={cx("h-2 w-2 rounded-full", lane.dot)} />
              {lane.label}
              <span className="text-faint">{retro[lane.key].length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {retro[lane.key].length === 0 && <div className="px-2 py-3 text-[0.8125rem] text-faint">Nothing noted.</div>}
              {retro[lane.key].map((t, i) => (
                <div key={i} className={cx("rounded-[12px] p-3 text-[0.875rem] leading-snug", lane.note, "bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.05)]")}>
                  {t}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[0.75rem] text-faint">&ldquo;Try next&rdquo; items are added to the kanban board as to-do cards.</p>
    </div>
  );
}
