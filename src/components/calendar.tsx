"use client";

import { useNow } from "./use-now";
import { useMemo, useState } from "react";
import { occurrences } from "@/lib/schedule";
import type { Looper, Run } from "@/lib/types";
import { Button, Panel, Pill, cx } from "./ui";

type Entry = { key: string; at: Date; label: string; kind: "success" | "error" | "running" | "scheduled"; run?: Run };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** Monday of the week that holds `d`. */
const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));

/** ISO week number, as people say "week 43". */
function weekNumber(d: Date) {
  // The Thursday of d's week decides the year; week 1 holds 4 January.
  const thu = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3));
  const jan4 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((thu.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
}

export function CalendarView({ looper, runs }: { looper: Looper; runs: Run[] }) {
  // A week shows each day's skills in full; the month is one click away.
  const [mode, setMode] = useState<"week" | "month">("week");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Entry | null>(null);
  const now = useNow();

  const { month, cells, byDay } = useMemo(() => {
    const today = new Date(now || 0);
    const month = new Date(today.getFullYear(), today.getMonth() + (mode === "month" ? offset : 0), 1);
    const first = mode === "week" ? mondayOf(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset * 7)) : mondayOf(month);
    const cells = Array.from({ length: mode === "week" ? 7 : 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
    const last = cells[cells.length - 1];
    const gridEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);

    const entries: Entry[] = runs.map((r) => ({ key: r.id, at: new Date(r.startedAt), label: r.skillName, kind: r.status, run: r }));
    if (now && looper.status === "active") {
      const from = new Date(Math.max(now, first.getTime()));
      for (const s of looper.skills)
        for (const at of occurrences(s.schedule, from, gridEnd).slice(0, 400))
          entries.push({ key: `${s.id}-${at.getTime()}`, at, label: s.name, kind: "scheduled" });
    }
    const byDay = new Map<string, Entry[]>();
    for (const e of entries.sort((a, b) => a.at.getTime() - b.at.getTime())) {
      const k = dayKey(e.at);
      byDay.set(k, [...(byDay.get(k) ?? []), e]);
    }
    return { month, cells, byDay };
  }, [mode, offset, runs, looper, now]);

  const todayKey = dayKey(new Date(now || 0));
  if (!now) return <div className="tile h-[640px] animate-pulse" />;

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-[1.25rem] font-semibold tracking-[-0.02em]">
            {mode === "week" ? (
              <>
                Week {weekNumber(cells[0])}
                <span className="ml-2 text-[0.9375rem] font-normal text-mute">
                  {cells[0].toLocaleDateString([], { month: "short", day: "numeric" })} – {cells[6].toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
              </>
            ) : (
              month.toLocaleDateString([], { month: "long", year: "numeric" })
            )}
          </div>
          <div className="flex items-center gap-1">
            <div className="mr-2 inline-flex rounded-[10px] bg-ink/[0.06] p-0.5 text-[0.8125rem]">
              {(["week", "month"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setOffset(0);
                  }}
                  className={cx("rounded-[8px] px-3 py-1 capitalize", mode === m ? "bg-panel font-medium shadow-sm" : "text-mute")}
                >
                  {m}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setOffset((o) => o - 1)} aria-label={`Previous ${mode}`}>←</Button>
            <Button size="sm" variant="soft" onClick={() => setOffset(0)}>Today</Button>
            <Button size="sm" variant="ghost" onClick={() => setOffset((o) => o + 1)} aria-label={`Next ${mode}`}>→</Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[680px] grid-cols-7">
            {DAYS.map((d) => (
              <div key={d} className="eyebrow border-b border-line px-2 py-2">{d}</div>
            ))}
            {cells.map((d) => {
              const k = dayKey(d);
              const list = byDay.get(k) ?? [];
              const inMonth = mode === "week" || d.getMonth() === month.getMonth();
              const shown = mode === "week" ? list : list.slice(0, 4);
              return (
                <div key={k} className={cx("border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0", mode === "week" ? "min-h-[320px]" : "min-h-28", !inMonth && "bg-ink/[0.02]")}>
                  <div className={cx("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[0.75rem]", k === todayKey ? "bg-ink font-semibold text-page" : inMonth ? "text-ink-2" : "text-faint")}>
                    {d.getDate()}
                  </div>
                  <div className="flex flex-col gap-1">
                    {shown.map((e) => (
                      <button
                        key={e.key}
                        onClick={() => setSelected(e)}
                        className={cx(
                          "rounded-[6px] px-1.5 py-1 text-left",
                          mode === "week" ? "text-[0.75rem] leading-snug" : "truncate text-[0.6875rem] leading-none",
                          e.kind === "scheduled" && "border border-dashed border-ink/[0.22] text-mute",
                          e.kind === "success" && "bg-blue/10 text-blue",
                          e.kind === "error" && "bg-red/10 text-red",
                          e.kind === "running" && "bg-blue text-page",
                        )}
                      >
                        {hhmm(e.at)} {e.label}
                      </button>
                    ))}
                    {mode === "month" && list.length > 4 && <span className="px-1.5 text-[0.6875rem] text-faint">+{list.length - 4} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel className="h-fit p-5">
        {selected ? (
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="eyebrow">{selected.at.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
              <Pill tone={selected.kind === "success" ? "green" : selected.kind === "error" ? "orange" : selected.kind === "running" ? "dark" : "grey"}>{selected.kind}</Pill>
            </div>
            <div className="mt-2 text-[1.25rem] font-medium tracking-[-0.02em]">{selected.label}</div>
            {selected.run ? (
              <>
                <div className="mt-1 text-[0.75rem] text-mute">Triggered {selected.run.trigger === "schedule" ? "by schedule" : selected.run.trigger === "chief" ? "by Chief" : "manually"}</div>
                <p className="mt-4 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink-2">{selected.run.summary || "Working…"}</p>
                {selected.run.toolCalls.length > 0 && (
                  <div className="mt-4">
                    <div className="eyebrow mb-2">Tools used</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selected.run.toolCalls.map((t, i) => (
                        <Pill key={i} tone={t.ok ? "grey" : "orange"}>{t.name}</Pill>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="mt-3 text-[0.875rem] text-mute">Scheduled. {looper.name} will run this skill automatically.</p>
            )}
          </div>
        ) : (
          <div>
            <div className="eyebrow">Skill calendar</div>
            <p className="mt-2 text-[0.875rem] leading-relaxed text-mute">Every skill run lands here. Solid chips are past runs, dashed ones are upcoming. Pick one to read what the looper did.</p>
            <div className="mt-4 flex flex-col gap-2 text-[0.8125rem]">
              <Legend cls="bg-blue/10" label="Succeeded" />
              <Legend cls="bg-red/10" label="Failed" />
              <Legend cls="border border-dashed border-ink/[0.22]" label="Scheduled" />
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cx("h-3 w-6 rounded-[3px]", cls)} />
      {label}
    </div>
  );
}
