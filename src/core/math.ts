/** Small shared numeric helpers. Pure core, no DOM. Not public API. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Index of the last element whose `beat` is <= `x` in an ascending array, or -1 if none. */
export function lastAtOrBefore(a: readonly { beat: number }[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid]!.beat > x) hi = mid; else lo = mid + 1;
  }
  return lo - 1;
}
