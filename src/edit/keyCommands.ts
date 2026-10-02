// Key and channel commands: keys are addressed by (track, channel, beat); beats are quantized.
import { quantize } from "../core/model";
import type { Beats, Channel, ChannelTrack, Interp, Key, Sequence, Tangent } from "../core/model";
import { handlesOf } from "../core/curve";
import { withTrack } from "./trackOps";

/** A key is addressed by (track, channel, beat); beats are quantized so this is stable. */
export interface KeyRef { trackId: string; channelId: string; beat: Beats }

function withChannel(seq: Sequence, trackId: string, channelId: string, fn: (c: Channel) => Channel): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "channels") return t;
    const i = t.channels.findIndex((c) => c.id === channelId);
    if (i < 0) return t;
    const next = fn(t.channels[i]!);
    return next === t.channels[i] ? t : { ...t, channels: t.channels.map((c, j) => (j === i ? next : c)) };
  });
}

const byBeat = (a: Key, b: Key) => a.beat - b.beat;

/** Insert a key, replacing any key at the same (quantized) beat. */
export function addKey(seq: Sequence, trackId: string, channelId: string, key: Key): Sequence {
  const k = { ...key, beat: quantize(key.beat) };
  return withChannel(seq, trackId, channelId, (c) => ({ ...c, keys: [...c.keys.filter((o) => o.beat !== k.beat), k].sort(byBeat) }));
}

function groupByChannel(refs: KeyRef[]): Map<string, { trackId: string; channelId: string; beats: Set<Beats> }> {
  const m = new Map<string, { trackId: string; channelId: string; beats: Set<Beats> }>();
  for (const r of refs) {
    const k = `${r.trackId}\0${r.channelId}`;
    const g = m.get(k) ?? { trackId: r.trackId, channelId: r.channelId, beats: new Set<Beats>() };
    g.beats.add(quantize(r.beat));
    m.set(k, g);
  }
  return m;
}

function eachChannel(seq: Sequence, refs: KeyRef[], fn: (c: Channel, beats: Set<Beats>) => Channel): Sequence {
  let out = seq;
  for (const g of groupByChannel(refs).values()) out = withChannel(out, g.trackId, g.channelId, (c) => fn(c, g.beats));
  return out;
}

/** Move keys by `dBeat` (keys stay >= 0) and `dValue`. A moved key replaces an unmoved key it lands on. */
export function moveKeys(seq: Sequence, refs: KeyRef[], dBeat: Beats, dValue = 0): Sequence {
  if (dBeat === 0 && dValue === 0) return seq;
  return eachChannel(seq, refs, (c, beats) => {
    const moved: Key[] = [], kept: Key[] = [];
    for (const k of c.keys) (beats.has(k.beat) ? moved : kept).push(k);
    if (!moved.length) return c;
    const d = Math.max(dBeat, -moved[0]!.beat); // moved is sorted: [0] is the earliest
    const shifted = moved.map((k) => ({ ...k, beat: quantize(k.beat + d), value: k.value + dValue }))
      .map((k) => (k.tan?.mode === "aligned" ? { ...k, tan: align(k.tan, "out") } : k));
    const taken = new Set(shifted.map((k) => k.beat));
    return { ...c, keys: [...kept.filter((k) => !taken.has(k.beat)), ...shifted].sort(byBeat) };
  });
}

/** Make an aligned tangent collinear: the `keep` handle stays, the other points the opposite way at its own length. */
function align(t: Tangent, keep: "in" | "out"): Tangent {
  const [dx, dy] = keep === "out" ? [t.outDx, t.outDy] : [t.inDx, t.inDy];
  const len = Math.hypot(dx, dy);
  const olen = keep === "out" ? Math.hypot(t.inDx, t.inDy) : Math.hypot(t.outDx, t.outDy);
  if (len === 0) return t;
  const ox = (-dx / len) * olen, oy = (-dy / len) * olen;
  return keep === "out" ? { ...t, inDx: Math.min(0, ox), inDy: oy } : { ...t, outDx: Math.max(0, ox), outDy: oy };
}

/**
 * Drag one bezier handle of a key to (dx, dy) relative to the key (in-handle dx <= 0, out-handle
 * dx >= 0). `aligned` keeps the other handle collinear (own length kept); `free` leaves it;
 * an `auto` key becomes `aligned`, seeded from its derived handles.
 */
export function setHandle(seq: Sequence, ref: KeyRef, side: "in" | "out", dx: Beats, dy: number): Sequence {
  return eachChannel(seq, [ref], (c, beats) => {
    const i = c.keys.findIndex((k) => beats.has(k.beat));
    if (i < 0) return c;
    const k = c.keys[i]!;
    const cur = k.tan && k.tan.mode !== "auto" ? k.tan : { mode: "aligned" as const, ...handlesOf(c.keys, i) };
    const x = side === "out" ? Math.max(0, dx) : Math.min(0, dx);
    let tan: Tangent = side === "out" ? { ...cur, outDx: x, outDy: dy } : { ...cur, inDx: x, inDy: dy };
    if (tan.mode === "aligned") tan = align(tan, side);
    return { ...c, keys: c.keys.map((o, j) => (j === i ? { ...k, tan } : o)) };
  });
}

export function deleteKeys(seq: Sequence, refs: KeyRef[]): Sequence {
  return eachChannel(seq, refs, (c, beats) => (c.keys.some((k) => beats.has(k.beat)) ? { ...c, keys: c.keys.filter((k) => !beats.has(k.beat)) } : c));
}

export function setInterp(seq: Sequence, refs: KeyRef[], interp: Interp): Sequence {
  return eachChannel(seq, refs, (c, beats) =>
    c.keys.some((k) => beats.has(k.beat) && k.interp !== interp)
      ? { ...c, keys: c.keys.map((k) => (beats.has(k.beat) ? { ...k, interp } : k)) } : c);
}

/** Where `ref` ends up after `moveKeys(seq, [ref], dBeat)`; use to keep the selection on moved keys. */
export function movedKeyRef(ref: KeyRef, dBeat: Beats, earliest: Beats = ref.beat): KeyRef {
  return { ...ref, beat: quantize(ref.beat + Math.max(dBeat, -earliest)) };
}

/** Append a channel to a channel track (or insert at `index`); duplicate channel ids in the track are ignored; locked track is a no-op. */
export function addChannel(seq: Sequence, trackId: string, channel: Channel, index?: number): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "channels" || t.channels.some((c) => c.id === channel.id)) return t;
    const i = Math.max(0, Math.min(index ?? t.channels.length, t.channels.length));
    return { ...t, channels: [...t.channels.slice(0, i), channel, ...t.channels.slice(i)] };
  });
}

/** Remove a channel and its keys; it also leaves any group (groups left empty are dropped). No-op when missing or locked. */
export function removeChannel(seq: Sequence, trackId: string, channelId: string): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "channels" || !t.channels.some((c) => c.id === channelId)) return t;
    const out: ChannelTrack = { ...t, channels: t.channels.filter((c) => c.id !== channelId) };
    if (t.groups) {
      const groups = t.groups.map((g) => ({ ...g, channelIds: g.channelIds.filter((id) => id !== channelId) })).filter((g) => g.channelIds.length);
      if (groups.length) out.groups = groups; else delete out.groups;
    }
    return out;
  });
}

