// Auto-key helper: set a channel value at a beat, creating or updating a key.
import { quantize } from "../core/model";
import type { Beats, Interp, Sequence } from "../core/model";
import { addKey, findTrack } from "./commands";
import type { KeyRef } from "./commands";
import type { History } from "./history";

export interface AutoKeyOptions {
  /** Create a key when none exists at `beat`. Default true; false only updates an existing key. */
  autoKey?: boolean;
  /** Interp for a newly created key. Default: the previous key's interp, else "linear". */
  interp?: Interp;
}

export type ChannelRef = Pick<KeyRef, "trackId" | "channelId">;

/** Pure: update the key at `beat` (keeps interp/tangents) or create one. No-op returns `seq`. */
export function setValueAtTime(seq: Sequence, ref: ChannelRef, beat: Beats, value: number, o: AutoKeyOptions = {}): Sequence {
  const t = findTrack(seq.tracks, ref.trackId);
  if (!t || t.kind !== "channels" || t.locked) return seq;
  const ch = t.channels.find((c) => c.id === ref.channelId);
  if (!ch) return seq;
  const b = quantize(beat);
  const cur = ch.keys.find((k) => k.beat === b);
  if (cur) return cur.value === value ? seq : addKey(seq, ref.trackId, ref.channelId, { ...cur, value });
  if (o.autoKey === false) return seq;
  const prev = [...ch.keys].reverse().find((k) => k.beat < b);
  return addKey(seq, ref.trackId, ref.channelId, { beat: b, value, interp: o.interp ?? prev?.interp ?? "linear" });
}

/** One history entry; repeated calls for the same (channel, beat) within the merge window coalesce. */
export function applyValueAtTime(h: History, ref: ChannelRef, beat: Beats, value: number, o: AutoKeyOptions = {}): void {
  h.apply("Set value", (s) => setValueAtTime(s, ref, beat, value, o), `autokey:${ref.trackId}:${ref.channelId}:${quantize(beat)}`);
}
