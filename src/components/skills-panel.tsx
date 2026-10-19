"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteLooper, deleteSkill, runLooperSkill, saveSkill, updateLooper } from "@/app/actions";
import { describeSchedule } from "@/lib/schedule";
import type { Looper, PublicSettings, Run, ScheduleType, Skill } from "@/lib/types";
import { refreshActivity } from "./live";
import { Button, Field, Input, Panel, Pill, Select, Textarea, cx, timeAgo } from "./ui";

const WEEK = ["S", "M", "T", "W", "T", "F", "S"];

export function SkillsPanel({ looper, runs }: { looper: Looper; runs: Run[]; integrations?: PublicSettings["integrations"] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<Skill> | null>(null);
  const [, start] = useTransition();
  // Runs start in the background: the button flips at once, the chat and Working tray follow it.
  const [startedId, setStartedId] = useState<string | null>(null);
  const runningSkill = new Set(runs.filter((r) => r.status === "running").map((r) => r.skillId));

  const runNow = (s: Skill) => {
    setStartedId(s.id);
    start(async () => {
      await runLooperSkill(looper.id, s.id);
      refreshActivity();
      router.refresh();
      setTimeout(() => setStartedId(null), 8000);
    });
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex flex-col gap-3">
        <CoreInstructions looper={looper} />
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
                  <Button size="sm" disabled={runningSkill.has(s.id) || startedId === s.id} onClick={() => runNow(s)}>
                    {runningSkill.has(s.id) || startedId === s.id ? "Running…" : "Run now"}
                  </Button>
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-ink-2">{s.instructions}</p>
              {(runningSkill.has(s.id) || startedId === s.id) && (
                <a href={`/loopers/${looper.id}?tab=chat`} className="mt-3 inline-block text-[0.8125rem] text-mute hover:text-ink">
                  Follow it in chat →
                </a>
              )}
            </Panel>
          );
        })}
      </div>

      <div className="flex justify-center pt-2">
        <button
          className="text-[0.8125rem] text-red hover:underline"
          onClick={() => {
            if (!confirm(`Retire ${looper.name}? This removes its board, database, calendar and retros and can't be undone.`)) return;
            start(async () => {
              await deleteLooper(looper.id);
              router.push("/");
            });
          }}
        >
          Retire {looper.name}
        </button>
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
                className={cx("h-9 w-9 rounded-full text-[0.8125rem]", days.includes(i) ? "bg-blue text-page" : "bg-ink/[0.07]")}
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

/** The looper's standing brief: what it's for, its sources and its rules. Every skill run starts from it. */
function CoreInstructions({ looper }: { looper: Looper }) {
  const router = useRouter();
  const [text, setText] = useState(looper.mission);
  const [saved, setSaved] = useState(looper.mission);
  const [pending, start] = useTransition();
  if (looper.mission !== saved && text === saved) {
    setSaved(looper.mission);
    setText(looper.mission);
  }
  const dirty = text.trim() !== saved.trim();
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[1.0625rem] font-semibold">Core instructions</div>
          <div className="text-[0.8125rem] text-mute">What {looper.name} is for, where its data lives and what it must never do. Every skill starts from this.</div>
        </div>
        {dirty && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await updateLooper(looper.id, { mission: text.trim() });
                setSaved(text.trim());
                router.refresh();
              })
            }
          >
            Save
          </Button>
        )}
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(14, Math.max(5, Math.ceil(text.length / 90)))} className="mt-3 break-all text-[0.875rem]" />
    </Panel>
  );
}
