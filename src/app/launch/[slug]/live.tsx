"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fmt } from "@/components/ui";

/** Re-reads the scoreboard every minute while the tab is visible. */
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 60_000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}

const H = 240;
const PAD = { l: 44, r: 12, t: 16, b: 28 };
const pt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", ...opts });

/** Upvotes over time, with a crosshair that reads the nearest reading. */
export function VotesChart({ points }: { points: { at: string; votes: number; rank?: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the container's own width so axis labels stay 11px on a phone.
  const box = useRef<HTMLDivElement>(null);
  const drawn = points.length > 1;
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawn]);
  if (!drawn) return <p className="py-10 text-center text-[0.875rem] text-mute">The curve starts after the second reading.</p>;
  const t0 = Date.parse(points[0].at);
  const t1 = Date.parse(points.at(-1)!.at);
  const rawMax = Math.max(...points.map((p) => p.votes), 10) * 1.1;
  const rough = rawMax / 3;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rough) ?? 10 * mag;
  const max = step * 3;
  const x = (iso: string) => PAD.l + ((Date.parse(iso) - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const line = points.map((p) => `${x(p.at).toFixed(1)},${y(p.votes).toFixed(1)}`).join(" ");
  const hours = Math.max(1, Math.ceil((t1 - t0) / 3_600_000 / (W < 480 ? 4 : 6)));
  const ticks: string[] = [];
  for (let t = Math.ceil(t0 / 3_600_000) * 3_600_000; t <= t1; t += hours * 3_600_000) ticks.push(new Date(t).toISOString());
  const h = hover === null ? undefined : points[hover];

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => Math.abs(x(p.at) - sx) < Math.abs(x(points[best].at) - sx) && (best = i));
    setHover(best);
  };

  return (
    <div ref={box} className="relative mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-none" role="img" aria-label={`Upvotes over time, ${fmt(points.at(-1)!.votes)} now`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {[0, 1, 2, 3].map((i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(step * i)} y2={y(step * i)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(step * i) + 4} textAnchor="end" fontSize={11} fill="var(--color-faint)" className="tabular-nums">
              {fmt(step * i)}
            </text>
          </g>
        ))}
        {ticks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-faint)">
            {pt(t, { hour: "numeric" })}
          </text>
        ))}
        <polyline points={line} fill="none" stroke="var(--color-ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <g>
            <line x1={x(h.at)} x2={x(h.at)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-faint)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={x(h.at)} cy={y(h.votes)} r={5} fill="var(--color-ink)" stroke="var(--color-panel)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 rounded-[10px] bg-panel px-3 py-2 text-[0.8125rem] shadow-[var(--tile-shadow-hover)]"
          style={{ left: `${(x(h.at) / W) * 100}%`, transform: `translateX(${x(h.at) > W / 2 ? "-110%" : "10%"})` }}
        >
          <div className="text-mute">{pt(h.at, { hour: "numeric", minute: "2-digit" })} PT</div>
          <div className="font-semibold tabular-nums">{fmt(h.votes)} upvotes</div>
          {h.rank && <div className="tabular-nums text-mute">#{h.rank} today</div>}
        </div>
      )}
    </div>
  );
}
