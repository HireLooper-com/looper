import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDays, slotText, toTurns, type TalkRow } from "../lib/talk-turns.ts";

test("cleanDays keeps 0 to 6, once each, sorted", () => {
  assert.deepEqual(cleanDays([4, 0, 4, 7, -1, 2.5, "1"]), [0, 1, 4]);
  assert.deepEqual(cleanDays("Mon"), []);
});

test("slotText reads like the calendar", () => {
  assert.equal(slotText({ days: [0, 4], hour: 9, mode: "ask" }), "Mon, Fri 09:00, asks first");
});

test("toTurns starts on a founder turn and carries proposal status", () => {
  const rows: TalkRow[] = [
    { id: 1, role: "assistant", content: "Old reply", changes: [] },
    { id: 2, role: "user", content: "Run it on weekdays", changes: [] },
    {
      id: 3,
      role: "assistant",
      content: "Proposed weekdays.",
      changes: [{ kind: "schedule", routine_id: 7, name: "Pause keywords", from: { days: [0], hour: 9, mode: "ask" }, to: { days: [0, 1, 2, 3, 4], hour: 9, mode: "ask" }, why: "", status: "applied" }],
    },
  ];
  const turns = toTurns(rows);
  assert.equal(turns[0].role, "user");
  assert.equal(turns.length, 2);
  assert.match(turns[1].content, /Pause keywords: Mon, Tue, Wed, Thu, Fri 09:00, asks first: applied/);
});

test("toTurns keeps only the last messages", () => {
  const rows: TalkRow[] = Array.from({ length: 50 }, (_, i) => ({ id: i, role: i % 2 ? "assistant" : "user", content: String(i), changes: [] }));
  const turns = toTurns(rows, 30);
  assert.equal(turns.length, 30);
  assert.equal(turns[0].content, "20");
});
