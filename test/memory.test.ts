import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanNote, expiryFrom, memoryStore } from "../lib/memory-store.ts";

test("cleanNote keeps one trimmed line of at most 500 characters", () => {
  assert.equal(cleanNote("  we  don't\ntarget enterprise "), "we don't target enterprise");
  assert.equal(cleanNote("x".repeat(600)).length, 500);
  assert.throws(() => cleanNote("   "));
});

test("notes expire 90 days after they are saved", () => {
  assert.equal(expiryFrom(new Date("2026-10-10T12:00:00Z")), "2027-01-08");
});

test("only lib/memory-store.ts queries the memory tables", () => {
  const touches = /\b(from|into|update|join)\s+(notes|ledger)\b/i;
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(name) && p !== join("lib", "memory-store.ts") && touches.test(readFileSync(p, "utf8"))) found.push(p);
    }
  };
  // scripts/ is absent from the open source export.
  for (const dir of ["lib", "app", "scripts"]) if (existsSync(dir)) walk(dir);
  assert.deepEqual(found, []);
});

// Isolation against a real Postgres. Point TEST_DATABASE_URL at a throwaway database, never production:
// TEST_DATABASE_URL=postgres://localhost/looper_test npm test
const url = process.env.TEST_DATABASE_URL;

test("a workspace never sees or changes another workspace's memory", { skip: !url && "set TEST_DATABASE_URL to run" }, async () => {
  process.env.DATABASE_URL = url;
  const { sql } = await import("../lib/db.ts");
  const { notes, ledger } = memoryStore(sql);
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  async function workspace(name: string) {
    const [u] = await sql<{ id: number }>`insert into users (email) values (${`${name}-${tag}@test.local`}) returning id`;
    const [w] = await sql<{ id: number }>`insert into workspaces (owner_id, name) values (${u.id}, ${name}) returning id`;
    await sql`insert into members (workspace_id, user_id, role) values (${w.id}, ${u.id}, 'owner')`;
    const [l] = await sql<{ id: number }>`
      insert into loopers (user_id, workspace_id, role, name, metric_name, metric_source, target_date)
      values (${u.id}, ${w.id}, 'seo', 'SEO', 'Clicks', 'google_search_console', '2027-01-01') returning id`;
    const [c] = await sql<{ id: number }>`insert into cards (looper_id, title) values (${l.id}, 'Rewrite 3 titles') returning id`;
    return { user: u.id, ws: w.id, looper: l.id, card: c.id };
  }
  const a = await workspace("a");
  const b = await workspace("b");

  try {
    // Notes: A writes, B reads nothing, B cannot change or supersede A's note.
    const shared = await notes.add(a.ws, { looperId: null, text: "We don't target enterprise", sourceKind: "talk", approvedBy: a.user });
    const own = await notes.add(a.ws, { looperId: a.looper, text: "Never name Calendly", sourceKind: "reflection", approvedBy: a.user });
    assert.deepEqual((await notes.live(a.ws, a.looper)).map((n) => n.id).sort(), [shared.id, own.id].sort());
    assert.deepEqual(await notes.live(b.ws, b.looper), []);
    assert.deepEqual(await notes.live(b.ws, a.looper), []);
    assert.deepEqual(await notes.all(b.ws), []);
    assert.equal(await notes.remove(b.ws, own.id), false);
    assert.equal(await notes.keep(b.ws, own.id), false);
    await assert.rejects(notes.add(b.ws, { looperId: null, text: "x", sourceKind: "talk", approvedBy: b.user, supersedes: own.id }));

    // A note needs an approver from the workspace and a looper from the workspace.
    await assert.rejects(notes.add(a.ws, { looperId: null, text: "x", sourceKind: "talk", approvedBy: b.user }));
    await assert.rejects(notes.add(b.ws, { looperId: a.looper, text: "x", sourceKind: "talk", approvedBy: b.user }));

    // Superseding keeps the old row with its status.
    const edit = await notes.add(a.ws, { looperId: a.looper, text: "Never name Calendly or Cal.com", sourceKind: "talk", approvedBy: a.user, supersedes: own.id });
    const all = await notes.all(a.ws);
    assert.equal(all.find((n) => n.id === own.id)?.status, "superseded");
    assert.equal(all.find((n) => n.id === edit.id)?.supersedes, own.id);
    assert.ok(!(await notes.live(a.ws, a.looper)).some((n) => n.id === own.id));

    // Expired notes leave the live set.
    const old = await notes.add(a.ws, { looperId: null, text: "Old fact", sourceKind: "settings", approvedBy: a.user, expiresOn: "2020-01-01" });
    assert.ok(!(await notes.live(a.ws, a.looper)).some((n) => n.id === old.id));
    assert.ok((await notes.expireDue()) >= 1);
    assert.equal((await notes.all(a.ws)).find((n) => n.id === old.id)?.status, "expired");

    // Ledger: same key in both workspaces stays separate; B cannot write into A's looper or link A's card.
    await ledger.upsert(a.ws, a.looper, "page", "/pricing", { clicks: 412 });
    await ledger.upsert(b.ws, b.looper, "page", "/pricing", { clicks: 7 });
    assert.equal((await ledger.get(a.ws, a.looper, "page", "/pricing"))?.data.clicks, 412);
    assert.equal(await ledger.get(b.ws, a.looper, "page", "/pricing"), null);
    assert.deepEqual(await ledger.find(b.ws, a.looper, "page"), []);
    await assert.rejects(ledger.upsert(b.ws, a.looper, "page", "/pricing", { clicks: 0 }));
    await assert.rejects(ledger.upsert(b.ws, a.looper, "page", "/new", { clicks: 0 }));
    assert.equal((await ledger.get(a.ws, a.looper, "page", "/pricing"))?.data.clicks, 412);
    assert.equal(await ledger.setStatus(b.ws, a.looper, "page", "/pricing", "dropped"), null);
    await assert.rejects(ledger.setStatus(b.ws, b.looper, "page", "/pricing", "carded", a.card));

    // Status moves keep the card, and a new read keeps the status.
    assert.equal((await ledger.setStatus(a.ws, a.looper, "page", "/pricing", "carded", a.card))?.card_id, a.card);
    await ledger.upsert(a.ws, a.looper, "page", "/pricing", { clicks: 430 });
    const row = await ledger.get(a.ws, a.looper, "page", "/pricing");
    assert.equal(row?.status, "carded");
    assert.equal(row?.card_id, a.card);
    assert.equal((await ledger.find(a.ws, a.looper, "page", "pric")).length, 1);
    assert.equal((await ledger.find(a.ws, a.looper, "page", "%")).length, 0);
  } finally {
    // Deleting a workspace deletes its memory.
    for (const w of [a, b]) await sql`delete from users where id = ${w.user}`;
    assert.deepEqual(await sql`select id from notes where workspace_id in (${a.ws}, ${b.ws})`, []);
    assert.deepEqual(await sql`select id from ledger where workspace_id in (${a.ws}, ${b.ws})`, []);
  }
});
