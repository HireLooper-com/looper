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

export function CalendarView({ looper, runs }: { looper: Looper; runs: Run[] }) {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Entry | null>(null);
  const now = useNow();

  const { month, cells, byDay } = useMemo(() => {
    const today = new Date(now || 0);
    const month = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const first = new Date(month);
    first.setDate(1 - ((month.getDay() + 6) % 7)); // start grid on Monday
    const cells = Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i));
    const gridEnd = new Date(cells[41].getFullYear(), cells[41].getMonth(), cells[41].getDate() + 1);

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
  }, [offset, runs, looper, now]);

  const todayKey = dayKey(new Date(now || 0));
  if (!now) return <div className="tile h-[640px] animate-pulse" />;

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-[1.25rem] font-semibold tracking-[-0.02em]">{month.toLocaleDateString([], { month: "long", year: "numeric" })}</div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => setOffset((o) => o - 1)} aria-label="Previous month">←</Button>
            <Button size="sm" variant="soft" onClick={() => setOffset(0)}>Today</Button>
            <Button size="sm" variant="ghost" onClick={() => setOffset((o) => o + 1)} aria-label="Next month">→</Button>
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
              const inMonth = d.getMonth() === month.getMonth();
              return (
                <div key={k} className={cx("min-h-28 border-b border-r border-line p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-[#fafafa]")}>
                  <div className={cx("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[0.75rem]", k === todayKey ? "bg-red font-semibold text-white" : inMonth ? "text-ink-2" : "text-faint")}>
                    {d.getDate()}
                  </div>
                  <div className="flex flex-col gap-1">
                    {list.slice(0, 4).map((e) => (
                      <button
                        key={e.key}
                        onClick={() => setSelected(e)}
                        className={cx(
                          "truncate rounded-[6px] px-1.5 py-1 text-left text-[0.6875rem] leading-none",
                          e.kind === "scheduled" && "border border-dashed border-[#c7c7cc] text-mute",
                          e.kind === "success" && "bg-blue/10 text-blue",
                          e.kind === "error" && "bg-orange/15 text-orange",
                          e.kind === "running" && "bg-blue text-white",
                        )}
                      >
                        {hhmm(e.at)} {e.label}
                      </button>
                    ))}
                    {list.length > 4 && <span className="px-1.5 text-[0.6875rem] text-faint">+{list.length - 4} more</span>}
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
              <Legend cls="bg-orange/15" label="Failed" />
              <Legend cls="border border-dashed border-[#c7c7cc]" label="Scheduled" />
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
