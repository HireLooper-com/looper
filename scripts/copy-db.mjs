// Copy every row of the key-value table from one Postgres to another (e.g. one Neon branch to another).
// Only inserts or updates rows in the target; never deletes anything in either database.
//   SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=… node scripts/copy-db.mjs           (dry run: counts only)
//   SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=… node scripts/copy-db.mjs --write
import pg from "pg";

const { SOURCE_DATABASE_URL: from, TARGET_DATABASE_URL: to } = process.env;
if (!from || !to) throw new Error("Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL.");
if (from === to) throw new Error("Source and target are the same database.");
const write = process.argv.includes("--write");
const TABLE = "chieflooper_kv";

const src = new pg.Pool({ connectionString: from, max: 2 });
const dst = new pg.Pool({ connectionString: to, max: 2 });

const rows = (await src.query(`SELECT key, value, expires_at, updated_at FROM ${TABLE} WHERE expires_at IS NULL OR expires_at > now()`)).rows;
const kinds = {};
for (const r of rows) kinds[r.key.split(":")[0]] = (kinds[r.key.split(":")[0]] ?? 0) + 1;
console.log(`Source: ${rows.length} live rows`, kinds);

if (!write) {
  const exists = (await dst.query(`SELECT to_regclass($1) AS t`, [TABLE])).rows[0].t;
  console.log(`Target table ${exists ? "exists" : "will be created"}. Dry run only; add --write to copy.`);
} else {
  await dst.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now())`);
  let n = 0;
  for (const r of rows) {
    await dst.query(
      `INSERT INTO ${TABLE} (key, value, expires_at, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.expires_at, r.updated_at],
    );
    if (++n % 200 === 0) console.log(`  ${n}/${rows.length}`);
  }
  const check = (await dst.query(`SELECT count(*)::int AS n FROM ${TABLE}`)).rows[0].n;
  console.log(`Copied ${n} rows. Target now has ${check} rows.`);
}
await src.end();
await dst.end();
