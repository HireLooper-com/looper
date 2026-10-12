import { sql } from "./db";
import { sendMail } from "./mail";
import { local, ymd } from "./time";
import { SITE } from "./site";

// Email from the scheduler tick. Two kinds, each with its own switch in Settings:
// - notify: cards to approve, failed runs, failed cards, a metric read that started failing and an open reflection,
//   at most one email every 3 hours
// - weekly: Monday 08:00 local, each metric against its target and the 3 cards that moved it most
// Every member of a workspace gets them, not only the owner.

const GAP_H = 3;

type Who = { id: number; email: string; tz: string; notified_at: Date | null };

const fmtV = (v: number, unit: string) => {
  const n = Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 100) / 100);
  if (!unit) return n;
  if (unit === "x" || unit === "%") return n + unit;
  return /^[$€£¥]$/.test(unit) ? unit + n : `${n} ${unit}`;
};

const end = (s: string) => s.replace(/\.?$/, ".");

/** One digest per member: what needs them since the last email. */
export async function digest(now = new Date()) {
  const people = await sql<Who>`
    select distinct u.id, u.email, u.tz, u.notified_at from users u join members m on m.user_id = u.id
    where u.notify and (u.notified_at is null or u.notified_at < ${new Date(now.getTime() - GAP_H * 3600e3)})`;
  let sent = 0;
  for (const p of people) {
    const since = p.notified_at ?? new Date(now.getTime() - 24 * 3600e3);
    const cards = await sql<{ title: string; looper: string; ws: string; looper_id: number }>`
      select c.title, l.name as looper, w.name as ws, l.id as looper_id from cards c
      join loopers l on l.id = c.looper_id join workspaces w on w.id = l.workspace_id join members m on m.workspace_id = w.id
      where m.user_id = ${p.id} and c.status = 'proposed' and c.created_at > ${since} order by c.created_at desc`;
    const failed = await sql<{ routine: string; looper: string; error: string | null }>`
      select r.name as routine, l.name as looper, x.error from runs x
      join routines r on r.id = x.routine_id join loopers l on l.id = r.looper_id join members m on m.workspace_id = l.workspace_id
      where m.user_id = ${p.id} and l.fired_at is null and x.status = 'failed' and x.started_at > ${since} order by x.started_at desc limit 5`;
    const reflections = await sql<{ looper: string; looper_id: number }>`
      select l.name as looper, l.id as looper_id from reflections f
      join loopers l on l.id = f.looper_id join members m on m.workspace_id = l.workspace_id
      where m.user_id = ${p.id} and f.status = 'open' and f.created_at > ${since}`;
    const stuck = await sql<{ title: string; looper: string; result: string | null; looper_id: number }>`
      select c.title, l.name as looper, c.result, l.id as looper_id from cards c
      join loopers l on l.id = c.looper_id join members m on m.workspace_id = l.workspace_id
      where m.user_id = ${p.id} and l.fired_at is null and c.status = 'failed' and c.updated_at > ${since} order by c.updated_at desc limit 5`;
    const metrics = await sql<{ looper: string; metric_error: string | null; looper_id: number }>`
      select l.name as looper, l.metric_error, l.id as looper_id from loopers l join members m on m.workspace_id = l.workspace_id
      where m.user_id = ${p.id} and l.fired_at is null and l.metric_failed_at > ${since}`;
    if (!cards.length && !failed.length && !reflections.length && !stuck.length && !metrics.length) continue;

    const parts: string[] = [];
    if (cards.length) {
      parts.push(
        `${cards.length} card${cards.length > 1 ? "s" : ""} to approve:`,
        ...cards.slice(0, 5).map((c) => `- ${c.title} (${c.looper}, ${c.ws})`),
        cards.length > 5 ? `- and ${cards.length - 5} more` : "",
      );
    }
    if (reflections.length) parts.push("", ...reflections.map((r) => `Reflection is open with ${r.looper}: ${SITE}/app/l/${r.looper_id}?tab=reflection`));
    if (failed.length) parts.push("", "Failed runs:", ...failed.map((f) => `- ${f.routine} (${f.looper}): ${(f.error ?? "no error text").slice(0, 160)}`));
    if (stuck.length) parts.push("", "Approved cards that failed:", ...stuck.map((c) => `- ${c.title} (${c.looper}): ${end((c.result ?? "no error text").slice(0, 160))} Retry: ${SITE}/app/l/${c.looper_id}?tab=board`));
    if (metrics.length)
      parts.push("", "Metric reads that failed:", ...metrics.map((m) => `- ${m.looper}: ${end((m.metric_error ?? "no error text").slice(0, 160))} Fix: ${SITE}/app/l/${m.looper_id}`));
    const one = cards.length && new Set(cards.map((c) => c.looper_id)).size === 1 ? cards[0].looper_id : null;
    parts.push("", `Open the board: ${SITE}${one ? `/app/l/${one}?tab=board` : "/app/all"}`);

    const subject = cards.length
      ? `${cards.length} card${cards.length > 1 ? "s" : ""} to approve${failed.length ? `, ${failed.length} failed run${failed.length > 1 ? "s" : ""}` : ""}`
      : reflections.length
        ? `Reflection is open with ${reflections[0].looper}`
        : failed.length
          ? `${failed.length} routine run${failed.length > 1 ? "s" : ""} failed`
          : stuck.length
            ? `${stuck.length} approved card${stuck.length > 1 ? "s" : ""} failed`
            : `${metrics[0].looper} could not read its metric`;
    // Claim the send so two overlapping ticks do not both email; give it back if the send fails.
    const claimed = await sql`update users set notified_at = ${now}
      where id = ${p.id} and notified_at is not distinct from ${p.notified_at} returning id`;
    if (!claimed.length) continue;
    try {
      await sendMail(p.email, { subject, heading: subject, body: parts.filter((x, i, a) => x || a[i - 1]).join("\n") });
      sent++;
    } catch (e) {
      await sql`update users set notified_at = ${p.notified_at} where id = ${p.id} and notified_at = ${now}`;
      console.error("[notify]", p.email, (e as Error).message);
    }
  }
  return sent;
}

type Line = { id: number; name: string; ws: string; metric_name: string; unit: string; direction: string; target: string | null; target_date: string };

/** Monday 08:00 in each member's time zone, once per Monday. */
export async function weekly(now = new Date()) {
  const people = await sql<Who>`
    select distinct u.id, u.email, u.tz, u.notified_at from users u join members m on m.user_id = u.id where u.weekly`;
  let sent = 0;
  for (const p of people) {
    const l = local(now, p.tz);
    if (l.wd !== 0 || l.h < 8) continue;
    const key = ymd(now, p.tz);
    const [done] = await sql`select 1 from mail_log where user_id = ${p.id} and kind = 'weekly' and key = ${key}`;
    if (done) continue;

    const loopers = await sql<Line>`
      select l.id, l.name, w.name as ws, l.metric_name, l.unit, l.direction, l.target, l.target_date from loopers l
      join workspaces w on w.id = l.workspace_id join members m on m.workspace_id = w.id
      where m.user_id = ${p.id} and l.fired_at is null order by w.id, l.id`;
    if (!loopers.length) continue;
    const week = new Date(now.getTime() - 7 * 864e5);
    const blocks: string[] = [];
    for (const x of loopers) {
      const [cur] = await sql<{ value: string }>`select value from metric_points where looper_id = ${x.id} order by taken_at desc limit 1`;
      const [old] = await sql<{ value: string }>`
        select value from metric_points where looper_id = ${x.id} and taken_at <= ${week} order by taken_at desc limit 1`;
      const top = await sql<{ title: string; delta: string }>`
        select title, delta from cards where looper_id = ${x.id} and attribution = 'attributed' and done_at > ${week}
        order by case when ${x.direction} = 'down' then delta else -delta end limit 3`;
      const [{ n }] = await sql<{ n: number }>`
        select count(*)::int as n from cards where looper_id = ${x.id} and status = 'done' and done_at > ${week}`;
      const v = cur ? Number(cur.value) : null;
      const head = `${x.name} (${x.ws}): ${x.metric_name.split(",")[0]} ${v === null ? "no reading yet" : fmtV(v, x.unit)}${
        x.target === null ? "" : ` of ${fmtV(Number(x.target), x.unit)} by ${String(x.target_date).slice(0, 10)}`
      }${v !== null && old ? `, ${v - Number(old.value) >= 0 ? "+" : ""}${fmtV(v - Number(old.value), x.unit)} this week` : ""}`;
      blocks.push(
        head,
        `${n} card${n === 1 ? "" : "s"} done this week.`,
        ...(top.length
          ? top.map((c) => `- ${c.title}: ${Number(c.delta) >= 0 ? "+" : ""}${fmtV(Number(c.delta), x.unit)}`)
          : ["- No card moved it on its own this week."]),
        "",
      );
    }
    const subject = `Your loopers, week of ${key}`;
    try {
      await sendMail(p.email, { subject, heading: subject, body: [...blocks, `All workspaces: ${SITE}/app/all`].join("\n") });
      await sql`insert into mail_log (user_id, kind, key) values (${p.id}, 'weekly', ${key}) on conflict do nothing`;
      sent++;
    } catch (e) {
      console.error("[weekly]", p.email, (e as Error).message);
    }
  }
  return sent;
}
