import { sql } from "./db";
import { isConnected, runTool, toolkitNames, toolsFor, wsById } from "./tools";
import { json, withTools, type ModelConfig } from "./llm";
import { ledger } from "./memory";
import { role as findRole, type Signal } from "./roles";
import { lastJson } from "./spec";
import { askBuyerQuestions, toolDef, type Looper } from "./engine";

// Signals: what a looper reads every day besides its metric (lib/roles.ts `signals`), one ledger
// row per item. Routines pick from these rows. Each signal is read at most once a day, and a read
// that fails or comes back empty waits for the next day too (`loopers.signals_at`).

const DAY = 20 * 3600e3;

/** Read every signal of the looper's role that has not been read in the last 20 hours. */
export async function readSignals(looper: Looper, cfg: ModelConfig, now = new Date()) {
  const log: string[] = [];
  for (const s of findRole(looper.role)?.signals ?? []) {
    const at = looper.signals_at?.[s.kind];
    if (at && now.getTime() - new Date(at).getTime() < DAY) continue;
    // The GEO metric reading already asks the questions and fills the ledger.
    if (s.tool === "geo" && looper.metric_source === "geo") continue;
    if (s.tool === "geo" ? !looper.prompts?.length : !(await isConnected(looper.workspace_id, s.tool))) continue;
    await sql`update loopers set signals_at = signals_at || ${JSON.stringify({ [s.kind]: now.toISOString() })}::jsonb where id = ${looper.id}`;
    try {
      const n = s.tool === "geo" ? (await askBuyerQuestions(looper, cfg)).qs.length : await readToolSignal(looper, cfg, s);
      log.push(`${s.kind} ${n} rows`);
    } catch (e) {
      log.push(`${s.kind} failed: ${(e as Error).message}`);
    }
  }
  return log;
}

const ROWS = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "data_json"],
        properties: { key: { type: "string" }, data_json: { type: "string", description: "JSON object with the numbers for this row" } },
      },
    },
  },
};

/** Read one signal from its toolkit into the ledger. Returns the row count. */
async function readToolSignal(looper: Looper, cfg: ModelConfig, s: Signal) {
  const rows = await fetchSignal(looper, cfg, s);
  const readAt = new Date();
  for (const r of rows) await ledger.upsert(looper.workspace_id, looper.id, s.kind, r.key, r.data, readAt);
  return rows.length;
}

/** One read of a signal: the model calls read tools and returns rows, at most 100. Stores nothing. */
export async function fetchSignal(looper: Looper, cfg: ModelConfig, s: Signal) {
  const ws = await wsById(looper.workspace_id);
  const names = await toolkitNames(looper.workspace_id);
  const tools = (await toolsFor(looper.workspace_id, s.tool, 30)).map((t) => toolDef(t, (a) => runTool(ws, t.slug, a)));
  const out = await withTools(
    cfg,
    "You read data from a connected tool for a looper. Only read data. Never change anything.",
    [
      `Read from ${names[s.tool] ?? s.tool}: ${s.read}`,
      looper.website && `Website: ${looper.website}`,
      `Today: ${new Date().toISOString().slice(0, 10)}`,
      `Call the tools you need, then end your reply with a \`\`\`json block: an array of at most 100 objects, each with "key" (${s.key}) and these fields: ${s.columns.map((c) => c.key).join(", ")}.`,
    ]
      .filter(Boolean)
      .join("\n"),
    tools,
    8,
  );
  let rows: { key: string; data: Record<string, unknown> }[] = [];
  const parsed = lastJson(out);
  if (Array.isArray(parsed)) {
    rows = parsed
      .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && typeof (x as { key?: unknown }).key === "string")
      .map(({ key, ...data }) => ({ key: String(key), data }));
  } else {
    const r = await json<{ rows: { key: string; data_json: string }[] }>(cfg, "Turn this tool read into rows. Keep every number.", out, "rows", ROWS);
    rows = r.rows.map((x) => {
      try {
        return { key: x.key, data: JSON.parse(x.data_json) };
      } catch {
        return { key: x.key, data: {} };
      }
    });
  }
  return rows
    .slice(0, 100)
    .map((r) => ({ key: r.key.trim(), data: r.data }))
    .filter((r) => r.key);
}
