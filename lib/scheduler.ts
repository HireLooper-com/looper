import { billingOff } from "./billing";
import { sql } from "./db";
import { executeCard, readMetric, runRoutine, syncPullRequests, type Looper } from "./engine";
import { planLooper, runSetup, setupPending, setupSteps } from "./plan";
import { readSignals } from "./signals";
import { runChecks } from "./checks";
import { modelFor } from "./llm";
import { dueSlot, isReflectionFriday, local, ymd } from "./time";
import { digest, weekly } from "./notify";

type Row = Looper & { tz: string };

/** Leave this long for cards, checks and email after the loopers, inside the route's 300 seconds. */
const LOOPERS_BUDGET_MS = 180_000;
/** A stuck run or card older than this died with its function. */
const STUCK = "30 minutes";
/** A failed metric read waits this long before the next try, so a broken source does not spend the founder's key every 15 minutes. */
const METRIC_RETRY_H = 6;

/**
 * One scheduler pass. Called every 15 minutes by Vercel Cron. Every step is idempotent, so
 * overlapping or missed ticks are safe. One looper failing never stops the others or the email,
 * and loopers start in random order with a time budget, so a slow looper cannot starve the rest.
 */
export async function tick(now = new Date(), budgetMs = LOOPERS_BUDGET_MS) {
  const started = Date.now();
  const log: string[] = [];
  const skipBilling = billingOff();
  const loopers = await sql<Row>`
    select l.*, u.tz from loopers l
    join users u on u.id = l.user_id
    join model_keys k on k.user_id = u.id
    where l.fired_at is null and (${skipBilling} or u.subscription_status in ('active','trialing'))
    order by random()`;

  // A plan that started over 10 minutes ago died with its request; let the founder or the next tick retry.
  await sql`update loopers set plan_status = 'failed', plan_error = 'Planning stopped halfway. Try again.'
    where plan_status = 'planning' and plan_at < now() - interval '10 minutes'`;
  // Runs and cards whose function was killed mid-way stay 'running' forever otherwise.
  const runs = await sql`update runs set status = 'failed', finished_at = now(), error = 'The run stopped halfway. It runs again at its next slot.'
    where status = 'running' and started_at < now() - ${STUCK}::interval returning id`;
  const cards = await sql`update cards set status = 'failed', updated_at = now(), result = 'Stopped halfway. Check the tool before you press Retry, the call may have gone through.'
    where status = 'running' and not (coalesce(ext, '{}') ? 'pr') and updated_at < now() - ${STUCK}::interval returning id`;
  if (runs.length || cards.length) log.push(`reaped ${runs.length} stuck runs, ${cards.length} stuck cards`);

  let skipped = 0;
  for (const l of loopers) {
    if (Date.now() - started > budgetMs) {
      skipped++;
      continue;
    }
    try {
      // 0. Loopers hired before a model key existed, or whose plan failed once.
      if (l.plan_status === "waiting") {
        log.push(`${l.name}: planned ${await planLooper(l.id)}`);
      }

      // 0b. Setup steps waiting for a tool that may be connected now (the repo, for loopers that open pull requests).
      if (l.plan_status === "ready" && setupPending(l, await setupSteps(l), now)) {
        const n = await runSetup(l.id).catch(() => 0);
        if (n) log.push(`${l.name}: setup ${n} steps`);
      }

      // 0c. Daily reads the routines pick from (Search Console queries, AI answers), after 06:00 local.
      if (l.plan_status === "ready" && local(now, l.tz).h >= 6) {
        const cfg = await modelFor(l.user_id);
        if (cfg) for (const line of await readSignals(l, cfg, now).catch((e) => [`signals failed: ${(e as Error).message}`])) log.push(`${l.name}: ${line}`);
      }

      // 1. Routines whose slot has come up and has not run yet.
      const routines = await sql<{ id: number; name: string; days: number[]; hour: number; last_slot: Date | null }>`
        select id, name, days, hour, last_slot from routines where looper_id = ${l.id}`;
      for (const r of routines) {
        const slot = dueSlot(r.days, r.hour, now, l.tz);
        if (!slot || (r.last_slot && new Date(r.last_slot) >= slot)) continue;
        // Claim the slot first so a parallel tick does not run it twice.
        const claimed = await sql`
          update routines set last_slot = ${slot}
          where id = ${r.id} and (last_slot is null or last_slot < ${slot}) returning id`;
        if (!claimed.length) continue;
        try {
          log.push(`${l.name}: ${r.name}, ${await runRoutine(r.id)} cards`);
        } catch (e) {
          log.push(`${l.name}: ${r.name} failed: ${(e as Error).message}`);
        }
      }

      // 2. A metric reading once a day, after 07:00 local.
      // A failed read waits METRIC_RETRY_H hours, and the digest tells the workspace why.
      const triedAt = l.metric_tried_at ? new Date(l.metric_tried_at).getTime() : 0;
      if (l.metric_source !== "manual" && local(now, l.tz).h >= 7 && now.getTime() - triedAt > METRIC_RETRY_H * 3600e3) {
        const [fresh] = await sql`select 1 from metric_points where looper_id = ${l.id} and taken_at > ${new Date(now.getTime() - 20 * 3600e3)}`;
        if (!fresh) {
          try {
            log.push(`${l.name}: metric ${await readMetric(l)}`);
          } catch (e) {
            const msg = (e as Error).message;
            await sql`update loopers set metric_failed_at = coalesce(metric_failed_at, ${now}), metric_tried_at = ${now},
              metric_error = ${msg.slice(0, 600)} where id = ${l.id}`;
            log.push(`${l.name}: metric failed: ${msg}`);
          }
        }
      }

      // 3. Every second Friday from 16:00 local, open the reflection.
      if (isReflectionFriday(new Date(l.created_at), now, l.tz) && local(now, l.tz).h >= 16) {
        const r = await sql`
          insert into reflections (looper_id, due_on) values (${l.id}, ${ymd(now, l.tz)})
          on conflict (looper_id, due_on) do nothing returning id`;
        if (r.length) log.push(`${l.name}: reflection opened`);
      }
    } catch (e) {
      log.push(`${l.name}: failed: ${(e as Error).message}`);
      console.error("[tick]", l.id, e);
    }
  }
  if (skipped) log.push(`time budget spent, ${skipped} loopers wait for the next tick`);

  // 4. Approved cards still waiting for their tool call (e.g. the request that approved them timed out).
  const waiting = await sql<{ id: number }>`
    select id from cards where status = 'approved' and action is not null and updated_at < now() - interval '2 minutes' limit 20`;
  for (const c of waiting) await executeCard(c.id).catch((e) => log.push(`card ${c.id} failed: ${(e as Error).message}`));
  if (waiting.length) log.push(`executed ${waiting.length} approved cards`);

  // 4b. Pull requests: merged cards are done, closed ones rejected.
  for (const line of await syncPullRequests().catch((e) => [`pull requests failed: ${(e as Error).message}`])) log.push(line);

  // 4c. Check-backs on done cards: baseline on day 0, then the role's check days.
  for (const line of await runChecks(now).catch((e) => [`checks failed: ${(e as Error).message}`])) log.push(line);

  // 5. Email: what needs each member, and the Monday report.
  const digests = await digest(now).catch((e) => (log.push(`digest failed: ${(e as Error).message}`), 0));
  const reports = await weekly(now).catch((e) => (log.push(`weekly failed: ${(e as Error).message}`), 0));
  if (digests || reports) log.push(`emailed ${digests} digests, ${reports} weekly reports`);

  return log;
}
