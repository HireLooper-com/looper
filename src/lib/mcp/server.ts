import "server-only";
import { asSchema, tool, type ToolSet } from "ai";
import { nanoid } from "nanoid";
import { after } from "next/server";
import { z } from "zod";
import { beginLooperReply, chiefTools, hireLooper, looperSpec, metricLine, runSkill } from "../agent";
import { mutate, read } from "../db";
import { inboxItems } from "../inbox";
import { LOOPER_TEMPLATES, templateBySlug } from "../looper-templates";
import { describeSchedule } from "../schedule";
import type { DB } from "../types";
import { displayName, getUser } from "../workspace";

// Looper as an MCP server: Claude Code, Claude and other MCP clients hire and manage loopers
// with the same tools Chief uses in the app, plus a few for reading a looper and answering it.
// Stateless Streamable HTTP: every POST is one JSON-RPC message (or batch), answered as JSON.

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Looper hires AI operators ("loopers"). Each looper owns exactly one business metric (with a target and direction), works it on a schedule with skills that use the owner's apps (Gmail, Search Console, GitHub, Buffer…), keeps a kanban board and a database, and never sends, publishes, pays or deletes without the owner's approval.

To hire: check list_templates first and use hire_template when one fits. Otherwise call create_looper with a full spec: one metric, 1-4 skills on sensible schedules whose instructions name the apps, the apps it needs, a database with 5-10 columns, and up to 3 starter cards. Split goals with two metrics into two loopers. After hiring, share the links in the result: the owner connects missing apps in the browser.

Questions and approvals from loopers show up in needs_you. Only answer them with the owner's explicit decision.`;

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
/** paywall: why tool calls are refused (a hosted workspace without a plan); listing still works. */
type Ctx = { ws: string; userId: string; origin: string; paywall?: string };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function findLooper(db: DB, idOrName: string) {
  const l = db.loopers.find((x) => x.id === idOrName || x.name.toLowerCase() === idOrName.toLowerCase());
  if (!l) throw new Error(`No looper "${idOrName}". Call list_loopers for ids.`);
  return l;
}

/** Tools only MCP clients get: Chief sees these things in its prompt, an outside client has to ask. */
function clientTools({ ws, userId }: Ctx, links: { label: string; href: string }[]): ToolSet {
  const by = async () => {
    if (ws === userId) return undefined;
    const u = await getUser(userId);
    return u ? { id: u.id, name: displayName(u) } : undefined;
  };
  const hired = (r: Awaited<ReturnType<typeof hireLooper>>) => {
    links.push({ label: `Open ${r.name}`, href: `/loopers/${r.id}` });
    if (r.apps.length) links.push({ label: `Connect apps for ${r.name}`, href: `/loopers/${r.id}?tab=apps` });
    return { id: r.id, name: r.name, apps: r.apps.map((a) => a.name), firstSkill: r.firstSkill && { id: r.firstSkill.id, name: r.firstSkill.name } };
  };

  return {
    list_templates: tool({
      description: "Ready-made loopers, tuned by hand. Prefer hire_template over create_looper when one fits the goal.",
      inputSchema: z.object({}),
      execute: async () =>
        LOOPER_TEMPLATES.map((t) => ({ template: t.slug, title: t.title, pitch: t.pitch, metric: `${t.spec.metric.name} (${t.spec.metric.unit}, ${t.spec.metric.direction})`, apps: t.spec.apps })),
    }),
    hire_template: tool({
      description: "Hire a ready-made looper from list_templates, optionally with your own metric target and current value.",
      inputSchema: z.object({
        template: z.string().describe("slug from list_templates"),
        target: z.number().optional(),
        current: z.number().optional().describe("today's value of the metric, as its baseline"),
      }),
      execute: async ({ template, target, current }) => {
        const t = templateBySlug(template);
        if (!t) throw new Error(`No template "${template}". Call list_templates.`);
        const spec = looperSpec.parse(structuredClone(t.spec));
        if (target !== undefined) spec.metric.target = target;
        if (current !== undefined) spec.metric.current = current;
        return hired(await hireLooper(ws, spec));
      },
    }),
    get_looper: tool({
      description: "Everything about one looper: mission, metric history, skills with ids, open cards, recent runs, open questions and the latest chat messages.",
      inputSchema: z.object({ looper: z.string().describe("id or name") }),
      execute: async ({ looper }) => {
        const db = await read(ws);
        const l = findLooper(db, looper);
        links.push({ label: `Open ${l.name}`, href: `/loopers/${l.id}` });
        return {
          id: l.id,
          name: l.name,
          role: l.role,
          status: l.status,
          mission: l.mission,
          metric: metricLine(l),
          history: l.metric.history.slice(-10),
          apps: (l.apps ?? []).map((a) => a.name),
          skills: l.skills.map((s) => ({ id: s.id, name: s.name, kind: s.kind, schedule: describeSchedule(s.schedule), lastRunAt: s.lastRunAt, instructions: s.instructions })),
          openCards: db.cards
            .filter((c) => c.looperId === l.id && c.column !== "done")
            .map((c) => ({ id: c.id, title: c.title, column: c.column, for: c.assignee ?? "looper" })),
          recentRuns: db.runs
            .filter((r) => r.looperId === l.id)
            .slice(-5)
            .map((r) => ({ skill: r.skillName, status: r.status, startedAt: r.startedAt, summary: r.summary })),
          openQuestions: db.asks.filter((a) => a.looperId === l.id && a.status === "open").map((a) => ({ id: a.id, kind: a.kind, question: a.question, options: a.options, detail: a.detail })),
          chat: (db.chats?.[l.id] ?? []).slice(-6).map((m) => ({ from: m.role === "user" ? "owner" : l.name, at: m.at, text: m.content })),
        };
      },
    }),
    run_skill: tool({
      description: "Start one of a looper's skills now. It runs in the background for a few minutes; read the result later with get_looper (recentRuns).",
      inputSchema: z.object({ looper: z.string().describe("id or name"), skill: z.string().describe("skill id or name") }),
      execute: async ({ looper, skill }) => {
        const l = findLooper(await read(ws), looper);
        const s = l.skills.find((x) => x.id === skill || x.name.toLowerCase() === skill.toLowerCase());
        if (!s) throw new Error(`${l.name} has no skill "${skill}": ${l.skills.map((x) => x.name).join(", ")}`);
        after(() => runSkill(ws, l.id, s.id, "manual").then(() => undefined).catch(() => undefined));
        links.push({ label: `Watch ${l.name} work`, href: `/loopers/${l.id}?tab=chat` });
        return { started: s.name };
      },
    }),
    message_looper: tool({
      description: "Send a looper a message in its chat, as the owner. It replies within a minute or two; read the reply with get_looper (chat).",
      inputSchema: z.object({ looper: z.string().describe("id or name"), text: z.string().min(1) }),
      execute: async ({ looper, text }) => {
        const l = findLooper(await read(ws), looper);
        const reply = await beginLooperReply(ws, l.id, text, await by());
        after(reply);
        links.push({ label: `Chat with ${l.name}`, href: `/loopers/${l.id}?tab=chat` });
        return { sent: true };
      },
    }),
    record_metric: tool({
      description: "Log a new reading of a looper's metric.",
      inputSchema: z.object({ looper: z.string().describe("id or name"), value: z.number(), note: z.string().optional() }),
      execute: ({ looper, value, note }) =>
        mutate(ws, (db) => {
          const l = findLooper(db, looper);
          l.metric.history.push({ at: new Date().toISOString(), value, note: note || "via MCP" });
          return { metric: metricLine(l) };
        }),
    }),
    needs_you: tool({
      description: "What's waiting on the owner: loopers' questions and approvals, cards assigned to the owner, and failing skills.",
      inputSchema: z.object({ looper: z.string().optional().describe("id or name; all loopers when left out") }),
      execute: async ({ looper }) => {
        const db = await read(ws);
        const only = looper ? findLooper(db, looper).id : undefined;
        const name = (id: string) => db.loopers.find((l) => l.id === id)?.name;
        links.push({ label: "Open Needs you", href: "/inbox" });
        return inboxItems(db, only).map((i) =>
          i.kind === "ask"
            ? { type: i.ask.kind === "approval" ? "approval" : i.ask.kind === "takeover" ? "browser takeover" : "question", looper: name(i.looperId), askId: i.ask.id, question: i.ask.question, options: i.ask.options, detail: i.ask.detail, url: i.ask.url }
            : i.kind === "card"
              ? { type: "card for you", looper: name(i.looperId), cardId: i.card.id, title: i.card.title }
              : { type: "failing skill", looper: name(i.looperId), skill: i.run.skillName, failures: i.count, error: i.run.summary },
        );
      },
    }),
    answer_question: tool({
      description:
        "Answer a looper's question or approval from needs_you. For approvals answer 'Approve' or 'Decline'. Only send the owner's explicit decision: never approve on your own.",
      inputSchema: z.object({ askId: z.string(), answer: z.string().describe("one of the options, or 'Approve'/'Decline'"), note: z.string().optional() }),
      execute: async ({ askId, answer, note }) => {
        const ask = await mutate(ws, (db) => {
          const a = db.asks.find((x) => x.id === askId);
          if (!a) throw new Error("That question is gone.");
          if (a.status !== "open") throw new Error("Already answered.");
          if (a.kind === "takeover") throw new Error("This one needs the owner in the looper's browser. Share the link instead.");
          a.status = "answered";
          a.answer = note?.trim() ? `${answer} — ${note.trim()}` : answer;
          a.answeredAt = new Date().toISOString();
          return a;
        });
        const text =
          ask.kind === "approval"
            ? `${answer === "Approve" ? "Approved" : "Not approved"}: ${ask.question}${note?.trim() ? `\n${note.trim()}` : ""}`
            : `${ask.question}\n→ ${answer}${note?.trim() ? `\n${note.trim()}` : ""}`;
        const reply = await beginLooperReply(ws, ask.looperId, text, await by());
        after(reply);
        return { answered: true };
      },
    }),
  };
}

function toolsFor(ctx: Ctx, links: { label: string; href: string }[]): ToolSet {
  // Chief's run_skill waits for the run to finish; clients get the background one above.
  const chief = chiefTools(ctx.ws, [], links);
  delete chief.run_skill;
  return { ...chief, ...clientTools(ctx, links) };
}

async function listTools(ctx: Ctx) {
  return Promise.all(
    Object.entries(toolsFor(ctx, [])).map(async ([name, t]) => {
      const inputSchema = { ...((await asSchema(t.inputSchema).jsonSchema) as Record<string, unknown>) };
      delete inputSchema.$schema;
      return { name, description: t.description, inputSchema };
    }),
  );
}

async function callTool(ctx: Ctx, name: string, args: unknown) {
  if (ctx.paywall) return { content: [{ type: "text", text: ctx.paywall }], isError: true };
  const links: { label: string; href: string }[] = [];
  const t = toolsFor(ctx, links)[name];
  if (!t?.execute) return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
  const schema = asSchema(t.inputSchema);
  const parsed = schema.validate ? await schema.validate(args ?? {}) : { success: true as const, value: args };
  if (!parsed.success) return { content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }], isError: true };
  try {
    const result = await t.execute(parsed.value, { toolCallId: nanoid(8), messages: [], context: {} });
    const withLinks = links.length ? { result, links: links.map((l) => ({ label: l.label, url: new URL(l.href, ctx.origin).toString() })) } : result;
    return { content: [{ type: "text", text: JSON.stringify(withLinks ?? null, null, 2) }] };
  } catch (e) {
    return { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

async function handle(ctx: Ctx, msg: Rpc) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "looper", title: "Looper", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: await listTools(ctx) });
    case "tools/call":
      return ok(id, await callTool(ctx, String(params?.name ?? ""), params?.arguments));
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/** Answer one POSTed JSON-RPC message or batch. Notifications and responses get no reply (null). */
export async function respond(ctx: Ctx, body: unknown) {
  const one = async (m: unknown) => {
    const msg = m as Partial<Rpc>;
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return msg && "id" in msg && !("result" in msg || "error" in msg) ? fail(msg.id, -32600, "Invalid request") : null;
    if (msg.id === undefined) return null;
    return handle(ctx, msg as Rpc).catch((e) => fail(msg.id, -32603, e instanceof Error ? e.message : String(e)));
  };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(one))).filter(Boolean);
    return out.length ? out : null;
  }
  return one(body);
}
