import { sql } from "./db";
import { isConnected, runTool, toolkitNames, toolsFor, wsById } from "./tools";
import { chat, modelFor, withTools } from "./llm";
import { ledger } from "./memory";
import { dueChecks, parseCheck } from "./spec";
import { role as findRole } from "./roles";
import { toolDef, type Card } from "./engine";

// Check-backs: a done card's subject is read again on its routine's check days (role spec `check`).
// Day 0 is the baseline. Later days get a verdict: keep, wait, revert or iterate. The last day
// settles the ledger row the card answered (won or lost). A revert verdict never undoes anything
// by itself; the board shows it next to the Undo button.

type Row = Card & {
  workspace_id: number;
  user_id: number;
  website: string;
  role: string;
  slug: string;
  check_days: number[];
  check_read: string;
  check_tool: string;
  done_days: number[];
  readings: { day: number; reading: string; verdict: string }[] | null;
};

/** Read every check that is due, at most `limit` per tick. */
export async function runChecks(now = new Date(), limit = 6) {
  // A check that started over 15 minutes ago died with its request; let this tick read it again.
  await sql`delete from checks where status = 'running' and taken_at < now() - interval '15 minutes'`;
  const rows = await sql<Row>`
    select c.*, l.workspace_id, l.user_id, l.website, l.role, r.slug, r.check_days, r.check_read, r.check_tool,
      coalesce((select array_agg(k.day) from checks k where k.card_id = c.id), '{}') as done_days,
      (select json_agg(json_build_object('day', k.day, 'reading', k.reading, 'verdict', k.verdict) order by k.day)
         from checks k where k.card_id = c.id and k.status = 'done') as readings
    from cards c join loopers l on l.id = c.looper_id join routines r on r.id = c.routine_id
    where l.fired_at is null and c.status = 'done' and c.subject <> '' and cardinality(r.check_days) > 0 and c.done_at is not null
      and c.done_at > ${new Date(now.getTime() - 120 * 86_400_000)}
    order by c.done_at limit 200`;
  const log: string[] = [];
  for (const c of rows) {
    if (log.length >= limit) break;
    const due = dueChecks(new Date(c.done_at!), c.check_days, c.done_days, now);
    if (!due.length) continue;
    // Only the newest due day is read; older ones missed their moment and are skipped.
    const day = due[due.length - 1];
    for (const d of due.slice(0, -1)) await sql`insert into checks (card_id, day, status) values (${c.id}, ${d}, 'skipped') on conflict do nothing`;
    const claimed = await sql`insert into checks (card_id, day, status) values (${c.id}, ${day}, 'running') on conflict do nothing returning id`;
    if (!claimed.length) continue;
    try {
      const { reading, verdict } = await readCheck(c, day, day === Math.max(...c.check_days));
      await sql`update checks set status = 'done', reading = ${reading}, verdict = ${verdict}, taken_at = now() where card_id = ${c.id} and day = ${day}`;
      if (day === Math.max(...c.check_days) && c.source_kind && c.source_key)
        await ledger.setStatus(c.workspace_id, c.looper_id, c.source_kind, c.source_key, verdict === "keep" ? "won" : "lost", c.id);
      log.push(`card ${c.id} day ${day}: ${verdict}`);
    } catch (e) {
      await sql`update checks set status = 'failed', reading = ${String((e as Error).message).slice(0, 600)}, taken_at = now() where card_id = ${c.id} and day = ${day}`;
      log.push(`card ${c.id} day ${day} failed: ${(e as Error).message}`);
    }
  }
  return log;
}

async function readCheck(c: Row, day: number, last: boolean) {
  const cfg = await modelFor(c.user_id);
  if (!cfg) throw new Error("No model connected");
  const source = c.source_kind && c.source_key ? await ledger.get(c.workspace_id, c.looper_id, c.source_kind, c.source_key) : null;
  const names = await toolkitNames(c.workspace_id);
  // The role's rule for a keep verdict, from the routine's preset or the role's check.
  const spec = findRole(c.role);
  const keep = spec?.routines.find((p) => p.slug === c.slug)?.check?.keep ?? spec?.check?.keep;
  const pr = c.ext?.pr;
  const prompt = [
    `Card: ${c.title}`,
    `Subject: ${c.subject}`,
    c.website && `Website: ${c.website}`,
    `Done: ${new Date(c.done_at!).toISOString().slice(0, 10)}. Today is day ${day} after it.`,
    pr && `Pull request: ${pr.url}${pr.merge_sha ? `, merged as commit ${pr.merge_sha}` : ""}${pr.ci ? `, CI ${pr.ci}` : ""}.`,
    `Read: ${c.check_read || "the numbers this card was meant to move, for the subject"}`,
    day > 0 && keep && `Verdict rule: ${keep}`,
    c.readings?.length && `Earlier readings:\n${c.readings.map((k) => `- day ${k.day}: ${k.reading}`).join("\n")}`,
    source && `Latest ${source.kind} row for "${source.key}", read ${source.read_at ? new Date(source.read_at).toISOString().slice(0, 10) : "never"}: ${JSON.stringify(source.data).slice(0, 600)}`,
    "End with two lines:",
    "READING: <one line with the numbers, compared with day 0 when there is one>",
    day === 0
      ? "VERDICT: baseline"
      : last
        ? "VERDICT: keep (it moved the right way), revert (it made things worse) or iterate (no clear change, try another version)"
        : "VERDICT: keep, wait (too early to tell) or revert (clearly worse)",
  ]
    .filter(Boolean)
    .join("\n");
  const system = `You check how one change did, ${day} days after it shipped. Only read data. Never change anything. Plain words, numbers in every line.`;
  const tool = c.check_tool;
  if (tool && (await isConnected(c.workspace_id, tool))) {
    const ws = await wsById(c.workspace_id);
    const tools = (await toolsFor(c.workspace_id, tool, 30)).map((t) => toolDef(t, (a) => runTool(ws, t.slug, a)));
    return parseCheck(await withTools(cfg, system, `Read it in ${names[tool] ?? tool}.\n${prompt}`, tools, 8), day, last);
  }
  if (!source) throw new Error(`Connect ${names[tool] || tool || "the tool it reads"} to check this card`);
  return parseCheck(await chat(cfg, system, [{ role: "user", content: prompt }]), day, last);
}

/** Check-backs per card, for the board. */
export async function checksFor(cardIds: number[]) {
  if (!cardIds.length) return new Map<number, { day: number; status: string; reading: string; verdict: string }[]>();
  const rows = await sql<{ card_id: number; day: number; status: string; reading: string; verdict: string }>`
    select card_id, day, status, reading, verdict from checks where card_id = any(${cardIds}) order by day`;
  const m = new Map<number, typeof rows>();
  for (const r of rows) m.set(r.card_id, [...(m.get(r.card_id) ?? []), r]);
  return m;
}

