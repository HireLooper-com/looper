// Pure rules the engine applies from a role spec (lib/roles.ts): which drafted cards survive the
// guards, when a done card is checked, how a routine fills in from its role. No database here,
// so test/spec.test.ts runs them on their own.

import { REPO_STEP, type ActionKind, type Check, type Limits, type PrLimits, type Role, type RoutinePreset, type SetupStep } from "./roles.ts";

const DEFAULTS: Limits = { cooldownDays: 7, perWeek: {}, alwaysAsk: [] };

export function limitsOf(role: Role | undefined): Limits {
  return { ...DEFAULTS, ...(role?.limits ?? {}) };
}

/** One spelling per subject, so "/Blog/X/" and "blog/x" lock the same page. */
export function subjectKey(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/+|\/+$/g, "")
    .slice(0, 500);
}

export type Draft = { title: string; subject: string; kind: ActionKind };
export type Kept<T> = T & { status: "proposed" | "approved" };

/**
 * Apply a role's limits to the cards a routine drafted:
 * - one card per subject inside the cooldown (`locked` holds subjects already carded),
 * - at most `perWeek[kind]` cards of a kind in 7 days (`used` counts the ones already made),
 * - kinds in `alwaysAsk` never run alone, whatever the routine's mode.
 * Cards without a subject (reports, by-hand notes) are not locked.
 */
export function guard<T extends Draft>(
  drafts: T[],
  ctx: { locked: Set<string>; used: Partial<Record<ActionKind, number>>; limits: Limits; mode: string },
) {
  const keep: Kept<T>[] = [];
  const dropped: { title: string; why: string }[] = [];
  const locked = new Set([...ctx.locked].map(subjectKey));
  const used = { ...ctx.used };
  for (const d of drafts) {
    const key = subjectKey(d.subject);
    if (key && locked.has(key)) {
      dropped.push({ title: d.title, why: `${d.subject} changed in the last ${ctx.limits.cooldownDays} days` });
      continue;
    }
    const cap = ctx.limits.perWeek[d.kind];
    if (cap !== undefined && (used[d.kind] ?? 0) >= cap) {
      dropped.push({ title: d.title, why: `${cap} ${d.kind} cards a week reached` });
      continue;
    }
    if (key) locked.add(key);
    used[d.kind] = (used[d.kind] ?? 0) + 1;
    const auto = ctx.mode === "auto" && !ctx.limits.alwaysAsk.includes(d.kind);
    keep.push({ ...d, status: auto ? "approved" : "proposed" });
  }
  return { keep, dropped };
}

/** Check days that are due for a card done at `doneAt` and not read yet. */
export function dueChecks(doneAt: Date, days: number[], done: number[], now = new Date()) {
  return [...new Set(days)]
    .filter((d) => d >= 0 && !done.includes(d) && doneAt.getTime() + d * 86_400_000 <= now.getTime())
    .sort((a, b) => a - b);
}

/** A routine as it is stored for one looper: the preset's fields, with the role's defaults filled in. */
export function routineFrom(role: Role | undefined, p: Pick<RoutinePreset, "input" | "action" | "check" | "tool">) {
  const check: Check | undefined = p.check ?? role?.check;
  return {
    input: p.input ?? "",
    action: (p.action ?? "tool") as ActionKind,
    check_days: check?.days ?? [],
    check_read: check?.read ?? "",
    check_tool: check?.tool ?? p.tool ?? "",
  };
}

/** Action kinds a planned routine may use: the role's list, or a tool call and by hand. */
export function actionsOf(role: Role | undefined): ActionKind[] {
  return role?.actions?.length ? role.actions : ["tool", "manual"];
}

/**
 * What a looper learns once at hire: its role's setup steps, plus where the site's pages live
 * when one of its routines ships pull requests. `actions` are its routines' action kinds.
 */
export function setupOf(role: Role | undefined, actions: string[]): SetupStep[] {
  const steps = role?.setup ?? [];
  return actions.includes("github_pr") && !steps.some((s) => s.id === REPO_STEP.id) ? [...steps, REPO_STEP] : steps;
}

/** Is a github_pr file path one the looper may write? Never CI, secrets, lockfiles or build config. */
export function writable(path: string, writePaths?: string) {
  const p = String(path ?? "");
  if (!p || p.startsWith("/") || p.split("/").some((s) => s === ".." || s === "." || s === "")) return false;
  if (/(^|\/)\.(github|env|git|vercel)(\/|$|\.)/i.test(p)) return false;
  if (/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|vercel\.json|next\.config\.\w+|Dockerfile|tsconfig\.json)$/i.test(p)) return false;
  if (writePaths) {
    try {
      if (!new RegExp(writePaths, "i").test(p)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export type Edit = { find: string; replace: string };

/** Apply find-and-replace edits to a file. Each `find` must occur exactly once, so an edit never lands in the wrong place. */
export function applyEdits(content: string, edits: Edit[]) {
  let out = content;
  for (const e of edits) {
    if (!e.find) throw new Error("An edit needs the text to find");
    const at = out.indexOf(e.find);
    if (at < 0) throw new Error(`Text to replace not found: "${e.find.slice(0, 80)}"`);
    if (out.indexOf(e.find, at + e.find.length) >= 0) throw new Error(`Text to replace occurs more than once: "${e.find.slice(0, 80)}"`);
    out = out.slice(0, at) + e.replace + out.slice(at + e.find.length);
  }
  return out;
}

/** Lines added plus removed between two texts, ignoring the lines they share at the start and end. */
export function changedLines(before: string, after: string) {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return a.length - start - end + (b.length - start - end);
}

export type PrFileDraft = { path: string; content?: string | null; edits?: Edit[] };

/**
 * Why a drafted pull request does not fit the role's limits, or an empty list when it does.
 * Test files (`pr.tests`) count apart: they never use up the file or line budget, and at least one is required.
 * Whether a file exists is only known when the PR opens, so `editsOnly` is checked again in openPR.
 */
export function prProblems(files: PrFileDraft[], pr: PrLimits | undefined) {
  if (!pr) return [];
  const out: string[] = [];
  let tests: RegExp | null = null;
  try {
    tests = pr.tests ? new RegExp(pr.tests, "i") : null;
  } catch {
    return ["the role's test pattern is not a valid regex"];
  }
  const isTest = (path: string) => Boolean(tests?.test(path));
  const code = files.filter((f) => !isTest(f.path));
  const lines = code.reduce(
    (n, f) => n + (f.edits?.length ? f.edits.reduce((m, e) => m + changedLines(e.find ?? "", e.replace ?? ""), 0) : changedLines("", f.content ?? "")),
    0,
  );
  if (!code.length) out.push("it changes no application code");
  if (code.length > pr.maxFiles) out.push(`it changes ${code.length} files, over ${pr.maxFiles}`);
  if (lines > pr.maxLines) out.push(`it changes ${lines} lines, over ${pr.maxLines}`);
  if (files.length - code.length > 2) out.push("it changes more than 2 test files");
  if (tests && code.length === files.length) out.push("it has no regression test");
  if (pr.editsOnly && code.some((f) => f.content === null)) out.push("it deletes a file");
  return out;
}

/** What the model is told about the shape of a pull request, from the role's limits. */
export function prRules(pr: PrLimits | undefined) {
  if (!pr) return "";
  return [
    `A pull request changes at most ${pr.maxFiles} files and ${pr.maxLines} lines (added plus removed), tests not counted.`,
    pr.editsOnly && "Change existing files with edits only, never the whole content, and never delete one. New files may use content.",
    pr.tests && `Every pull request adds or changes a test file (path matching /${pr.tests}/) with a test that fails before the change and passes after.`,
    "A change that does not fit becomes a by-hand card: leave tool_slug empty and put the cause, the files and the change in the detail.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** URLs in an answer's text, without trailing punctuation, first seen first. */
export function urlsIn(text: string) {
  const found = String(text ?? "").match(/https?:\/\/[^\s)\]>"'`]+/g) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?*]+$/, "")))];
}

/** The site of a URL or a bare domain: "g2.com" for https://www.g2.com/x. */
export function domainOf(u: string) {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/** Domains cited across answers, most cited first, without the founder's own. */
export function topDomains(urls: string[], own: string, n = 8) {
  const counts = new Map<string, number>();
  for (const u of urls) {
    const d = domainOf(u);
    if (!d || (own && (d === own || d.endsWith(`.${own}`)))) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([d]) => d);
}

/** The last JSON array or object in a model reply, from a ```json block or bare. Null when there is none. */
export function lastJson(text: string): unknown {
  const blocks = [...String(text ?? "").matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  for (const b of blocks.reverse()) {
    try {
      return JSON.parse(b);
    } catch {}
  }
  const t = String(text ?? "");
  for (const open of ["[", "{"]) {
    const i = t.indexOf(open);
    const j = t.lastIndexOf(open === "[" ? "]" : "}");
    if (i >= 0 && j > i) {
      try {
        return JSON.parse(t.slice(i, j + 1));
      } catch {}
    }
  }
  return null;
}

/* Check-backs (lib/checks.ts). */

export const VERDICTS = ["baseline", "keep", "wait", "revert", "iterate"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** READING and VERDICT lines from the model's reply. */
export function parseCheck(text: string, day: number, last: boolean): { reading: string; verdict: Verdict } {
  const reading = text.match(/READING:\s*(.+)/i)?.[1]?.trim() ?? text.replace(/\s+/g, " ").trim().slice(-300);
  const said = (text.match(/VERDICT:\s*\**\s*([a-z]+)/i)?.[1] ?? "").toLowerCase() as Verdict;
  if (day === 0) return { reading: reading.slice(0, 600), verdict: "baseline" };
  const ok: Verdict[] = last ? ["keep", "revert", "iterate"] : ["keep", "wait", "revert"];
  return { reading: reading.slice(0, 600), verdict: ok.includes(said) ? said : last ? "iterate" : "wait" };
}

/* ---------------- pages already on the site ---------------- */

/** Page URLs and child sitemaps listed in one sitemap.xml (a urlset or a sitemap index). */
export function parseSitemap(xml: string) {
  const locs = [...String(xml ?? "").matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&").trim());
  return /<sitemapindex/i.test(xml) ? { urls: [] as string[], sitemaps: locs } : { urls: locs, sitemaps: [] as string[] };
}

// Words that say nothing about a page's topic. Years and numbers go too, so a 2026 copy matches the 2025 page.
const FILLER = new Set(
  "a an the and or of to for in on with your our my you how what why when is are best top ultimate complete guide new free online tool tools app apps software review reviews list".split(" "),
);

/** The topic words of a URL or file path: its last segment, without the extension, filler, numbers or plural s. */
export function slugWords(pathOrUrl: string) {
  const last = String(pathOrUrl ?? "")
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .split("/")
    .pop()!
    .replace(/\.(mdx?|markdown|html?|astro|tsx|jsx)$/i, "")
    .replace(/^index$/i, "");
  return [
    ...new Set(
      last
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
        .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)),
    ),
  ];
}

/**
 * The page already on the site that a new file would repeat, or null: the same topic words, at least 2, like
 * best-calendly-alternatives-2026 and /blog/calendly-alternatives. A narrower page (calendly-alternative-for-agencies)
 * passes. A file whose last segment is exactly a page's own is that page, an update, and returns null.
 */
export function existingPage(path: string, pages: string[]) {
  const mine = slugWords(path);
  if (mine.length < 2) return null;
  const own = String(path).replace(/\.[a-z]+$/i, "").split("/").pop()!.toLowerCase();
  for (const url of pages) {
    const seg = url.replace(/[?#].*$/, "").replace(/\/+$/, "").split("/").pop()!.toLowerCase();
    if (seg === own) return null;
  }
  for (const url of pages) {
    const theirs = slugWords(url);
    if (theirs.length === mine.length && theirs.every((w) => mine.includes(w))) return url;
  }
  return null;
}
