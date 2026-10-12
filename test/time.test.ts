import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSlot, isReflectionFriday, local, nextMonday, zoned } from "../lib/time.ts";

const AMS = "Europe/Amsterdam";
const NY = "America/New_York";

test("zoned gives the UTC instant of a wall-clock time, across DST", () => {
  assert.equal(zoned(2026, 1, 15, 9, AMS).toISOString(), "2026-01-15T08:00:00.000Z");
  assert.equal(zoned(2026, 7, 15, 9, AMS).toISOString(), "2026-07-15T07:00:00.000Z");
  assert.equal(zoned(2026, 7, 15, 9, NY).toISOString(), "2026-07-15T13:00:00.000Z");
});

test("local reads Monday as 0 and Sunday as 6", () => {
  assert.equal(local(new Date("2026-10-12T10:00:00Z"), AMS).wd, 0);
  assert.equal(local(new Date("2026-10-11T10:00:00Z"), AMS).wd, 6);
});

test("dueSlot finds today's slot within 3 hours and nothing after", () => {
  // Monday 12 Oct 2026, routine Mon 10:00 Amsterdam (08:00Z).
  const slot = dueSlot([0], 10, new Date("2026-10-12T09:30:00Z"), AMS);
  assert.equal(slot?.toISOString(), "2026-10-12T08:00:00.000Z");
  assert.equal(dueSlot([0], 10, new Date("2026-10-12T07:59:00Z"), AMS), null);
  assert.equal(dueSlot([0], 10, new Date("2026-10-12T11:01:00Z"), AMS), null);
  assert.equal(dueSlot([1], 10, new Date("2026-10-12T09:30:00Z"), AMS), null);
});

test("dueSlot catches a late-evening slot after local midnight", () => {
  // Sunday 23:00 slot, checked Monday 00:30 local.
  const slot = dueSlot([6], 23, new Date("2026-10-11T22:30:00Z"), AMS);
  assert.equal(slot?.toISOString(), "2026-10-11T21:00:00.000Z");
});

test("nextMonday is Monday 00:00 local of the following week", () => {
  assert.equal(nextMonday(new Date("2026-10-16T14:00:00Z"), AMS).toISOString(), "2026-10-18T22:00:00.000Z");
  // Called on a Monday it still means the week after.
  assert.equal(nextMonday(new Date("2026-10-12T10:00:00Z"), AMS).toISOString(), "2026-10-18T22:00:00.000Z");
});

test("reflection is every second Friday counted from the hire week", () => {
  const hired = new Date("2026-09-02T10:00:00Z"); // Wednesday, week of Mon 31 Aug
  const fri = (d: string) => isReflectionFriday(hired, new Date(`${d}T15:00:00Z`), AMS);
  assert.equal(fri("2026-09-04"), false); // hire week
  assert.equal(fri("2026-09-11"), true); // week 1
  assert.equal(fri("2026-09-18"), false);
  assert.equal(fri("2026-09-25"), true);
  assert.equal(isReflectionFriday(hired, new Date("2026-09-10T15:00:00Z"), AMS), false); // Thursday
});

test("reflection parity survives the switch from summer to winter time", () => {
  const hired = new Date("2026-09-02T10:00:00Z");
  // Clocks go back on 25 Oct 2026. Week 9 (6 Nov) and 11 (20 Nov) are reflection weeks.
  assert.equal(isReflectionFriday(hired, new Date("2026-10-30T15:00:00Z"), AMS), false);
  assert.equal(isReflectionFriday(hired, new Date("2026-11-06T15:00:00Z"), AMS), true);
  assert.equal(isReflectionFriday(hired, new Date("2026-11-20T15:00:00Z"), AMS), true);
});

test("reflection parity survives the switch from winter to summer time", () => {
  const hired = new Date("2027-02-03T10:00:00Z"); // Wednesday, week of Mon 1 Feb
  // Clocks go forward on 28 Mar 2027. Week 9 is Fri 9 Apr.
  assert.equal(isReflectionFriday(hired, new Date("2027-04-02T15:00:00Z"), AMS), false);
  assert.equal(isReflectionFriday(hired, new Date("2027-04-09T15:00:00Z"), AMS), true);
});
