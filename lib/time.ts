// Calendar math in the founder's time zone. Days are 0 = Mon ... 6 = Sun.
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type Local = { y: number; m: number; d: number; wd: number; h: number; min: number };

export function local(at: Date, tz: string): Local {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    y: +parts.year,
    m: +parts.month,
    d: +parts.day,
    wd: DAYS.indexOf(parts.weekday),
    h: +parts.hour,
    min: +parts.minute,
  };
}

/** The UTC instant of a wall-clock time in `tz`. */
export function zoned(y: number, m: number, d: number, h: number, tz: string) {
  let guess = Date.UTC(y, m - 1, d, h);
  for (let i = 0; i < 2; i++) {
    const l = local(new Date(guess), tz);
    const seen = Date.UTC(l.y, l.m - 1, l.d, l.h, l.min);
    guess += Date.UTC(y, m - 1, d, h) - seen;
  }
  return new Date(guess);
}

/** Start of the local day `offset` days from `at`. */
export function dayStart(at: Date, tz: string, offset = 0) {
  const l = local(at, tz);
  const base = new Date(Date.UTC(l.y, l.m - 1, l.d + offset));
  return zoned(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), 0, tz);
}

/** Monday 00:00 of the week after `at`: when a reflection diff takes effect. */
export function nextMonday(at: Date, tz: string) {
  const wd = local(at, tz).wd;
  return dayStart(at, tz, 7 - wd);
}

/** Most recent scheduled slot of a routine at or before `now`, within `lookbackH` hours. */
export function dueSlot(days: number[], hour: number, now: Date, tz: string, lookbackH = 3) {
  for (let back = 0; back <= 1; back++) {
    const start = dayStart(now, tz, -back);
    const l = local(start, tz);
    if (!days.includes(l.wd)) continue;
    const slot = zoned(l.y, l.m, l.d, hour, tz);
    const age = now.getTime() - slot.getTime();
    if (age >= 0 && age <= lookbackH * 3600e3) return slot;
  }
  return null;
}

/** Reflection runs every second Friday, counted from the week the looper was hired. */
export function isReflectionFriday(hiredAt: Date, now: Date, tz: string) {
  const l = local(now, tz);
  if (l.wd !== 4) return false;
  const weeks = Math.floor((dayStart(now, tz).getTime() - dayStart(hiredAt, tz, -local(hiredAt, tz).wd).getTime()) / (7 * 864e5));
  return weeks >= 1 && weeks % 2 === 1;
}

export function ymd(at: Date, tz: string) {
  const l = local(at, tz);
  return `${l.y}-${String(l.m).padStart(2, "0")}-${String(l.d).padStart(2, "0")}`;
}

export const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
