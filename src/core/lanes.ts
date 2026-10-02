import type { Section } from "./model";

/** Half-open overlap: sections that merely touch (a.end === b.start) do not overlap. */
function overlaps(a: { start: number; length: number }, b: { start: number; length: number }): boolean {
  return a.start < b.start + b.length && b.start < a.start + a.length;
}

/**
 * Lowest lane not used by any of `others` overlapping `s`. Lanes are the `row` field.
 * Insert path: call with the track's existing sections; other sections keep their rows.
 */
export function firstFreeLane(s: { start: number; length: number }, others: readonly Section[]): number {
  const used = new Set<number>();
  for (const o of others) if (overlaps(s, o)) used.add(o.row);
  let lane = 0;
  while (used.has(lane)) lane++;
  return lane;
}

/** Returns `section` with `row` set to the first free lane among `existing` (excluding its own id). */
export function placeSection<T extends Section>(section: T, existing: readonly Section[]): T {
  const row = firstFreeLane(section, existing.filter((o) => o.id !== section.id));
  return row === section.row ? section : { ...section, row };
}

/**
 * Recompute all lanes for one track (use after move/trim/delete). Greedy by start beat; ties
 * keep the previous lane order, then input order, so untouched non-overlapping sections stay
 * in lane 0 and results are deterministic. Pure: input order and objects are preserved
 * (unchanged sections are returned by reference).
 */
export function assignLanes<T extends Section>(sections: readonly T[]): T[] {
  const order = sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.start - b.s.start || a.s.row - b.s.row || a.i - b.i);
  const placed: Section[] = [];
  const rows = new Map<number, number>();
  for (const { s, i } of order) {
    const row = firstFreeLane(s, placed);
    rows.set(i, row);
    placed.push({ ...s, row });
  }
  return sections.map((s, i) => {
    const row = rows.get(i) ?? 0;
    return row === s.row ? s : { ...s, row };
  });
}

/** Number of lanes a track needs (track height grows to this). 0 for an empty track. */
export function laneCount(sections: readonly Section[]): number {
  let max = -1;
  for (const s of sections) if (s.row > max) max = s.row;
  return max + 1;
}
