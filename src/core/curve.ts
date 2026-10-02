// Channel evaluation: constant / linear / bezier segments with auto, aligned and free tangents.
// No DOM. Segment after key i uses keys[i].interp (docs/behavior.md section 5).
import type { Beats, Channel, Key } from "./model";

export interface Handles { inDx: Beats; inDy: number; outDx: Beats; outDy: number }

/** Index of the last key with beat <= `beat`, or -1 if `beat` precedes all keys. Binary search. */
export function findKey(keys: readonly Key[], beat: Beats): number {
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.beat <= beat) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/**
 * Effective handles of key `i`. `auto` is smooth-clamped: slope follows the neighbors
 * (flat at the ends and at local extrema, so curves never overshoot), handle length is 1/3 of
 * the adjacent segment. `aligned` and `free` use the stored numbers (the editor keeps aligned
 * handles collinear; evaluation does not re-derive them).
 */
export function handlesOf(keys: readonly Key[], i: number): Handles {
  const k = keys[i]!;
  const t = k.tan;
  if (t && t.mode !== "auto") return { inDx: t.inDx, inDy: t.inDy, outDx: t.outDx, outDy: t.outDy };
  const prev = keys[i - 1], next = keys[i + 1];
  let slope = 0;
  if (prev && next) {
    const a = (k.value - prev.value) / (k.beat - prev.beat);
    const b = (next.value - k.value) / (next.beat - k.beat);
    // Local extremum (or plateau): flat. Otherwise weighted by the neighboring spans.
    if (a * b > 0) {
      const span = next.beat - prev.beat;
      slope = ((k.beat - prev.beat) * b + (next.beat - k.beat) * a) / span;
      const cap = 3 * Math.min(Math.abs(a), Math.abs(b));
      if (Math.abs(slope) > cap) slope = Math.sign(slope) * cap;
    }
  }
  const inDx = prev ? (k.beat - prev.beat) / 3 : 0;
  const outDx = next ? (next.beat - k.beat) / 3 : 0;
  return { inDx: -inDx, inDy: -slope * inDx, outDx, outDy: slope * outDx };
}

function bezier1(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

function bezierSegment(keys: readonly Key[], i: number, beat: Beats): number {
  const a = keys[i]!, b = keys[i + 1]!;
  const span = b.beat - a.beat;
  const ha = handlesOf(keys, i), hb = handlesOf(keys, i + 1);
  // Clamp handles into the segment so x(t) stays monotonic and the curve is a function of time.
  const ox = Math.min(Math.max(ha.outDx, 0), span);
  const ix = Math.min(Math.max(-hb.inDx, 0), span);
  const x1 = a.beat + ox, x2 = b.beat - ix;
  let lo = 0, hi = 1;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if (bezier1(a.beat, x1, x2, b.beat, mid) < beat) lo = mid; else hi = mid;
  }
  return bezier1(a.value, a.value + ha.outDy, b.value + hb.inDy, b.value, (lo + hi) / 2);
}

/** Channel value at `beat`; holds the first/last key outside the range; undefined for an empty channel. */
export function evaluate(channel: Pick<Channel, "keys">, beat: Beats): number | undefined {
  const keys = channel.keys;
  const i = findKey(keys, beat);
  if (i < 0) return keys[0]?.value;
  const a = keys[i]!, b = keys[i + 1];
  if (!b || beat === a.beat || a.interp === "constant") return a.value;
  if (a.interp === "linear") return a.value + ((b.value - a.value) * (beat - a.beat)) / (b.beat - a.beat);
  return bezierSegment(keys, i, beat);
}
