import { test } from "node:test";
import assert from "node:assert/strict";
import { edited, HISTORY_MAX, parseNotes, pathItems, pushHistory, repoFor, repoOf, withRepo } from "../lib/brief.ts";

const NOTES = `repo: pavelk2/bookva (TimeTuna was called Bookva.ai before)

posts: none in the repo. Blog articles are WordPress.com pages, loaded through src/lib/wordpress.ts.
New articles get published in WordPress.

edit: src/app/<landing-slug>/, src/app/docs/**, src/app/sitemap.ts (new static pages must be added here by hand), public/blog/

never: src/app/api/**, schema.sql, sentry configs, .env.example, .github/workflows, scripts/, .claude/`;

test("setup notes read as one field per key, continuation lines stay with their key", () => {
  const f = parseNotes(NOTES);
  assert.deepEqual(
    f.map((x) => x.key),
    ["repo", "posts", "edit", "never"],
  );
  assert.match(f[1].text, /\nNew articles get published in WordPress\.$/);
  assert.equal(f[0].items.length, 0);
  assert.equal(f[1].items.length, 0);
});

test("path lists split into items, a bracket becomes the note, words without a path stay", () => {
  const [, , edit, never] = parseNotes(NOTES);
  assert.deepEqual(
    edit.items.map((x) => x.path),
    ["src/app/<landing-slug>/", "src/app/docs/**", "src/app/sitemap.ts", "public/blog/"],
  );
  assert.equal(edit.items[2].note, "new static pages must be added here by hand");
  assert.deepEqual(never.items[2], { path: "", note: "sentry configs" });
  assert.equal(never.items[3].path, ".env.example");
});

test("prose with commas is not a path list", () => {
  assert.deepEqual(pathItems("title, description and keywords, set in page.tsx"), []);
  assert.deepEqual(pathItems("one/path"), []);
});

test("an edit keeps the old text in history, newest first, capped", () => {
  const at = "2026-10-10T10:00:00.000Z";
  let e = edited({ status: "done", text: "v1", at }, "v2", "a@b.co", new Date("2026-10-11T10:00:00Z"));
  assert.equal(e.by, "a@b.co");
  assert.deepEqual(e.history, [{ text: "v1", at }]);
  for (let i = 3; i < 12; i++) e = edited(e, `v${i}`, "a@b.co");
  assert.equal(e.history?.length, HISTORY_MAX);
  assert.equal(e.history?.[0].text, "v10");
  assert.deepEqual(pushHistory({ status: "failed", text: "boom", at }), []);
});

test("the repo a looper ships to: picked first, then the repo line of its notes", () => {
  assert.equal(repoOf(NOTES), "pavelk2/bookva");
  assert.equal(repoOf("repo: `acme/site.git`"), "acme/site");
  assert.equal(repoOf("posts: content/blog"), "");
  const done = { status: "done" as const, text: NOTES, at: "2026-01-01T00:00:00Z" };
  assert.equal(repoFor({ repo: "acme/web", setup: { repo: done } }), "acme/web");
  assert.equal(repoFor({ repo: "", setup: { repo: done } }), "pavelk2/bookva");
  assert.equal(repoFor({ repo: "", setup: { repo: { ...done, status: "failed" } } }), "");
  assert.equal(repoFor({ repo: null, setup: null }), "");
  assert.equal(repoOf(withRepo(NOTES, "acme/web")), "acme/web");
  assert.match(withRepo(NOTES, "acme/web"), /^repo: acme\/web\n\nposts:/);
  assert.equal(withRepo("posts: blog/", "acme/web"), "repo: acme/web\nposts: blog/");
  assert.equal(withRepo(NOTES, "pavelk2/bookva"), NOTES);
});
