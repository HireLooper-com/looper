import "server-only";
import { createHash } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { deleteImage, imagePath, readCanvas, saveImage } from "./canvas";
import { kv } from "./kv";

// Each looper gets its own small Linux machine (a Vercel Sandbox) with Chrome, made on first use.
// It's persistent: installed software, files and the browser's logins survive between runs. It's
// stopped after every run and chat turn, so it costs nothing while idle.

const HOME = "/vercel";
const SETUP_MARK = `${HOME}/.cl-ready-1`;
const AGENT_BROWSER = "agent-browser@0.39.1";
// The profile keeps the browser's data; restore saves cookies (session ones too) when it closes.
const BROWSER_ENV = { AGENT_BROWSER_PROFILE: `${HOME}/.cl-profile`, AGENT_BROWSER_RESTORE: "looper" };
const SHOT = "/tmp/cl-shot.jpg";

export const hasComputer = () => !!(process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN);

const sandboxName = (uid: string, looperId: string) => `cl-${createHash("sha256").update(`${uid}:${looperId}`).digest("hex").slice(0, 24)}`;
const stateKey = (uid: string, looperId: string) => `computer:${uid}:${looperId}`;

/** What the owner sees on the Tools tab: where the browser was last, and what it looked like. */
export interface ComputerState {
  url?: string;
  title?: string;
  shot?: string; // image path
  at: string;
}

export const readComputer = (uid: string, looperId: string) => kv.get<ComputerState>(stateKey(uid, looperId));

async function saveState(uid: string, looperId: string, patch: Partial<ComputerState>) {
  await kv.update<ComputerState, void>(stateKey(uid, looperId), () => ({ at: "" }), (s) => void Object.assign(s, patch, { at: new Date().toISOString() }));
}

/** Delete the machine and everything on it (files, logins). The next use starts fresh. */
export async function wipeComputer(uid: string, looperId: string) {
  const sb = await Sandbox.get({ name: sandboxName(uid, looperId) }).catch(() => null);
  await sb?.delete().catch(() => undefined);
  const state = await readComputer(uid, looperId);
  if (state?.shot) await forgetShot(uid, looperId, state.shot);
  await kv.delete(stateKey(uid, looperId));
}

/** Free an old screenshot unless the looper pinned it to the canvas. */
async function forgetShot(uid: string, looperId: string, path: string) {
  const pinned = (await readCanvas(uid, looperId)).items.some((i) => i.src === path);
  if (!pinned) await deleteImage(uid, looperId, path.slice(imagePath(looperId, "").length));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (cut at ${n} characters)` : s);
// agent-browser notes its cookie restore on stderr; that's noise for the model.
const quiet = (s: string) => s.split("\n").filter((l) => !l.startsWith("[agent-browser]")).join("\n").trim();

/**
 * The computer tools for one run or chat turn. The machine starts (or is set up) on the first
 * tool call; call `release` when the turn ends so logins are saved and the machine stops.
 */
export function computerSession(uid: string, looperId: string, progress?: (text: string) => void) {
  let box: Promise<Sandbox> | null = null;
  let browserUsed = false;

  const open = () =>
    (box ??= (async () => {
      const sb = await Sandbox.getOrCreate({ name: sandboxName(uid, looperId), persistent: true, timeout: 15 * 60_000, resources: { vcpus: 2 }, tags: { app: "chieflooper" } });
      if ((await sb.runCommand({ cmd: "test", args: ["-f", SETUP_MARK] })).exitCode !== 0) {
        progress?.("Setting up my computer (first time, about a minute)…");
        // System libraries need root; the browser itself goes in the default user's home.
        const root = await sb.runCommand({ cmd: "bash", args: ["-lc", `npm i -g ${AGENT_BROWSER} && agent-browser install --with-deps`], sudo: true, timeoutMs: 240_000 });
        if (root.exitCode !== 0) throw new Error(`Couldn't set up the computer: ${(await root.stderr()).slice(-300)}`);
        const user = await sb.runCommand({ cmd: "bash", args: ["-lc", `agent-browser install && touch ${SETUP_MARK}`], timeoutMs: 120_000 });
        if (user.exitCode !== 0) throw new Error(`Couldn't install the browser: ${(await user.stderr()).slice(-300)}`);
      }
      return sb;
    })().catch((e) => {
      box = null;
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

  /** Title, URL and the clickable elements, so the model can pick its next step by ref. */
  async function page() {
    const [title, url, snap] = await Promise.all([browser(["get", "title"]), browser(["get", "url"]), browser(["snapshot", "-i", "-c"])]);
    const at = { title: title.out, url: url.out };
    if (at.url) await saveState(uid, looperId, at);
    return { ...at, elements: clip(snap.out || snap.err, 12_000) };
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
      execute: async ({ action, target, value }) => {
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
        const done = args ? await browser(args) : null;
        if (done && done.code !== 0) return { error: clip(done.err || done.out || "That didn't work.", 1500), page: await page() };
        return { done: done ? clip(done.out, 500) : undefined, page: await page() };
      },
    }),
    computer_read: tool({
      description: "Read the text of the page open in your browser, as clean readable text (articles, tables, prices, search results).",
      inputSchema: z.object({}),
      execute: async () => {
        const r = await browser(["read"], 90_000);
        return r.code === 0 ? { text: clip(r.out, 20_000) } : { error: clip(r.err || r.out, 1500) };
      },
    }),
    computer_screenshot: tool({
      description: "See the page in your browser as an image, when the layout matters or the element list isn't enough. The owner sees the latest screenshot on your Tools tab; pin it to your canvas with its `image` path to keep it.",
      inputSchema: z.object({ fullPage: z.boolean().default(false) }),
      execute: async ({ fullPage }) => {
        const r = await browser(["screenshot", ...(fullPage ? ["--full"] : []), SHOT, "--screenshot-format", "jpeg", "--screenshot-quality", "70"]);
        if (r.code !== 0) return { error: clip(r.err || r.out, 1500) };
        const bytes = await (await open()).readFileToBuffer({ path: SHOT });
        if (!bytes) return { error: "The screenshot came out empty." };
        const type = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
        const image = await saveImage(uid, looperId, type, new Uint8Array(bytes).buffer);
        const before = await readComputer(uid, looperId);
        await saveState(uid, looperId, { shot: image });
        if (before?.shot && before.shot !== image) await forgetShot(uid, looperId, before.shot);
        return { image, mediaType: type, data: Buffer.from(bytes).toString("base64") };
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
        return { exitCode: r.code, stdout: clip(r.out, 8000), stderr: clip(r.err, 3000) };
      },
    }),
  };

  /** Close the browser (which saves its logins) and stop the machine until next time. */
  async function release() {
    if (!box) return;
    const sb = await box.catch(() => null);
    if (!sb) return;
    if (browserUsed) await exec("agent-browser", ["close"], { env: BROWSER_ENV, timeoutMs: 20_000 });
    await sb.stop().catch(() => undefined);
  }

  return { tools, release };
}
