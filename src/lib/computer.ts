import "server-only";
import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { tool, type ToolSet } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { assertInfraBudget, spendInfra } from "./billing";
import { deleteImage, imagePath, readCanvas, saveImage } from "./canvas";
import { kv } from "./kv";
import { describeTool } from "./progress";

// Each looper gets its own small Linux machine (a Vercel Sandbox) with Chrome, made on first use.
// It's persistent: installed software, files and the browser's logins survive between runs. It's
// stopped after every run and chat turn, so it costs nothing while idle.
// Every turn that uses it is logged as a session of steps with screenshots, for the Computer view.

const HOME = "/vercel";
const SETUP_MARK = `${HOME}/.cl-ready-1`;
const AGENT_BROWSER = "agent-browser@0.39.1";
// The profile keeps the browser's data; restore saves cookies (session ones too) when it closes.
const BROWSER_ENV = { AGENT_BROWSER_PROFILE: `${HOME}/.cl-profile`, AGENT_BROWSER_RESTORE: "looper" };
const SHOT = "/tmp/cl-shot.jpg";
// Screenshots live in Postgres, so keep the log bounded: recent sessions, a cap of shots in each.
const MAX_SESSIONS = 12;
const MAX_SHOTS = 40;
// A session left open this long (a crashed run) no longer counts as live.
export const LIVE_MS = 8 * 60_000;
// What an awake machine costs us (2 vCPU, 4 GB, plus snapshot storage), rounded up, per minute.
const USD_PER_MINUTE = 0.003;

export const hasComputer = () => !!(process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN);

const sandboxName = (uid: string, looperId: string) => `cl-${createHash("sha256").update(`${uid}:${looperId}`).digest("hex").slice(0, 24)}`;
const logKey = (uid: string, looperId: string) => `computer:${uid}:${looperId}`;

export interface ComputerStep {
  id: string;
  at: string;
  label: string;
  url?: string;
  title?: string;
  shot?: string; // image path
  command?: string;
  output?: string;
  error?: boolean;
}

export interface ComputerSessionLog {
  id: string;
  label: string;
  startedAt: string;
  endedAt?: string;
  steps: ComputerStep[];
}

export interface ComputerLog {
  sessions: ComputerSessionLog[];
}

export async function readComputerLog(uid: string, looperId: string): Promise<ComputerLog> {
  const log = await kv.get<ComputerLog>(logKey(uid, looperId));
  return log?.sessions ? log : { sessions: [] };
}

const isLive = (s: ComputerSessionLog) => !s.endedAt && Date.now() - Date.parse(s.startedAt) < LIVE_MS;

/** For tab previews: how much it's been used, and whether it's working right now. */
export async function computerSummary(uid: string, looperId: string) {
  const { sessions } = await readComputerLog(uid, looperId);
  const last = sessions.at(-1);
  return { sessions: sessions.length, lastAt: last ? (last.endedAt ?? last.startedAt) : undefined, live: !!last && isLive(last) };
}

/** Free screenshots of sessions that left the log, unless the looper pinned them to the canvas. */
async function forgetShots(uid: string, looperId: string, sessions: ComputerSessionLog[]) {
  const shots = sessions.flatMap((s) => s.steps.map((st) => st.shot)).filter((p): p is string => !!p);
  if (!shots.length) return;
  const pinned = new Set((await readCanvas(uid, looperId)).items.map((i) => i.src));
  const prefix = imagePath(looperId, "");
  await Promise.all(shots.filter((p) => !pinned.has(p)).map((p) => deleteImage(uid, looperId, p.slice(prefix.length))));
}

/** Delete the machine and everything on it (files, logins), and its session log. */
export async function wipeComputer(uid: string, looperId: string) {
  const sb = await Sandbox.get({ name: sandboxName(uid, looperId) }).catch(() => null);
  await sb?.delete().catch(() => undefined);
  await forgetShots(uid, looperId, (await readComputerLog(uid, looperId)).sessions);
  await kv.delete(logKey(uid, looperId));
}

// Bot checks (Cloudflare, hCaptcha, reCAPTCHA, PerimeterX, DataDome). We never try to get past them:
// the looper stops, looks for an official route, or asks the owner to pass the check themselves.
const BOT_CHECK =
  /challenges\.cloudflare\.com|cf-turnstile|cf-chl|verify you are human|performing security verification|checking (if the site connection is secure|your browser)|attention required! \| cloudflare|hcaptcha\.com|google\.com\/recaptcha|recaptcha\/api|i'?m not a robot|press (&|and) hold|captcha-delivery\.com|are you a (robot|human)|unusual traffic from your computer/i;
const JUST_A_MOMENT = /^just a moment/i;
// Visible challenge frames only: many ordinary forms load invisible reCAPTCHA, which isn't a block.
const SIGNALS_JS = `[...document.querySelectorAll('iframe')].map(e=>e.src).filter(s=>!/invisible/.test(s)).join(' ')+' '+(document.body?document.body.innerText:'').slice(0,3000)`;
const BLOCKED_NOTE =
  "This site showed a bot check (CAPTCHA / 'verify you are human') and blocks automated browsing. Don't click it or retry, and never try to get around it. Instead: use the site's official API or a connected app if there is one, find the information from another public source (RSS feed, search results, other sites), or use ask_owner to ask whether they want to pass the check themselves.";
const hostOf = (url: string) => {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (cut at ${n} characters)` : s);
// agent-browser notes its cookie restore on stderr; that's noise for the model.
const quiet = (s: string) => s.split("\n").filter((l) => !l.startsWith("[agent-browser]")).join("\n").trim();

/**
 * The computer tools for one run or chat turn (`label` names it in the log). The machine starts
 * (or is set up) on the first tool call; call `release` when the turn ends so logins are saved
 * and the machine stops.
 */
export function computerSession(uid: string, looperId: string, opts: { label: string; progress?: (text: string) => void }) {
  let box: Promise<Sandbox> | null = null;
  let browserUsed = false;
  let sessionId: string | null = null;
  let shots = 0;
  let awakeSince = 0;
  // Sites that showed a bot check this turn: further actions there are refused, so the looper can't loop.
  const blocked = new Set<string>();
  let currentHost = "";

  async function log(fn: (s: ComputerSessionLog) => void) {
    if (!sessionId) return;
    await kv.update<ComputerLog, void>(logKey(uid, looperId), () => ({ sessions: [] }), (l) => {
      const s = l.sessions?.find((x) => x.id === sessionId);
      if (s) fn(s);
    });
  }
  const step = (st: Omit<ComputerStep, "id" | "at">) => log((s) => void s.steps.push({ id: nanoid(6), at: new Date().toISOString(), ...st }));

  async function startLog() {
    sessionId = nanoid(8);
    const evicted = await kv.update<ComputerLog, ComputerSessionLog[]>(logKey(uid, looperId), () => ({ sessions: [] }), (l) => {
      l.sessions = [...(l.sessions ?? []), { id: sessionId!, label: opts.label, startedAt: new Date().toISOString(), steps: [] }];
      return l.sessions.splice(0, Math.max(0, l.sessions.length - MAX_SESSIONS));
    });
    await forgetShots(uid, looperId, evicted).catch(() => undefined);
  }

  const open = () =>
    (box ??= (async () => {
      await assertInfraBudget(uid);
      if (!sessionId) await startLog();
      awakeSince = Date.now();
      const sb = await Sandbox.getOrCreate({ name: sandboxName(uid, looperId), persistent: true, timeout: 15 * 60_000, resources: { vcpus: 2 }, tags: { app: "looper" } });
      if ((await sb.runCommand({ cmd: "test", args: ["-f", SETUP_MARK] })).exitCode !== 0) {
        opts.progress?.("Setting up my computer (first time, about a minute)…");
        await step({ label: "Setting up the computer (first time, about a minute)" });
        // System libraries need root; the browser itself goes in the default user's home.
        const root = await sb.runCommand({ cmd: "bash", args: ["-lc", `npm i -g ${AGENT_BROWSER} && agent-browser install --with-deps`], sudo: true, timeoutMs: 240_000 });
        if (root.exitCode !== 0) throw new Error(`Couldn't set up the computer: ${(await root.stderr()).slice(-300)}`);
        const user = await sb.runCommand({ cmd: "bash", args: ["-lc", `agent-browser install && touch ${SETUP_MARK}`], timeoutMs: 120_000 });
        if (user.exitCode !== 0) throw new Error(`Couldn't install the browser: ${(await user.stderr()).slice(-300)}`);
      }
      return sb;
    })().catch(async (e) => {
      box = null;
      await step({ label: e instanceof Error ? e.message : "The computer didn't start", error: true });
      throw e;
    }));

  async function exec(cmd: string, args: string[], o: { env?: Record<string, string>; timeoutMs?: number } = {}) {
    const sb = await open();
    try {
      const r = await sb.runCommand({ cmd, args, env: o.env, timeoutMs: o.timeoutMs ?? 60_000 });
      const [out, err] = await Promise.all([r.stdout(), r.stderr()]);
      return { code: r.exitCode, out: quiet(out), err: quiet(err) };
    } catch (e) {
      return { code: -1, out: "", err: e instanceof Error ? e.message : String(e) };
    }
  }

  const browser = (args: string[], timeoutMs?: number) => {
    browserUsed = true;
    return exec("agent-browser", args, { env: BROWSER_ENV, timeoutMs });
  };

  /** A screenshot saved for the log (and the model, when it asks). Null past the per-session cap. */
  async function shoot(fullPage = false, force = false) {
    if (!force && shots >= MAX_SHOTS) return null;
    const r = await browser(["screenshot", ...(fullPage ? ["--full"] : []), SHOT, "--screenshot-format", "jpeg", "--screenshot-quality", "60"]);
    if (r.code !== 0) return null;
    const bytes = await (await open()).readFileToBuffer({ path: SHOT });
    if (!bytes) return null;
    shots++;
    const type = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
    return { path: await saveImage(uid, looperId, type, new Uint8Array(bytes).buffer), type, bytes };
  }

  /** Title, URL and the clickable elements, so the model can pick its next step by ref. */
  async function page() {
    const [title, url, snap, signals] = await Promise.all([browser(["get", "title"]), browser(["get", "url"]), browser(["snapshot", "-i", "-c"]), browser(["eval", SIGNALS_JS])]);
    currentHost = hostOf(url.out);
    const botCheck = JUST_A_MOMENT.test(title.out) || BOT_CHECK.test(`${title.out}\n${snap.out}\n${signals.out}`);
    if (botCheck && currentHost) blocked.add(currentHost);
    return { title: title.out, url: url.out, elements: clip(snap.out || snap.err, 12_000), botCheck };
  }

  const tools: ToolSet = {
    computer_browse: tool({
      description:
        "Use the web browser on your own computer (Chrome on a private Linux machine, logins are remembered). `open` a URL, then act on elements by their ref from the returned list (e.g. click @e12, fill @e7 with text). Every call returns the page's title, URL and interactive elements. Use it for websites that no connected app covers.",
      inputSchema: z.object({
        action: z.enum(["open", "click", "fill", "type", "press", "select", "check", "uncheck", "hover", "scroll", "back", "forward", "reload", "wait", "look"]),
        target: z
          .string()
          .optional()
          .describe("open: the URL. click/fill/type/select/check/uncheck/hover: an element ref like @e12 (or a CSS selector). press: a key like Enter or Tab. scroll: up or down. wait: milliseconds or a selector. look: nothing, just re-read the page."),
        value: z.string().optional().describe("fill/type: the text. select: the option to pick. scroll: pixels."),
      }),
      execute: async (input) => {
        const { action, target, value } = input;
        const need = (what: string) => ({ error: `${action} needs ${what}.` });
        let args: string[] | null = null;
        if (action === "open") {
          if (!target) return need("a URL in target");
          args = ["open", /^https?:\/\//i.test(target) ? target : `https://${target}`];
        } else if (["click", "hover", "check", "uncheck"].includes(action)) args = target ? [action, target] : null;
        else if (action === "fill" || action === "type" || action === "select") args = target && value !== undefined ? [action, target, value] : null;
        else if (action === "press") args = target ? ["press", target] : null;
        else if (action === "scroll") args = ["scroll", target === "up" ? "up" : "down", ...(value ? [value] : [])];
        else if (action === "wait") args = ["wait", target ?? "1000"];
        else if (action !== "look") args = [action];
        if (!args && action !== "look") return need("a target (and value)");
        // Already stopped by a bot check on this site this turn: don't touch it again.
        const host = action === "open" ? hostOf(target!) : currentHost;
        if (host && blocked.has(host) && !["back", "forward"].includes(action)) return { blocked: true, site: host, note: BLOCKED_NOTE };
        const done = args ? await browser(args) : null;
        const [now, shot] = await Promise.all([page(), shoot()]);
        const failed = !!done && done.code !== 0;
        if (now.botCheck) {
          await step({ label: `Stopped: ${currentHost || "the site"} shows a bot check`, url: now.url, title: now.title, shot: shot?.path, error: true });
          return { blocked: true, site: currentHost, note: BLOCKED_NOTE, page: { title: now.title, url: now.url } };
        }
        await step({ label: describeTool("computer_browse", input), url: now.url, title: now.title, shot: shot?.path, error: failed || undefined });
        if (failed) return { error: clip(done.err || done.out || "That didn't work.", 1500), page: now };
        return { done: done ? clip(done.out, 500) : undefined, page: now };
      },
    }),
    computer_read: tool({
      description: "Read the text of the page open in your browser, as clean readable text (articles, tables, prices, search results).",
      inputSchema: z.object({}),
      execute: async () => {
        if (currentHost && blocked.has(currentHost)) return { blocked: true, site: currentHost, note: BLOCKED_NOTE };
        const r = await browser(["read"], 90_000);
        const url = await browser(["get", "url"]);
        if (BOT_CHECK.test(r.out.slice(0, 3000))) {
          if (currentHost) blocked.add(currentHost);
          await step({ label: `Stopped: ${currentHost || "the site"} shows a bot check`, url: url.out, error: true });
          return { blocked: true, site: currentHost, note: BLOCKED_NOTE };
        }
        await step({ label: "Reading the page", url: url.out, error: r.code !== 0 || undefined });
        return r.code === 0 ? { text: clip(r.out, 20_000) } : { error: clip(r.err || r.out, 1500) };
      },
    }),
    computer_screenshot: tool({
      description: "See the page in your browser as an image, when the layout matters or the element list isn't enough. The owner sees every screen on your Computer view; pin one to your canvas with its `image` path to keep it.",
      inputSchema: z.object({ fullPage: z.boolean().default(false) }),
      execute: async ({ fullPage }) => {
        const shot = await shoot(!!fullPage, true);
        if (!shot) return { error: "The screenshot didn't work." };
        const url = await browser(["get", "url"]);
        await step({ label: "Looking at the screen", url: url.out, shot: shot.path });
        return { image: shot.path, mediaType: shot.type, data: Buffer.from(shot.bytes).toString("base64") };
      },
      toModelOutput: ({ output }) => {
        const o = output as { image?: string; mediaType?: string; data?: string; error?: string };
        if (!o.data) return { type: "text", value: o.error ?? "No screenshot." };
        return {
          type: "content",
          value: [
            { type: "text" as const, text: `Screenshot saved at ${o.image}:` },
            { type: "file" as const, mediaType: o.mediaType ?? "image/jpeg", data: { type: "data" as const, data: o.data } },
          ],
        };
      },
    }),
    computer_run: tool({
      description:
        "Run a shell command on your computer (bash on Ubuntu, Node and Python installed, passwordless sudo). For downloads (curl), unpacking or converting files, quick scripts and calculations. Files in your home folder stay between runs.",
      inputSchema: z.object({ command: z.string().min(1), timeoutSeconds: z.number().int().min(5).max(180).default(60) }),
      execute: async ({ command, timeoutSeconds }) => {
        const r = await exec("bash", ["-lc", command], { timeoutMs: (timeoutSeconds ?? 60) * 1000 });
        const output = [r.out, r.err].filter(Boolean).join("\n");
        await step({ label: describeTool("computer_run", { command }), command, output: output.slice(-2000), error: r.code !== 0 || undefined });
        return { exitCode: r.code, stdout: clip(r.out, 8000), stderr: clip(r.err, 3000) };
      },
    }),
  };

  /** Close the browser (which saves its logins), stop the machine, and end the session in the log. */
  async function release() {
    if (!box) return;
    const sb = await box.catch(() => null);
    if (sb) {
      if (browserUsed) await exec("agent-browser", ["close"], { env: BROWSER_ENV, timeoutMs: 20_000 });
      await sb.stop().catch(() => undefined);
    }
    if (awakeSince) await spendInfra(uid, Math.max(1, (Date.now() - awakeSince) / 60_000) * USD_PER_MINUTE).catch(() => undefined);
    await log((s) => void (s.endedAt = new Date().toISOString())).catch(() => undefined);
  }

  return { tools, release };
}
