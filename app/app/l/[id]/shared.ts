/** Format a metric value with its unit: 3.1x, €42, 9.4 h, 1,240. */
export function fmt(v: number, unit: string) {
  const n = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 100) / 100);
  if (!unit) return n;
  if (unit === "x" || unit === "%") return n + unit;
  if (/^[$€£¥]$/.test(unit)) return unit + n;
  return `${n} ${unit}`;
}

export function signed(v: number, unit: string) {
  return (v > 0 ? "+" : v < 0 ? "−" : "±") + fmt(Math.abs(v), unit);
}

export const when = (d: Date | string, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
