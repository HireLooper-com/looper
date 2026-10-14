import type { Schedule, Skill } from "./types";

const HOUR = 3_600_000;

/** All scheduled fire times of a skill in [from, to). */
export function occurrences(schedule: Schedule, from: Date, to: Date): Date[] {
  if (schedule.type === "manual") return [];
  const [h, m] = schedule.time.split(":").map(Number);
  const out: Date[] = [];

  if (schedule.type === "hourly") {
    const d = new Date(from);
    d.setMinutes(m || 0, 0, 0);
    if (d < from) d.setTime(d.getTime() + HOUR);
    for (; d < to; d.setTime(d.getTime() + HOUR)) out.push(new Date(d));
    return out;
  }

  const d = new Date(from);
  d.setHours(h || 0, m || 0, 0, 0);
  if (d < from) d.setDate(d.getDate() + 1);
  for (; d < to; d.setDate(d.getDate() + 1)) {
    if (schedule.type === "weekly" && !schedule.days.includes(d.getDay())) continue;
    out.push(new Date(d));
  }
  return out;
}

/** A skill is due when its latest fire time in the last day hasn't been run yet. */
export function isDue(skill: Skill, now = new Date()): boolean {
  const recent = occurrences(skill.schedule, new Date(now.getTime() - 24 * HOUR), new Date(now.getTime() + 1));
  const latest = recent.at(-1);
  if (!latest) return false;
  return !skill.lastRunAt || new Date(skill.lastRunAt) < latest;
}

export function describeSchedule(s: Schedule): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  switch (s.type) {
    case "manual":
      return "On demand";
    case "hourly":
      return `Hourly at :${s.time.split(":")[1] ?? "00"}`;
    case "daily":
      return `Daily at ${s.time}`;
    case "weekly":
      return `${s.days.map((d) => days[d]).join(", ") || "No days"} at ${s.time}`;
  }
}
