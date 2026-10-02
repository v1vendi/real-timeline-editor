// Group-level color stop edits: one "stop" is the set of keys at one beat across all channels of a color group.
import { colorAt, resolve, rgbToHsv, type Rgba } from "../core/color";
import { quantize } from "../core/model";
import type { Beats, Sequence } from "../core/model";
import { setValueAtTime } from "./autokey";
import { findTrack } from "./trackCommands";
import { deleteKeys, moveKeys, type KeyRef } from "./keyCommands";

/** A color group on a channels track. */
export interface ColorGroupRef { trackId: string; groupId: string }
/** One color stop: the group's keys at `beat`. */
export interface ColorStopRef extends ColorGroupRef { beat: Beats }

const COLOR_KINDS = new Set(["rgb", "rgba", "hsv", "hue"]);
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Channel values (0..range, hue in degrees) for a color, honoring the group kind; one entry per channel. */
function channelValues(kind: string | undefined, range: number | undefined, n: number, c: Rgba): number[] {
  const max = range && range > 0 ? range : kind === "hsv" ? 1 : 255;
  const a = round3((Math.min(255, Math.max(0, c.a)) / 255) * max);
  if (kind === "hue" || kind === "hsv") {
    const { h, s, v } = rgbToHsv(c.r, c.g, c.b);
    const out = [round3(h)];
    if (kind === "hsv") out.push(round3(s * max), round3(v * max));
    if (n > out.length) out.push(a);
    return out;
  }
  const out = [c.r, c.g, c.b].map((x) => round3((Math.min(255, Math.max(0, x)) / 255) * max));
  if (n > 3) out.push(a);
  return out;
}

/**
 * Write every channel of the group at `beat` in one step (missing keys are created with the previous key's
 * interp, existing keys keep theirs). Alpha is written only when the group has a 4th channel.
 * No-op (same `seq`) for a missing/non-color group or a locked track.
 */
export function setGroupColor(seq: Sequence, ref: ColorGroupRef, beat: Beats, color: Rgba): Sequence {
  const r = resolve(seq, ref.trackId, ref.groupId);
  if (!r) return seq;
  const vals = channelValues(r.g.kind, r.g.range, r.g.channelIds.length, color);
  let out = seq;
  r.g.channelIds.forEach((channelId, i) => {
    const v = vals[i];
    if (v !== undefined && r.ch[i]) out = setValueAtTime(out, { trackId: ref.trackId, channelId }, beat, v);
  });
  return out;
}

/** Add a stop at `beat`; `color` defaults to the current `colorAt`, so the gradient does not change. */
export function addColorStop(seq: Sequence, ref: ColorGroupRef, beat: Beats, color?: Rgba): Sequence {
  const c = color ?? colorAt(seq, ref.trackId, ref.groupId, beat);
  return c ? setGroupColor(seq, ref, beat, c) : seq;
}

function keyRefs(seq: Sequence, ref: ColorStopRef) {
  const r = resolve(seq, ref.trackId, ref.groupId), b = quantize(ref.beat);
  const chans = r ? r.ch.filter((c) => !!c) : [];
  return { b, chans, refs: chans.filter((c) => c!.keys.some((k) => k.beat === b)).map((c) => ({ trackId: ref.trackId, channelId: c!.id, beat: b })) };
}

/**
 * Move the stop at `ref.beat` by `dBeat`, all channel keys together. Clamped to >= 0 and to stay strictly between
 * the neighboring stops of the group (stops never collide or pass each other).
 */
export function moveColorStop(seq: Sequence, ref: ColorStopRef, dBeat: Beats): Sequence {
  const { b, chans, refs } = keyRefs(seq, ref);
  if (!refs.length || dBeat === 0) return seq;
  let lo = 0, hi = Infinity;
  const step = quantize(1 / 960) || 1 / 960;
  for (const c of chans) for (const k of c!.keys) {
    if (k.beat < b) lo = Math.max(lo, k.beat + step);
    else if (k.beat > b) hi = Math.min(hi, k.beat - step);
  }
  const target = Math.min(hi, Math.max(lo, quantize(b + dBeat)));
  return target === b ? seq : moveKeys(seq, refs, target - b);
}

/** Delete every channel key of the stop at `ref.beat`. */
export function removeColorStop(seq: Sequence, ref: ColorStopRef): Sequence {
  const { refs } = keyRefs(seq, ref);
  return refs.length ? deleteKeys(seq, refs) : seq;
}

const stopKey = (r: ColorStopRef) => `${r.trackId}\0${r.groupId}\0${quantize(r.beat)}`;

/**
 * The shared beat delta `moveColorStops` will apply for a request of `dBeat`: clamped so every stop stays >= 0 and
 * strictly between the group's non-moving stops (the moving set shifts rigidly, so order is kept). 0 when nothing moves.
 */
export function colorStopsDelta(seq: Sequence, stops: ColorStopRef[], dBeat: Beats): Beats {
  const step = quantize(1 / 960) || 1 / 960;
  const moving = new Map<string, Set<Beats>>(), seen = new Set<string>();
  for (const s of stops) {
    if (seen.has(stopKey(s))) continue;
    seen.add(stopKey(s));
    if (!keyRefs(seq, s).refs.length) continue;
    const g = `${s.trackId}\0${s.groupId}`;
    moving.set(g, (moving.get(g) ?? new Set()).add(quantize(s.beat)));
  }
  let lo = -Infinity, hi = Infinity;
  for (const [g, set] of moving) {
    const [trackId, groupId] = g.split("\0") as [string, string];
    const all = new Set<Beats>();
    for (const c of keyRefs(seq, { trackId, groupId, beat: 0 }).chans) for (const k of c!.keys) all.add(k.beat);
    for (const b of set) {
      lo = Math.max(lo, -b);
      for (const k of all) {
        if (set.has(k)) continue;
        if (k < b) lo = Math.max(lo, k + step - b);
        else hi = Math.min(hi, k - step - b);
      }
    }
  }
  if (!moving.size) return 0;
  return Math.min(hi, Math.max(lo, quantize(dBeat)));
}

/**
 * Move several stops (possibly of several groups) together by one shared delta, all channel keys, as one result.
 * See `colorStopsDelta` for the clamp; stops never collide with or pass a non-moving stop. No-op (same `seq`) when
 * nothing moves.
 */
export function moveColorStops(seq: Sequence, stops: ColorStopRef[], dBeat: Beats): Sequence {
  const d = colorStopsDelta(seq, stops, dBeat);
  if (d === 0) return seq;
  const seen = new Set<string>(), refs: KeyRef[] = [];
  for (const s of stops) if (!seen.has(stopKey(s))) { seen.add(stopKey(s)); refs.push(...keyRefs(seq, s).refs); }
  return moveKeys(seq, refs, d);
}

/**
 * Split key refs into color stops (keys of a channel that belongs to a rgb/rgba/hsv/hue group; one stop per group and
 * beat) and plain keys. Used to drag a mixed selection: stops via `moveColorStops`, the rest via `moveKeys`.
 */
export function splitColorStops(seq: Sequence, refs: KeyRef[]): { stops: ColorStopRef[]; keys: KeyRef[] } {
  const stops = new Map<string, ColorStopRef>(), keys: KeyRef[] = [];
  for (const r of refs) {
    const t = findTrack(seq.tracks, r.trackId);
    const g = t?.kind === "channels" ? t.groups?.find((x) => COLOR_KINDS.has(x.kind ?? "") && x.channelIds.includes(r.channelId)) : undefined;
    if (!g) { keys.push(r); continue; }
    const st = { trackId: r.trackId, groupId: g.id, beat: quantize(r.beat) };
    stops.set(stopKey(st), st);
  }
  return { stops: [...stops.values()], keys };
}
