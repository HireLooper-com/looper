// The Brief tab reads a setup step's `key: value` notes as a page: one property per key. Pure, tested
// in test/brief.test.ts. Edits never overwrite: the old text moves into `history`.

export type SetupEntry = {
  status: "done" | "failed" | "waiting";
  text: string;
  at: string;
  by?: string; // email of the person who edited it; empty when the looper learned it
  history?: { text: string; at: string; by?: string }[];
};

export type Field = { key: string; text: string; items: { path: string; note: string }[] };

export const HISTORY_MAX = 5;

const KEY = /^([a-z][a-z0-9 _-]{0,24}):\s*(.*)$/i;
const PATHLIKE = /^[\w.@<>*\[\]-]*\/[\w./@<>*\[\]-]*$|^\.?[\w-]+(\.[\w-]+)*\.[a-z]{1,8}$/i;

/** Split on commas outside parentheses. */
function splitTop(s: string) {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * A list of paths ("src/app/**, schema.sql (by hand), sentry configs") as items, a path with its note in
 * brackets, or words with no path. Empty when the text reads as prose: fewer than half the items are paths.
 */
export function pathItems(text: string) {
  if (text.includes("\n")) return [];
  const parts = splitTop(text.replace(/\.$/, ""));
  if (parts.length < 2) return [];
  const items = parts.map((p) => {
    const m = p.match(/^(\S+)\s*(?:\((.*)\))?$/);
    const path = m?.[1].replace(/`/g, "") ?? "";
    return m && PATHLIKE.test(path) ? { path, note: m[2] ?? "" } : { path: "", note: p };
  });
  return items.filter((x) => x.path).length * 2 >= items.length ? items : [];
}

/** `key: value` lines into fields; lines without a key continue the field above. */
export function parseNotes(text: string): Field[] {
  const fields: { key: string; lines: string[] }[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^\s*[-*]\s+/, "").trimEnd();
    const m = line.match(KEY);
    if (m && !/^https?$/i.test(m[1])) fields.push({ key: m[1].trim(), lines: [m[2]] });
    else if (fields.length) fields[fields.length - 1].lines.push(line);
    else if (line.trim()) fields.push({ key: "", lines: [line] });
  }
  return fields.map((f) => {
    const t = f.lines.join("\n").trim();
    return { key: f.key, text: t, items: pathItems(t) };
  });
}

/** The entry after a person edits it: the previous text goes into history, newest first. */
export function edited(prev: SetupEntry | undefined, text: string, by: string, at = new Date()): SetupEntry {
  return { status: "done", text, at: at.toISOString(), by, history: pushHistory(prev) };
}

/** History with `prev` added on top, when it had text worth keeping. */
export function pushHistory(prev: SetupEntry | undefined) {
  const old = prev?.history ?? [];
  if (!prev || prev.status !== "done" || !prev.text) return old;
  return [{ text: prev.text, at: prev.at, ...(prev.by ? { by: prev.by } : {}) }, ...old].slice(0, HISTORY_MAX);
}

const REPO_NAME = /\b([\w.-]+\/[\w.-]+)\b/;

/** The `owner/name` on a `repo:` line of setup notes, or "". */
export function repoOf(text: string) {
  const f = parseNotes(text ?? "").find((x) => x.key.toLowerCase() === "repo");
  return f?.text.replace(/`/g, "").match(REPO_NAME)?.[1].replace(/\.git$/, "") ?? "";
}

/**
 * The one repository a looper may open pull requests in: the one a person picked, else the `repo:`
 * line of its notes from hire, which a person can read and correct on the Brief tab. "" means none yet.
 */
export function repoFor(l: { repo?: string | null; setup?: Record<string, SetupEntry> | null }) {
  if (l.repo) return l.repo;
  const st = l.setup?.repo;
  return st?.status === "done" ? repoOf(st.text) : "";
}

/** Notes with their `repo:` line set to `repo`: replaced where there is one, first line where not. */
export function withRepo(text: string, repo: string) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^\s*(?:[-*]\s+)?repo:/i.test(l));
  if (i < 0) return [`repo: ${repo}`, ...lines].join("\n").trim();
  if (repoOf(lines[i]) === repo) return text;
  lines[i] = `repo: ${repo}`;
  return lines.join("\n");
}
