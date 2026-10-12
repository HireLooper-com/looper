// Pages ship as pull requests: a branch, one commit per file, a PR. The founder reads the Vercel
// preview and merges; the merge is when the card is done. Undo is another PR that puts the old
// files back. Every call goes through `gh`, a GitHub REST request on the workspace's connected
// GitHub account (lib/tools.ts githubFor, Composio proxy), so tests can pass a fake.

import { applyEdits, prProblems, writable, type Edit } from "./spec.ts";
import type { PrLimits } from "./roles.ts";

export type Gh = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<any>;

/** The tool slug a github_pr card carries. Not a Composio tool: executeCard routes it here. */
export const PR_SLUG = "LOOPER_GITHUB_PR";

export type PrFile = { path: string; content?: string | null; edits?: Edit[] };
export type PrArgs = { repo: string; title: string; body?: string; files: PrFile[] };
export type Pr = { repo: string; number: number; url: string; branch: string; previous: PrFile[] };

const REPO = /^[\w.-]+\/[\w.-]+$/;

export function checkRepo(repo: string) {
  if (!REPO.test(String(repo ?? ""))) throw new Error(`Not a repository name: ${repo}`);
  return repo;
}

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const unb64 = (s: string) => Buffer.from(String(s ?? "").replace(/\n/g, ""), "base64").toString("utf8");

/** Branch name from a title: looper/rewrite-3-titles-k2x9. */
export function branchFor(title: string, now = Date.now()) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `looper/${slug || "change"}-${now.toString(36).slice(-4)}`;
}

/** Repositories the account can push to, most recently pushed first. */
export async function repos(gh: Gh) {
  const rows = (await gh("GET", "/user/repos?sort=pushed&per_page=30")) as { full_name: string; homepage: string | null; permissions?: { push?: boolean } }[];
  return rows.filter((r) => r.permissions?.push !== false).map((r) => ({ repo: r.full_name, homepage: r.homepage ?? "" }));
}

export async function defaultBranch(gh: Gh, repo: string) {
  const r = await gh("GET", `/repos/${checkRepo(repo)}`);
  return String(r.default_branch || "main");
}

/** File paths on the default branch, at most `limit`, skipping dependencies and build output. */
export async function tree(gh: Gh, repo: string, limit = 500) {
  const branch = await defaultBranch(gh, repo);
  const t = await gh("GET", `/repos/${checkRepo(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return ((t.tree ?? []) as { path: string; type: string }[])
    .filter((x) => x.type === "blob" && !/(^|\/)(node_modules|\.next|dist|build|out|\.git|vendor)\//.test(x.path))
    .map((x) => x.path)
    .slice(0, limit);
}

/** A file's text and sha on `ref` (the default branch when empty), or null when it does not exist. */
export async function file(gh: Gh, repo: string, path: string, ref = ""): Promise<{ content: string; sha: string } | null> {
  try {
    const f = await gh("GET", `/repos/${checkRepo(repo)}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`);
    if (Array.isArray(f) || f.type !== "file") return null;
    return { content: unb64(f.content), sha: f.sha };
  } catch (e) {
    if (/\b404\b/.test((e as Error).message)) return null;
    throw e;
  }
}

/**
 * Open a pull request with the files. A file has `content` (the whole new file, null deletes it)
 * or `edits` (find and replace in the current file). Returns the PR and the files as they were,
 * which is the undo. `rules` are the role's limits; an undo passes none, since it puts whole files back.
 */
export async function openPR(gh: Gh, a: PrArgs, rules: { writePaths?: string; pr?: PrLimits } = {}): Promise<Pr> {
  const repo = checkRepo(a.repo);
  if (!a.files?.length) throw new Error("The pull request has no files");
  for (const f of a.files) if (!writable(f.path, rules.writePaths)) throw new Error(`The looper may not write ${f.path}`);
  const problems = prProblems(a.files, rules.pr);
  if (problems.length) throw new Error(`The pull request does not fit the role's limits: ${problems.join("; ")}`);
  const base = await defaultBranch(gh, repo);
  const ref = await gh("GET", `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const branch = branchFor(a.title);
  await gh("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.object.sha });

  const previous: PrFile[] = [];
  for (const f of a.files) {
    const cur = await file(gh, repo, f.path, branch);
    if (rules.pr?.editsOnly && cur && !f.edits?.length) throw new Error(`Change ${f.path} with edits, not the whole file`);
    previous.push({ path: f.path, content: cur ? cur.content : null });
    const next = f.edits?.length ? applyEdits(cur?.content ?? "", f.edits) : f.content ?? null;
    const message = `${a.title}: ${f.path}`;
    if (next === null) {
      if (cur) await gh("DELETE", `/repos/${repo}/contents/${enc(f.path)}`, { message, sha: cur.sha, branch });
    } else if (next !== cur?.content) {
      await gh("PUT", `/repos/${repo}/contents/${enc(f.path)}`, { message, content: b64(next), branch, ...(cur ? { sha: cur.sha } : {}) });
    }
  }
  const pr = await gh("POST", `/repos/${repo}/pulls`, { title: a.title.slice(0, 200), head: branch, base, body: a.body ?? "" });
  return { repo, number: pr.number, url: pr.html_url, branch, previous };
}

/** CI on a commit: none when nothing reports, pending while anything runs, failure when anything failed. */
export type Ci = "success" | "failure" | "pending" | "none";
export type PrState = { state: "open" | "merged" | "closed"; mergedAt: string | null; mergeSha?: string; ci?: Ci };

export function ciOf(runs: { status: string; conclusion: string | null }[], statuses: { state: string }[]): Ci {
  const failed = new Set(["failure", "timed_out", "action_required", "startup_failure"]);
  if (runs.some((r) => r.conclusion && failed.has(r.conclusion)) || statuses.some((s) => s.state === "failure" || s.state === "error")) return "failure";
  if (runs.some((r) => r.status !== "completed") || statuses.some((s) => s.state === "pending")) return "pending";
  return runs.length || statuses.length ? "success" : "none";
}

export async function prState(gh: Gh, repo: string, n: number): Promise<PrState> {
  const pr = await gh("GET", `/repos/${checkRepo(repo)}/pulls/${n}`);
  if (pr.merged_at) {
    const sha = String(pr.merge_commit_sha ?? "");
    const [runs, status] = sha
      ? await Promise.all([gh("GET", `/repos/${repo}/commits/${sha}/check-runs?per_page=100`), gh("GET", `/repos/${repo}/commits/${sha}/status`)])
      : [{}, {}];
    return { state: "merged", mergedAt: pr.merged_at, mergeSha: sha, ci: ciOf(runs?.check_runs ?? [], status?.statuses ?? []) };
  }
  return { state: pr.state === "closed" ? "closed" : "open", mergedAt: null };
}

/** Close an open pull request without merging, with a comment saying why. */
export async function closePR(gh: Gh, repo: string, n: number, why: string) {
  await gh("POST", `/repos/${checkRepo(repo)}/issues/${n}/comments`, { body: why });
  await gh("PATCH", `/repos/${repo}/pulls/${n}`, { state: "closed" });
}

/** Read tools for the model: list repositories, list files, read one file. Read only. */
export function readTools(gh: Gh) {
  return [
    {
      name: "github_repos",
      description: "Repositories the connected GitHub account can push to, most recently pushed first, with their homepage.",
      schema: { type: "object", properties: {} },
      run: () => repos(gh),
    },
    {
      name: "github_files",
      description: "File paths on the default branch of a repository (owner/name).",
      schema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
      run: (i: Record<string, unknown>) => tree(gh, String(i.repo)),
    },
    {
      name: "github_read",
      description: "The text of one file on the default branch, 20,000 characters at most. For a long file, pass from_line to read on from a line (1 is the first).",
      schema: {
        type: "object",
        properties: { repo: { type: "string" }, path: { type: "string" }, from_line: { type: "number" } },
        required: ["repo", "path"],
      },
      run: async (i: Record<string, unknown>) => {
        const f = await file(gh, String(i.repo), String(i.path));
        if (!f) return { error: "no such file" };
        const lines = f.content.split("\n");
        const from = Math.max(1, Math.floor(Number(i.from_line) || 1));
        const text = lines.slice(from - 1).join("\n");
        if (text.length <= 20000 && from === 1) return text;
        const shown = text.slice(0, 20000);
        const last = from + shown.split("\n").length - 1;
        return `[lines ${from} to ${last} of ${lines.length}${last < lines.length ? `; pass from_line ${last} to read on` : ""}]\n${shown}`;
      },
    },
  ];
}
