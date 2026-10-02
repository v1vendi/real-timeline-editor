// Batch key edit (numeric inspector backend): set value and/or time on many keys in one pure
// command, so one History.commit = one undo entry. Built on moveKeys, so locked tracks are
// skipped, beats are quantized/clamped >= 0 and aligned tangents stay collinear.
import { quantize } from "../core/model";
import type { Beats, Sequence } from "../core/model";
import { findTrack, moveKeys } from "./commands";
import type { KeyRef } from "./commands";

export interface SetKeysSpec {
  /** Set every key's value to this. */
  value?: number;
  /** Add this to every key's value (applied after `value` if both are given). */
  dValue?: number;
  /** Move every key to this beat; keys sharing a channel collapse (the last ref wins). */
  beat?: Beats;
  /** Shift every key by this many beats (applied after `beat` if both are given). */
  dBeat?: Beats;
}

export interface SetKeysResult { seq: Sequence; refs: KeyRef[] }

function valueAt(seq: Sequence, r: KeyRef): number | undefined {
  const t = findTrack(seq.tracks, r.trackId);
  if (t?.kind !== "channels") return undefined;
  const beat = quantize(r.beat);
  return t.channels.find((c) => c.id === r.channelId)?.keys.find((k) => k.beat === beat)?.value;
}

/**
 * Apply `spec` to all `refs`. Returns the new sequence plus where each ref ended up (same order),
 * for keeping the selection. Returns `seq` itself when nothing changed.
 */
export function setKeys(seq: Sequence, refs: KeyRef[], spec: SetKeysSpec): SetKeysResult {
  let out = seq;
  // Values first: value-only moves never change beats, so refs stay valid.
  if (spec.value !== undefined || spec.dValue) {
    for (const r of refs) {
      const cur = valueAt(out, r);
      if (cur === undefined) continue;
      out = moveKeys(out, [r], 0, (spec.value ?? cur) + (spec.dValue ?? 0) - cur);
    }
  }
  let cur = refs.map((r) => ({ ...r, beat: quantize(r.beat) }));
  if (spec.beat !== undefined || spec.dBeat) {
    cur = cur.map((r) => {
      const d = quantize(Math.max(0, (spec.beat ?? r.beat) + (spec.dBeat ?? 0))) - r.beat;
      if (d === 0 || valueAt(out, r) === undefined) return r;
      const next = moveKeys(out, [r], d);
      if (next === out) return r;
      out = next;
      return { ...r, beat: quantize(r.beat + d) };
    });
  }
  return { seq: out, refs: cur };
}
