import { test } from "node:test";
import assert from "node:assert/strict";
import { attribute, autoTargetFor } from "../lib/attribution.ts";

test("one card between two readings gets the delta", () => {
  assert.deepEqual(attribute([7], 3.1, 3.4).attributed?.id, 7);
  assert.ok(Math.abs(attribute([7], 3.1, 3.4).attributed!.delta - 0.3) < 1e-9);
});

test("several cards, or no earlier reading, are unattributed", () => {
  assert.deepEqual(attribute([1, 2], 10, 12), { attributed: null, unattributed: [1, 2] });
  assert.deepEqual(attribute([1], null, 12), { attributed: null, unattributed: [1] });
  assert.deepEqual(attribute([], 10, 12), { attributed: null, unattributed: [] });
});

test("automatic target is 20% better, 2 significant digits", () => {
  assert.equal(autoTargetFor(3120, "up"), 3700);
  assert.equal(autoTargetFor(3.1, "up"), 4.1); // +1 beats +20% for small values
  assert.equal(autoTargetFor(23, "down"), 18);
  assert.equal(autoTargetFor(0, "up"), 1);
});
