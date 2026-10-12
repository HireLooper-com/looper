// Pure rules for attribution and the automatic target, kept apart from the
// database so they can be tested on their own (test/attribution.test.ts).

/** One card between two readings gets the delta. Several, or no earlier reading: nobody does. */
export function attribute(doneIds: number[], prev: number | null, value: number) {
  if (doneIds.length === 1 && prev !== null) return { attributed: { id: doneIds[0], delta: value - prev }, unattributed: [] as number[] };
  return { attributed: null, unattributed: doneIds };
}

/** A target left empty at hire becomes 20% better than the first reading, kept to 2 significant digits. */
export function autoTargetFor(value: number, direction: string) {
  const raw = direction === "down" ? value * 0.8 : Math.max(value * 1.2, value + 1);
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.abs(raw) || 1)) - 1));
  return raw < 10 ? Math.round(raw * 10) / 10 : Math.round(raw / p) * p;
}
