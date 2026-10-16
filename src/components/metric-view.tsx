"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordMetric } from "@/app/actions";
import type { Looper } from "@/lib/types";
import { Button, Input, fmt } from "./ui";

const W = 760;
const H = 320;
const PAD = { l: 52, r: 16, t: 20, b: 32 };

/** Area chart of the metric with a dashed target line. */
function Chart({ looper }: { looper: Looper }) {
  const pts = looper.metric.history;
  const color = "var(--color-ink)";
  const values = [...pts.map((p) => p.value), looper.metric.target];
  // Round axis ticks to 1/2/2.5/5 × 10^n so labels read like 25,000 rather than 19,167.
  const rawMax = Math.max(...values, 1) * 1.1;
  const min = Math.min(0, ...values);
  const rough = (rawMax - min) / 3;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rough) ?? 10 * mag;
  const max = min + step * 3;
  const x = (i: number) => PAD.l + (pts.length < 2 ? (W - PAD.l - PAD.r) / 2 : (i / (pts.length - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min || 1)) * (H - PAD.t - PAD.b);
  const ticks = [0, 1, 2, 3].map((i) => min + step * i);
  const line = pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = pts.length ? `${x(0)},${y(min)} ${line} ${x(pts.length - 1)},${y(min)}` : "";
  const labelEvery = Math.max(1, Math.ceil(pts.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${looper.metric.name} over time`}>
      <defs>
        <linearGradient id={`fill-${looper.id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.22" />
          <stop offset="1" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" />
          <text x={PAD.l - 10} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-faint)">
            {fmt(Math.round(t))}
          </text>
        </g>
      ))}
      <line x1={PAD.l} x2={W - PAD.r} y1={y(looper.metric.target)} y2={y(looper.metric.target)} stroke="var(--color-faint)" strokeDasharray="5 5" />
      <text x={W - PAD.r} y={y(looper.metric.target) - 7} textAnchor="end" fontSize="12" fill="var(--color-mute)">
        target {fmt(looper.metric.target)}
      </text>
      {pts.length > 0 && (
        <>
          <polygon points={area} fill={`url(#fill-${looper.id})`} />
          <polyline points={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].value)} r="5" fill={color} stroke="var(--color-panel)" strokeWidth="2" />
          {pts.map((p, i) =>
            i % labelEvery === 0 || i === pts.length - 1 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="12" fill="var(--color-faint)">
                {new Date(p.at).toLocaleDateString([], { month: "short", day: "numeric" })}
              </text>
            ) : null,
          )}
        </>
      )}
      {pts.length === 0 && (
        <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="14" fill="var(--color-faint)">
          No readings yet. The looper logs one when it measures the metric, or log one yourself.
        </text>
      )}
    </svg>
  );
}

function routinesPerWeek(looper: Looper) {
  return looper.skills.reduce((n, s) => n + (s.schedule.type === "hourly" ? 168 : s.schedule.type === "daily" ? 7 : s.schedule.type === "weekly" ? s.schedule.days.length : 0), 0);
}

export function MetricView({ looper }: { looper: Looper }) {
  const router = useRouter();
  const [reading, setReading] = useState("");
  const [busy, start] = useTransition();
  const last = looper.metric.history.at(-1);
  const first = looper.metric.history[0];
  const delta = last && first && looper.metric.history.length > 1 ? last.value - first.value : undefined;
  const good = delta !== undefined && (looper.metric.direction === "up" ? delta > 0 : delta < 0);

  const rows: [string, React.ReactNode][] = [
    [
      "Source",
      (looper.apps ?? []).length ? (
        <span className="flex flex-wrap justify-end gap-1.5">
          {looper.apps!.map((a) => (
            <span key={a.slug} className="inline-flex items-center gap-1 rounded-[6px] bg-ink/[0.05] px-1.5 py-0.5 text-[0.75rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.logo && <img src={a.logo} alt="" className="h-3.5 w-3.5 rounded-[3px]" />}
              {a.name}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-faint">No apps yet</span>
      ),
    ],
    ["Owner", looper.name],
    ["Direction", looper.metric.direction === "up" ? "Higher is better" : "Lower is better"],
    ["Routines", `${routinesPerWeek(looper)} a week`],
    ["Last reading", last ? `${new Date(last.at).toLocaleDateString([], { month: "short", day: "numeric" })}${last.note ? ` · ${last.note}` : ""}` : "—"],
  ];

  return (
    <div className="tile grid grid-cols-1 gap-6 p-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex flex-col">
        <div className="text-[0.875rem] text-mute">{looper.metric.name}</div>
        <div className="mt-2 text-[4rem] font-semibold leading-none tracking-[-0.045em] tabular-nums">{fmt(last?.value)}</div>
        <div className="mt-2 text-[0.9375rem] text-mute">
          of {fmt(looper.metric.target)} {looper.metric.unit}
          {delta !== undefined && (
            <span className={good ? "ml-2 text-green-deep" : "ml-2 text-orange"}>
              {delta > 0 ? "+" : ""}
              {fmt(delta)} since start
            </span>
          )}
        </div>
        <div className="mt-6 divide-y divide-line border-t border-line text-[0.875rem]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-2.5">
              <span className="shrink-0 text-mute">{k}</span>
              <span className="min-w-0 truncate text-right">{v}</span>
            </div>
          ))}
        </div>
        <form
          className="mt-auto flex gap-2 pt-6"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(reading);
            if (reading === "" || Number.isNaN(v)) return;
            setReading("");
            start(async () => {
              await recordMetric(looper.id, v);
              router.refresh();
            });
          }}
        >
          <Input value={reading} onChange={(e) => setReading(e.target.value)} type="number" step="any" placeholder="Log a reading" className="!h-9" />
          <Button size="sm" variant="soft" className="!h-9" disabled={busy || reading === ""}>
            Log
          </Button>
        </form>
      </div>
      <div className="min-w-0">
        <Chart looper={looper} />
      </div>
    </div>
  );
}
