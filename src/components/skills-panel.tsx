"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteLooper, deleteSkill, runLooperSkill, saveSkill, updateLooper } from "@/app/actions";
import { describeSchedule } from "@/lib/schedule";
import type { Looper, PublicSettings, Run, ScheduleType, Skill } from "@/lib/types";
import { Button, Field, Input, Panel, Pill, Select, Textarea, cx, timeAgo } from "./ui";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

export function SkillsPanel({ looper, runs, integrations }: { looper: Looper; runs: Run[]; integrations: PublicSettings["integrations"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const [busy, start] = useTransition();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ skillId: string; status: string; summary: string } | null>(null);

  const runNow = (s: Skill) => {
    setRunningId(s.id);
    setLastResult(null);
    start(async () => {
      const run = await runLooperSkill(looper.id, s.id);
      setLastResult({ skillId: s.id, status: run.status, summary: run.summary });
      setRunningId(null);
      router.refresh();
    });
  };

  const allowAll = looper.integrationIds === "all";
  const allowed = (id: string) => allowAll || (looper.integrationIds as string[]).includes(id);
  const toggleIntegration = (id: string) => {
    const current = allowAll ? integrations.map((i) => i.id) : (looper.integrationIds as string[]);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    start(async () => { await updateLooper(looper.id, { integrationIds: next }); router.refresh(); });
  };

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Skills · {looper.skills.length}</div>
          <Button size="sm" onClick={() => setEditing({ name: "", instructions: "", kind: "work", schedule: { type: "daily", time: "09:00", days: [1] } })}>
            Add skill
          </Button>
        </div>
        {looper.skills.map((s) => {
          const last = runs.filter((r) => r.skillId === s.id).at(-1);
          return (
            <Panel key={s.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[1.0625rem] font-medium tracking-[-0.01em]">{s.name}</span>
                    {s.kind === "retro" && <Pill tone="lavender">Retro</Pill>}
                  </div>
                  <div className="mt-0.5 text-[0.8125rem] text-mute">
                    {describeSchedule(s.schedule)} · last run {timeAgo(s.lastRunAt)}
                    {last && last.status !== "running" && <span className={last.status === "error" ? " text-orange" : ""}> ({last.status})</span>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                  <Button size="sm" disabled={busy} onClick={() => runNow(s)}>
                    {runningId === s.id ? "Running…" : "Run now"}
                  </Button>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink-2">{s.instructions}</p>
              {lastResult?.skillId === s.id && (
                <div className={cx("mt-4 whitespace-pre-wrap rounded-[12px] p-3 text-[0.8125rem] leading-relaxed", lastResult.status === "error" ? "bg-orange/10 text-orange" : "bg-green/15 text-green-deep")}>
                  {lastResult.summary}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <div className="flex flex-col gap-4">
        <Panel className="p-5">
          <div className="eyebrow">Tools</div>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-mute">
            {looper.name} always has its kanban board and metric log. External apps come from integration hubs; each hub exposes hundreds to thousands of apps, which the looper finds by search at run time.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {integrations.length === 0 && (
              <Link href="/settings" className="rounded-[12px] border border-dashed border-line p-3 text-[0.8125rem] text-mute hover:border-ink/30 hover:text-ink">
                No integration hubs yet. Connect Composio, Zapier or Pipedream →
              </Link>
            )}
            {integrations.map((i) => (
              <label key={i.id} className="flex cursor-pointer items-center justify-between gap-3 rounded-[12px] bg-well px-3 py-2.5">
                <span className="text-[0.875rem]">
                  {i.name}
                  {!i.enabled && <span className="ml-2 text-[0.75rem] text-faint">disabled globally</span>}
                </span>
                <input type="checkbox" checked={allowed(i.id)} onChange={() => toggleIntegration(i.id)} className="h-4 w-4 accent-ink" />
              </label>
            ))}
            {!allowAll && integrations.length > 0 && (
              <button className="text-left text-[0.75rem] text-mute underline underline-offset-2" onClick={() => start(async () => { await updateLooper(looper.id, { integrationIds: "all" }); router.refresh(); })}>
                Allow all hubs, including future ones
              </button>
            )}
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="eyebrow">Danger zone</div>
          <p className="mt-2 text-[0.8125rem] text-mute">Retiring removes this looper with its board, calendar and retros.</p>
          <Button
            variant="danger"
            size="sm"
            className="mt-3 !px-0"
            onClick={() => {
              if (!confirm(`Retire ${looper.name}? This can't be undone.`)) return;
              start(async () => { await deleteLooper(looper.id); router.push("/loopers"); });
            }}
          >
            Retire {looper.name}
          </Button>
        </Panel>
      </div>

      {editing && <SkillEditor looperId={looper.id} skill={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SkillEditor({ looperId, skill, onClose }: { looperId: string; skill: Partial<Skill>; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(skill.name ?? "");
  const [instructions, setInstructions] = useState(skill.instructions ?? "");
  const [kind, setKind] = useState<Skill["kind"]>(skill.kind ?? "work");
  const [type, setType] = useState<ScheduleType>(skill.schedule?.type ?? "daily");
  const [time, setTime] = useState(skill.schedule?.time ?? "09:00");
  const [days, setDays] = useState<number[]>(skill.schedule?.days ?? [1]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <form
        className="grid w-full max-w-lg gap-4 tile p-6"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            await saveSkill(looperId, { id: skill.id, name, instructions, kind, schedule: { type, time, days }, lastRunAt: skill.lastRunAt });
            onClose();
            router.refresh();
          });
        }}
      >
        <div className="text-[1.375rem] font-medium tracking-[-0.02em]">{skill.id ? "Edit skill" : "New skill"}</div>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Draft & schedule today's post" />
        </Field>
        <Field label="Instructions" hint="What to do each run. Name the apps to use, e.g. “pull last 7 days from Google Analytics, then post to Slack #growth”.">
          <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={5} required />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as Skill["kind"])}>
              <option value="work">Work</option>
              <option value="retro">Retro</option>
            </Select>
          </Field>
          <Field label="Runs">
            <Select value={type} onChange={(e) => setType(e.target.value as ScheduleType)}>
              <option value="manual">On demand</option>
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </Select>
          </Field>
          <Field label="At">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={type === "manual"} />
          </Field>
        </div>
        {type === "weekly" && (
          <div className="flex gap-1.5">
            {WEEK.map((d, i) => (
              <button
                type="button"
                key={i}
                onClick={() => setDays((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort()))}
                className={cx("h-9 w-9 rounded-full text-[0.8125rem]", days.includes(i) ? "bg-blue text-white" : "bg-[#ebebf0]")}
              >
                {d}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-between gap-2 pt-2">
          {skill.id ? (
            <Button type="button" variant="danger" size="sm" onClick={() => start(async () => { await deleteSkill(looperId, skill.id!); onClose(); router.refresh(); })}>
              Delete skill
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>Save</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
