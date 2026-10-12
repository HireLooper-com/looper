import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_KINDS, ROLES } from "../lib/roles.ts";
import {
  applyEdits,
  existingPage,
  parseSitemap,
  slugWords,
  changedLines,
  dueChecks,
  guard,
  lastJson,
  limitsOf,
  parseCheck,
  prProblems,
  routineFrom,
  setupOf,
  subjectKey,
  topDomains,
  urlsIn,
  writable,
} from "../lib/spec.ts";
import { branchFor, ciOf, openPR, type Gh } from "../lib/publish.ts";

const seo = ROLES.find((r) => r.id === "seo")!;
const bugs = ROLES.find((r) => r.id === "bugs")!;

test("every role spec is consistent: inputs are signals, actions are allowed, checks start at day 0 or later", () => {
  for (const r of ROLES) {
    const kinds = new Set((r.signals ?? []).map((s) => s.kind));
    for (const p of r.routines) {
      if (p.input) assert.ok(kinds.has(p.input), `${r.id}/${p.slug} reads ${p.input}, which is not a signal`);
      if (p.action) assert.ok(ACTION_KINDS.includes(p.action), `${r.id}/${p.slug} action ${p.action}`);
      if (p.action === "github_pr") assert.ok(r.actions?.includes("github_pr"), `${r.id} must allow github_pr`);
    }
    for (const k of r.evidence ?? []) assert.ok(kinds.has(k), `${r.id} matches against ${k}, which is not a signal`);
    for (const d of r.check?.days ?? []) assert.ok(d >= 0);
    if (r.limits?.writePaths) assert.doesNotThrow(() => new RegExp(r.limits!.writePaths!));
  }
});

test("the SEO looper ships pages to GitHub, not a CMS", () => {
  assert.deepEqual(seo.tools, ["google_search_console", "github"]);
  assert.ok(seo.routines.length >= 4);
  assert.ok(seo.routines.every((p) => p.action === "github_pr" && p.tool === "github"));
  assert.ok(!JSON.stringify(seo).match(/webflow|wordpress/i));
});

test("a routine takes the role's check unless it has its own", () => {
  const x = routineFrom(seo, seo.routines[0]);
  assert.deepEqual(x, {
    input: "query",
    action: "github_pr",
    check_days: [0, 14, 28],
    check_read: seo.check!.read,
    check_tool: "google_search_console",
  });
  assert.deepEqual(routineFrom(undefined, { tool: "hubspot" }), { input: "", action: "tool", check_days: [], check_read: "", check_tool: "hubspot" });
});

test("subjects lock across spellings", () => {
  assert.equal(subjectKey("https://www.site.com/Blog/X/"), "blog/x");
  assert.equal(subjectKey("/blog/x"), "blog/x");
  assert.equal(subjectKey("content/blog/x.mdx"), "content/blog/x.mdx");
});

test("guard drops locked subjects, repeats in one run and cards over the weekly cap", () => {
  const limits = limitsOf(seo);
  const d = (title: string, subject: string, kind: "github_pr" | "manual" = "github_pr") => ({ title, subject, kind });
  const { keep, dropped } = guard(
    [d("a", "content/a.mdx"), d("b", "/content/B.mdx"), d("b again", "content/b.mdx"), d("c", "content/c.mdx"), d("d", "content/d.mdx"), d("note", "", "manual")],
    { locked: new Set(["content/a.mdx"]), used: { github_pr: 2 }, limits, mode: "ask" },
  );
  assert.deepEqual(
    keep.map((k) => k.title),
    ["b", "c", "note"],
  );
  assert.deepEqual(
    dropped.map((x) => x.title),
    ["a", "b again", "d"],
  );
  assert.ok(keep.every((k) => k.status === "proposed"));
});

test("guard runs cards alone only in auto mode and never for always-ask kinds", () => {
  const limits = { cooldownDays: 1, perWeek: {}, alwaysAsk: ["tool" as const] };
  const { keep } = guard(
    [
      { title: "send", subject: "", kind: "tool" as const },
      { title: "pr", subject: "", kind: "github_pr" as const },
    ],
    { locked: new Set(), used: {}, limits, mode: "auto" },
  );
  assert.deepEqual(
    keep.map((k) => k.status),
    ["proposed", "approved"],
  );
});

test("check days come due after the card is done, once each", () => {
  const done = new Date("2026-10-01T10:00:00Z");
  assert.deepEqual(dueChecks(done, [0, 14, 28], [], new Date("2026-10-01T10:00:00Z")), [0]);
  assert.deepEqual(dueChecks(done, [0, 14, 28], [0], new Date("2026-10-10T10:00:00Z")), []);
  assert.deepEqual(dueChecks(done, [0, 14, 28], [0], new Date("2026-10-15T10:00:00Z")), [14]);
  assert.deepEqual(dueChecks(done, [0, 14, 28], [], new Date("2026-11-01T10:00:00Z")), [0, 14, 28]);
});

test("check verdicts fit the day", () => {
  assert.deepEqual(parseCheck("READING: clicks 40, ctr 2.1%\nVERDICT: keep", 0, false), { reading: "clicks 40, ctr 2.1%", verdict: "baseline" });
  assert.equal(parseCheck("READING: clicks 60\nVERDICT: **keep**", 14, false).verdict, "keep");
  assert.equal(parseCheck("READING: clicks 60\nVERDICT: iterate", 14, false).verdict, "wait");
  assert.equal(parseCheck("READING: clicks 60\nVERDICT: wait", 28, true).verdict, "iterate");
  assert.equal(parseCheck("READING: clicks 20\nVERDICT: revert", 28, true).verdict, "revert");
});

test("the looper never writes CI, secrets, lockfiles or paths outside the spec", () => {
  const w = seo.limits!.writePaths;
  assert.ok(writable("content/blog/new.mdx", w));
  assert.ok(writable("app/pricing/page.tsx", w));
  for (const p of [".github/workflows/x.yml", ".env.local", "package.json", "../x.md", "/etc/x.md", "a//b.md", "next.config.ts", "lib/db.ts", "public/logo.png"])
    assert.ok(!writable(p, w), p);
});

test("edits replace text that occurs exactly once", () => {
  assert.equal(applyEdits("title: Old\nbody", [{ find: "title: Old", replace: "title: New" }]), "title: New\nbody");
  assert.throws(() => applyEdits("a a", [{ find: "a", replace: "b" }]), /more than once/);
  assert.throws(() => applyEdits("abc", [{ find: "x", replace: "y" }]), /not found/);
});

test("cited URLs and domains, without the founder's own", () => {
  assert.deepEqual(urlsIn("See https://g2.com/x. and (https://www.capterra.com/y)"), ["https://g2.com/x", "https://www.capterra.com/y"]);
  assert.deepEqual(topDomains(["https://g2.com/a", "https://www.g2.com/b", "https://cal.com", "https://timetuna.com/x", "https://blog.timetuna.com"], "timetuna.com"), [
    "g2.com",
    "cal.com",
  ]);
});

test("the last JSON in a reply, fenced or bare", () => {
  assert.deepEqual(lastJson('Found these.\n```json\n[{"key":"a"}]\n```'), [{ key: "a" }]);
  assert.deepEqual(lastJson('rows: [{"key":"b","clicks":3}] done'), [{ key: "b", clicks: 3 }]);
  assert.equal(lastJson("nothing here"), null);
});

test("openPR branches, commits each file, opens the PR and keeps the old files for undo", async () => {
  const files: Record<string, string> = { "content/a.mdx": "title: Old\nbody" };
  const calls: string[] = [];
  const gh: Gh = async (method, path, body: any) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    if (method === "GET" && path === "/repos/acme/site") return { default_branch: "main" };
    if (method === "GET" && path === "/repos/acme/site/git/ref/heads/main") return { object: { sha: "base" } };
    if (method === "POST" && path === "/repos/acme/site/git/refs") return {};
    if (method === "GET" && path.startsWith("/repos/acme/site/contents/")) {
      const p = decodeURIComponent(path.slice("/repos/acme/site/contents/".length).split("?")[0]);
      if (!(p in files)) throw new Error("404: Not Found");
      return { type: "file", sha: `sha-${p}`, content: Buffer.from(files[p]).toString("base64") };
    }
    if (method === "PUT") {
      const p = decodeURIComponent(path.slice("/repos/acme/site/contents/".length));
      files[p] = Buffer.from(body.content, "base64").toString("utf8");
      return {};
    }
    if (method === "POST" && path === "/repos/acme/site/pulls") return { number: 7, html_url: "https://github.com/acme/site/pull/7" };
    throw new Error(`unexpected ${method} ${path}`);
  };
  const pr = await openPR(
    gh,
    {
      repo: "acme/site",
      title: "Rewrite title on pricing",
      files: [
        { path: "content/a.mdx", edits: [{ find: "title: Old", replace: "title: New" }] },
        { path: "content/b.mdx", content: "# New page" },
      ],
    },
    { writePaths: seo.limits!.writePaths },
  );
  assert.equal(pr.url, "https://github.com/acme/site/pull/7");
  assert.equal(files["content/a.mdx"], "title: New\nbody");
  assert.equal(files["content/b.mdx"], "# New page");
  assert.deepEqual(pr.previous, [
    { path: "content/a.mdx", content: "title: Old\nbody" },
    { path: "content/b.mdx", content: null },
  ]);
  assert.ok(calls.includes("POST /repos/acme/site/pulls"));
  await assert.rejects(openPR(gh, { repo: "acme/site", title: "x", files: [{ path: ".github/workflows/a.yml", content: "" }] }), /may not write/);
  await assert.rejects(openPR(gh, { repo: "not a repo", title: "x", files: [{ path: "a.md", content: "" }] }), /Not a repository/);
});

test("bug fixes write application code and tests, never migrations, config or generated code", () => {
  const w = bugs.limits!.writePaths;
  for (const p of ["lib/booking.ts", "app/book/page.tsx", "test/booking.test.ts", "src/api/users.py"]) assert.ok(writable(p, w), p);
  for (const p of ["db/migrations/001.sql", "prisma/migrations/x/a.ts", "src/generated/api.ts", "package.json", "next.config.ts", "README.md", "public/a.png"])
    assert.ok(!writable(p, w), p);
});

test("lines changed ignore what the two texts share", () => {
  assert.equal(changedLines("a\nb\nc", "a\nB\nc"), 2);
  assert.equal(changedLines("a\nb", "a\nb\nc\nd"), 2);
  assert.equal(changedLines("", "x\ny"), 2);
  assert.equal(changedLines("same", "same"), 0);
});

test("a bug fix pull request is small, edits existing code and carries a test", () => {
  const pr = bugs.limits!.pr!;
  const fix = { path: "lib/booking.ts", edits: [{ find: "const d = slot.start\nreturn d", replace: "const d = slot?.start ?? now\nreturn d" }] };
  const t = { path: "test/booking.test.ts", content: "test('slot', () => {})\n".repeat(80) };
  assert.deepEqual(prProblems([fix, t], pr), []);
  assert.match(prProblems([fix], pr).join(), /no regression test/);
  assert.match(prProblems([t], pr).join(), /no application code/);
  assert.match(prProblems([fix, { path: "lib/a.ts", edits: [] }, { path: "lib/b.ts", content: "x" }, t], pr).join(), /3 files, over 2/);
  assert.match(prProblems([{ path: "lib/new.ts", content: "x\n".repeat(70) }, t], pr).join(), /lines, over 60/);
  assert.match(prProblems([{ path: "lib/old.ts", content: null }, t], pr).join(), /deletes a file/);
  assert.deepEqual(prProblems([{ path: "content/a.mdx", content: "x" }], seo.limits!.pr), []);
});

test("openPR keeps a bug fix to edits on existing files", async () => {
  const gh: Gh = async (method, path) => {
    if (path === "/repos/acme/app") return { default_branch: "main" };
    if (path.endsWith("/git/ref/heads/main")) return { object: { sha: "base" } };
    if (method === "POST" && path.endsWith("/git/refs")) return {};
    if (method === "GET" && path.includes("/contents/lib/booking.ts")) return { type: "file", sha: "s", content: Buffer.from("old").toString("base64") };
    if (method === "GET" && path.includes("/contents/")) throw new Error("404: Not Found");
    throw new Error(`unexpected ${method} ${path}`);
  };
  const files = [
    { path: "lib/booking.ts", content: "rewritten" },
    { path: "test/booking.test.ts", content: "test" },
  ];
  await assert.rejects(openPR(gh, { repo: "acme/app", title: "Fix slot", files }, bugs.limits), /with edits, not the whole file/);
  await assert.rejects(openPR(gh, { repo: "acme/app", title: "Fix slot", files: files.slice(0, 1) }, bugs.limits), /no regression test/);
});

test("CI on the merge commit", () => {
  assert.equal(ciOf([], []), "none");
  assert.equal(ciOf([{ status: "completed", conclusion: "success" }], [{ state: "success" }]), "success");
  assert.equal(ciOf([{ status: "in_progress", conclusion: null }], []), "pending");
  assert.equal(ciOf([{ status: "completed", conclusion: "skipped" }], [{ state: "pending" }]), "pending");
  assert.equal(ciOf([{ status: "completed", conclusion: "failure" }, { status: "queued", conclusion: null }], []), "failure");
  assert.equal(ciOf([], [{ state: "error" }]), "failure");
});

test("branch names are short and safe", () => {
  assert.match(branchFor("Rewrite 3 titles on page 2 results!", 1_700_000_000_000), /^looper\/rewrite-3-titles-on-page-2-results-[a-z0-9]{4}$/);
});

test("a looper learns where the site's pages live once a routine opens pull requests, and only once", () => {
  const custom = ROLES.find((r) => r.id === "custom")!;
  assert.deepEqual(setupOf(custom, ["tool", "manual"]), []);
  assert.deepEqual(setupOf(custom, ["tool", "github_pr"]).map((s) => s.id), ["repo"]);
  assert.ok(custom.actions?.includes("github_pr"), "your own looper can open pull requests");
  // SEO has the step already: no second copy.
  assert.deepEqual(setupOf(seo, ["github_pr"]).map((s) => s.id), ["repo"]);
  assert.deepEqual(setupOf(undefined, []), []);
});

test("a sitemap lists pages, a sitemap index lists sitemaps", () => {
  const set = `<?xml version="1.0"?><urlset><url><loc>https://timetuna.com/</loc></url><url><loc> https://timetuna.com/blog/calendly-alternatives </loc></url><url><loc><![CDATA[https://timetuna.com/a?x=1&amp;y=2]]></loc></url></urlset>`;
  assert.deepEqual(parseSitemap(set), { urls: ["https://timetuna.com/", "https://timetuna.com/blog/calendly-alternatives", "https://timetuna.com/a?x=1&y=2"], sitemaps: [] });
  const index = `<sitemapindex><sitemap><loc>https://timetuna.com/sitemap-0.xml</loc></sitemap></sitemapindex>`;
  assert.deepEqual(parseSitemap(index), { urls: [], sitemaps: ["https://timetuna.com/sitemap-0.xml"] });
  assert.deepEqual(parseSitemap("not xml"), { urls: [], sitemaps: [] });
});

test("a new page that repeats one on the site is caught by its topic words", () => {
  const pages = ["https://timetuna.com/", "https://timetuna.com/blog/calendly-alternatives", "https://timetuna.com/blog/booking-page-for-teams/", "https://timetuna.com/pricing"];
  assert.deepEqual(slugWords("content/blog/best-calendly-alternatives-2026.mdx"), ["calendly", "alternative"]);
  assert.equal(existingPage("content/blog/best-calendly-alternatives-2026.mdx", pages), "https://timetuna.com/blog/calendly-alternatives");
  assert.equal(existingPage("content/blog/the-booking-pages-for-team.md", pages), "https://timetuna.com/blog/booking-page-for-teams/");
  // Narrower or different topics pass, and so does the page's own file (an update).
  assert.equal(existingPage("content/blog/calendly-alternative-for-agencies.mdx", pages), null);
  assert.equal(existingPage("content/blog/calendly-vs-cal-com.mdx", pages), null);
  assert.equal(existingPage("content/blog/calendly-alternatives.mdx", pages), null);
  // One topic word is too little to call it a repeat.
  assert.equal(existingPage("content/pricing-2026.mdx", pages), null);
});

test("the VAT looper books one bank transaction at a time and only reads Gmail and Stripe", () => {
  const vat = ROLES.find((r) => r.id === "vat_nl")!;
  assert.equal(vat.group, "Operations");
  assert.equal(vat.subject?.kind, "transaction");
  assert.deepEqual(vat.tools, ["googledrive", "gmail", "stripe"]);
  assert.deepEqual(vat.evidence, ["invoice", "payout"]);
  assert.ok(vat.routines.every((p) => p.input === "transaction"));
  // Only Drive is written to, and only after approval.
  assert.ok(vat.routines.filter((p) => p.action === "tool").every((p) => p.tool === "googledrive"));
  assert.deepEqual(vat.limits?.alwaysAsk, ["tool"]);
  const old = ROLES.find((r) => r.id === "accounting")!;
  assert.equal(old.live, false);
  assert.equal(old.group, null);
});
