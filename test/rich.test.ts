import { test } from "node:test";
import assert from "node:assert/strict";
import { blocks, spans } from "../lib/rich.ts";

test("spans reads bold, italic and code, and leaves the rest as text", () => {
  assert.deepEqual(spans("**Approved card:** open the PR"), [
    { t: "b", v: "Approved card:" },
    { t: "text", v: " open the PR" },
  ]);
  assert.deepEqual(spans("run `max_cards: 3` *now*"), [
    { t: "text", v: "run " },
    { t: "code", v: "max_cards: 3" },
    { t: "text", v: " " },
    { t: "i", v: "now" },
  ]);
  assert.deepEqual(spans("2 * 3 = 6, a*b"), [{ t: "text", v: "2 * 3 = 6, a*b" }]);
  assert.deepEqual(spans("<b>x</b>"), [{ t: "text", v: "<b>x</b>" }]);
});

test("blocks splits paragraphs and lists, keeps a list's start number", () => {
  const b = blocks("Four routines run.\n\n1. **Mon 12 Oct:** draft\n2. Wed 14 Oct\n   rewrite pages\n\nThat's up to 9.\nSecond line");
  assert.equal(b.length, 3);
  assert.equal(b[0].t, "p");
  assert.equal(b[1].t, "ol");
  if (b[1].t !== "ol") return;
  assert.equal(b[1].items.length, 2);
  assert.deepEqual(b[1].items[1], [{ t: "text", v: "Wed 14 Oct" }, { t: "text", v: " " }, { t: "text", v: "rewrite pages" }]);
  assert.equal(b[2].t === "p" && b[2].lines.length, 2);
  const s = blocks("3. third\n- a\n- b");
  assert.deepEqual(s.map((x) => x.t), ["ol", "ul"]);
  assert.equal(s[0].t === "ol" && s[0].start, 3);
});

test("blocks drops heading marks", () => {
  assert.deepEqual(blocks("## This week"), [{ t: "p", lines: [[{ t: "text", v: "This week" }]] }]);
});
