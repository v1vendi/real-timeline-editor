// Pure math for the curve editor: value axis (Y zoom/pan), nice ticks, curve sampling. No DOM.
import { quantize } from "../core/model";
import type { Channel, Key, Sequence, Tangent, Track } from "../core/model";
import { evaluate, handlesOf } from "../core/curve";

/** Vertical transform: value `top` sits at y = 0, `pxPerUnit` px per value unit (y grows downward). */
export interface ValueAxis { top: number; pxPerUnit: number }

const MIN_PX_PER_UNIT = 1e-3;
const MAX_PX_PER_UNIT = 1e6;

export const valueToY = (a: ValueAxis, v: number): number => (a.top - v) * a.pxPerUnit;
export const yToValue = (a: ValueAxis, y: number): number => a.top - y / a.pxPerUnit;

/** Zoom keeping the value under `anchorY` fixed. */
export function zoomValueAt(a: ValueAxis, anchorY: number, factor: number): ValueAxis {
  const pxPerUnit = Math.min(MAX_PX_PER_UNIT, Math.max(MIN_PX_PER_UNIT, a.pxPerUnit * factor));
  return { pxPerUnit, top: yToValue(a, anchorY) + anchorY / pxPerUnit };
}

/** Pan by `dy` px (positive dy moves content down). */
export const panValue = (a: ValueAxis, dy: number): ValueAxis => ({ ...a, top: a.top + dy / a.pxPerUnit });

/** Axis showing [min, max] in `heightPx` with `padPx` margin; a flat range gets a unit span. */
export function fitValues(min: number, max: number, heightPx: number, padPx = 24): ValueAxis {
  const span = max - min || 1;
  const pxPerUnit = Math.max(MIN_PX_PER_UNIT, Math.min(MAX_PX_PER_UNIT, (heightPx - 2 * padPx) / span));
  return { pxPerUnit, top: max + padPx / pxPerUnit + (max - min ? 0 : 0.5) };
}

/** Min/max of key values and bezier handle tips of all channels; undefined when there are no keys. */
export function valueRange(channels: readonly Pick<Channel, "keys">[]): [number, number] | undefined {
  let lo = Infinity, hi = -Infinity;
  for (const { keys } of channels) {
    keys.forEach((k, i) => {
      lo = Math.min(lo, k.value); hi = Math.max(hi, k.value);
      if (k.interp === "bezier" || keys[i - 1]?.interp === "bezier") {
        const h = handlesOf(keys, i);
        for (const d of [h.inDy, h.outDy]) { lo = Math.min(lo, k.value + d); hi = Math.max(hi, k.value + d); }
      }
    });
  }
  return lo <= hi ? [lo, hi] : undefined;
}

/** Tick values (1/2/5 x 10^n steps) with at least `minPx` between ticks, covering [v0, v1]. */
export function valueTicks(v0: number, v1: number, pxPerUnit: number, minPx = 40): number[] {
  const raw = minPx / pxPerUnit;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let n = Math.ceil(Math.min(v0, v1) / step); n * step <= Math.max(v0, v1); n++) out.push(+(n * step).toPrecision(12));
  return out;
}

/** Polyline [beat, value, ...] of a channel over [b0, b1]: steps for constant, lines for linear, sampled beziers. */
export function sampleChannel(ch: Pick<Channel, "keys">, b0: number, b1: number, pxPerBeat: number, stepPx = 3): number[] {
  const { keys } = ch, out: number[] = [];
  if (!keys.length) return out;
  const first = keys[0]!, last = keys[keys.length - 1]!;
  if (b0 < first.beat) out.push(b0, first.value);
  for (let i = 0; i < keys.length; i++) {
    const a = keys[i]!, b = keys[i + 1];
    if (!b) break;
    if (b.beat < b0 || a.beat > b1) continue;
    out.push(a.beat, a.value);
    if (a.interp === "constant") out.push(b.beat, a.value);
    else if (a.interp === "bezier") {
      const n = Math.max(2, Math.min(200, Math.ceil(((b.beat - a.beat) * pxPerBeat) / stepPx)));
      for (let s = 1; s < n; s++) {
        const beat = a.beat + ((b.beat - a.beat) * s) / n;
        out.push(beat, evaluate(ch, beat) ?? 0);
      }
    }
  }
  out.push(last.beat, last.value);
  if (b1 > last.beat) out.push(b1, last.value);
  return out;
}


/** Constrain a drag delta to its dominant axis (shift-drag). */
export const lockAxis = (dx: number, dy: number): [number, number] => (Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy]);

/** Keys of `channels` inside the box [b0,b1] x [v0,v1] (corners in any order), as { channelId, beat }. */
export function keysInBox(channels: readonly { id: string; keys: readonly Key[] }[], b0: number, b1: number, v0: number, v1: number): { channelId: string; beat: number }[] {
  const [bl, bh] = b0 < b1 ? [b0, b1] : [b1, b0], [vl, vh] = v0 < v1 ? [v0, v1] : [v1, v0];
  const out: { channelId: string; beat: number }[] = [];
  for (const c of channels) for (const k of c.keys) if (k.beat >= bl && k.beat <= bh && k.value >= vl && k.value <= vh) out.push({ channelId: c.id, beat: k.beat });
  return out;
}

/**
 * Switch the tangent mode of `refs` keys. `auto` drops stored handles (derived again); `aligned`/`free`
 * freeze the currently visible handles, `aligned` making the in-handle collinear with the out-handle.
 * Locked tracks (and tracks under a locked folder) are skipped; returns `seq` itself when nothing changed.
 */
export function setTangentMode(seq: Sequence, refs: readonly { trackId: string; channelId: string; beat: number }[], mode: Tangent["mode"]): Sequence {
  const want = new Map<string, Set<number>>();
  for (const r of refs) { const k = `${r.trackId}/${r.channelId}`; (want.get(k) ?? want.set(k, new Set()).get(k)!).add(quantize(r.beat)); }
  const conv = (keys: Key[], beats: Set<number>): Key[] => {
    let changed = false;
    const out = keys.map((k, i) => {
      if (!beats.has(k.beat) || (!k.tan ? mode === "auto" : k.tan.mode === mode)) return k;
      changed = true;
      if (mode === "auto") { const { tan: _t, ...rest } = k; return rest; }
      const h = handlesOf(keys, i);
      let tan: Tangent = { mode, ...h };
      if (mode === "aligned") {
        const len = Math.hypot(h.outDx, h.outDy), olen = Math.hypot(h.inDx, h.inDy);
        if (len > 0) tan = { ...tan, inDx: Math.min(0, (-h.outDx / len) * olen), inDy: (-h.outDy / len) * olen };
      }
      return { ...k, tan };
    });
    return changed ? out : keys;
  };
  const go = (tracks: Track[], locked: boolean): Track[] => {
    let any = false;
    const out = tracks.map((t) => {
      const lk = locked || !!t.locked;
      let n: Track = t;
      if (t.kind === "folder") { const c = go(t.children, lk); if (c !== t.children) n = { ...t, children: c }; }
      else if (t.kind === "channels" && !lk) {
        const channels = t.channels.map((c) => { const b = want.get(`${t.id}/${c.id}`); if (!b) return c; const keys = conv(c.keys, b); return keys === c.keys ? c : { ...c, keys }; });
        if (channels.some((c, i) => c !== t.channels[i])) n = { ...t, channels };
      }
      if (n !== t) any = true;
      return n;
    });
    return any ? out : tracks;
  };
  const tracks = go(seq.tracks, false);
  return tracks === seq.tracks ? seq : { ...seq, tracks };
}
