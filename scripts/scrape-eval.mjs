// Scrape eval: runs the same collect jobs before and after a change and scores what landed in the
// database. Each task hires a throwaway looper in the workspace you name, runs one collect job, scores
// it, and removes the looper (pass --keep to look at its rows, canvas and computer log afterwards).
//
// Usage: node --env-file=.env.local scripts/scrape-eval.mjs --workspace <id> [--task kvk|producthunt|venues] [--keep]
// The workspace needs a connected model (plan or API key). Uses the same storage as the app.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const here = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "server-only": path.join(here, "lib", "empty.cjs"), "@": path.join(here, "..", "src") } });

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const uid = arg("workspace");
const only = arg("task");
const keep = process.argv.includes("--keep");
if (!uid) {
  console.error("Pass --workspace <id> (your user id for a personal workspace).");
  process.exit(1);
}

const TASKS = [
  {
    slug: "kvk",
    looper: { name: "Eval KVK", metric: "New BVs found", rowNoun: "company", columns: ["Company", "KVK number", "City", "Founded", "Industry", "Source URL"] },
    job: {
      title: "New BVs in the Randstad",
      goal: "Find Dutch BVs registered at the KVK in the last 90 days in Amsterdam, Rotterdam, The Hague or Utrecht.",
      criteria: "Legal form BV, registration date within the last 90 days, based in one of those four cities.",
      fields: "company name, KVK number, city, registration date, industry (SBI), source URL",
      count: 20,
    },
  },
  {
    slug: "producthunt",
    looper: { name: "Eval PH", metric: "Launches tracked", rowNoun: "launch", columns: ["Product", "Tagline", "Launch date", "Upvotes", "Website", "Source URL"] },
    job: {
      title: "Today's Product Hunt launches",
      goal: "List today's Product Hunt launches.",
      criteria: "Launched on Product Hunt today.",
      fields: "product name, tagline, launch date, upvotes if shown, website, Product Hunt URL",
      count: 15,
    },
  },
  {
    slug: "venues",
    looper: { name: "Eval Venues", metric: "Venues shortlisted", rowNoun: "venue", columns: ["Venue", "Neighbourhood", "Capacity", "Price per day", "Website", "Source URL"] },
    job: {
      title: "Amsterdam coworking venues for 10",
      goal: "Find places in Amsterdam where a team of 10 can cowork together for a day (meeting rooms, team rooms, bookable coworking spaces).",
      criteria: "In Amsterdam, fits at least 10 people, bookable for a day.",
      fields: "venue name, neighbourhood, capacity, price per day if listed, website, source URL",
      count: 15,
    },
  },
].filter((t) => !only || t.slug === only);

const { hireLooper, collect } = await jiti.import(path.join(here, "../src/lib/agent.ts"));
const { readDatabase, deleteDatabase } = await jiti.import(path.join(here, "../src/lib/database.ts"));
const { deleteCanvas, readCanvas } = await jiti.import(path.join(here, "../src/lib/canvas.ts"));
const { mutate } = await jiti.import(path.join(here, "../src/lib/db.ts"));
const { usageRows } = await jiti.import(path.join(here, "../src/lib/usage.ts"));

const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const results = [];

for (const t of TASKS) {
  console.log(`\n▸ ${t.slug}: ${t.job.title}`);
  const hired = await hireLooper(uid, {
    name: t.looper.name,
    emoji: "◎",
    mission: `Collect ${t.looper.rowNoun}s for an eval. ${t.job.goal}`,
    metric: { name: t.looper.metric, unit: t.looper.rowNoun + "s", direction: "up", target: t.job.count },
    skills: [{ name: "Collect", instructions: t.job.goal, type: "manual", time: "09:00", days: [1] }],
    apps: [],
    database: { name: `${t.looper.name} rows`, rowNoun: t.looper.rowNoun, columns: t.looper.columns.map((name, i) => ({ name, type: i === t.looper.columns.length - 1 || name === "Website" ? "url" : "text" })) },
    starterCards: [],
  });
  const usdBefore = await spend(hired.id);
  const started = Date.now();
  const run = await collect(uid, hired.id, t.job).done;
  const seconds = Math.round((Date.now() - started) / 1000);
  const table = await readDatabase(uid, hired.id);
  const rows = table?.rows ?? [];
  const urlCols = (table?.columns ?? []).filter((c) => c.type === "url" || /source/i.test(c.name));
  const title = table?.columns[0];
  const withSource = rows.filter((r) => urlCols.some((c) => String(r.cells[c.id] ?? "").startsWith("http"))).length;
  const titles = rows.map((r) => norm(title && r.cells[title.id])).filter(Boolean);
  const dupes = titles.length - new Set(titles).size;
  const playbook = (await readCanvas(uid, hired.id)).items.find((i) => i.role === "playbook");
  const usd = (await spend(hired.id)) - usdBefore;
  results.push({ task: t.slug, status: run.status, rows: rows.length, target: t.job.count, sourcePct: rows.length ? Math.round((withSource / rows.length) * 100) : 0, dupes, seconds, usd: usd.toFixed(3), playbook: !!playbook });
  console.log(run.summary);
  if (playbook) console.log(`\n${playbook.text}`);
  if (!keep) {
    await mutate(uid, (db) => {
      db.loopers = db.loopers.filter((l) => l.id !== hired.id);
      db.cards = db.cards.filter((c) => c.looperId !== hired.id);
      db.runs = db.runs.filter((r) => r.looperId !== hired.id);
      db.asks = db.asks.filter((a) => a.looperId !== hired.id);
    });
    await Promise.all([deleteDatabase(uid, hired.id), deleteCanvas(uid, hired.id)]);
  }
}

console.log("\n");
console.table(results);
process.exit(0);

async function spend(looperId) {
  return (await usageRows(uid)).filter((r) => r.source === looperId).reduce((s, r) => s + r.usd, 0);
}
