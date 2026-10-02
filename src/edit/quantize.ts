// Nudge and quantize the selection (keys and sections) on a beat grid. Pure: (seq, selection, ...) => result.
// Keys go through moveKeys / setKeys (locks, >= 0, 1/960 quantizing, aligned tangents); sections through
// moveSection (locks, lane reassignment). One call = one sequence change = one History.commit.
import { quantize } from "../core/model";
import type { Beats, Sequence } from "../core/model";
import { findTrack, moveKeys, moveSection } from "./commands";
import type { KeyRef } from "./commands";
import { setKeys } from "./batch";

export interface SectionRef { trackId: string; id: string }
export interface EditSelection { keys?: KeyRef[]; sections?: SectionRef[] }
export interface MovedSelection { seq: Sequence; keys: KeyRef[]; sections: SectionRef[] }

const sectionStart = (seq: Sequence, r: SectionRef): Beats | undefined => {
  const t = findTrack(seq.tracks, r.trackId);
  return t?.kind === "sections" ? t.sections.find((s) => s.id === r.id)?.start : undefined;
};

/**
 * Shift the selection by `steps` grid steps of `step` beats (negative = earlier, result >= 0).
 * Keys move together per channel (as in moveKeys), so neighbors within the selection keep their spacing.
 * Returns `seq` itself when nothing moved (zero steps, locked, missing).
 */
export function nudgeSelection(seq: Sequence, sel: EditSelection, steps: number, step: Beats): MovedSelection {
  const keys = sel.keys ?? [], sections = sel.sections ?? [];
  const d = quantize(steps * step);
  if (!(step > 0) || d === 0) return { seq, keys, sections };
  let out = moveKeys(seq, keys, d);
  const moved = keys.map((r) => {
    const q = quantize(r.beat);
    const t = findTrack(seq.tracks, r.trackId);
    if (out === seq || t?.kind !== "channels" || t.locked) return { ...r, beat: q };
    const first = Math.min(...keys.filter((k) => k.trackId === r.trackId && k.channelId === r.channelId).map((k) => quantize(k.beat)));
    return { ...r, beat: quantize(q + Math.max(d, -first)) };
  });
  for (const r of sections) {
    const s = sectionStart(out, r);
    if (s !== undefined) out = moveSection(out, r.trackId, r.id, s + d);
  }
  return { seq: out, keys: moved, sections };
}

/**
 * Pull the selection toward the nearest grid line of `step` beats; `strength` 0..1 (0 = untouched,
 * 1 = on the grid, clamped). Section starts are quantized (length is kept). Returns `seq` itself when nothing moved.
 */
export function quantizeSelection(seq: Sequence, sel: EditSelection, step: Beats, strength = 1): MovedSelection {
  const keys = sel.keys ?? [], sections = sel.sections ?? [];
  const k = Math.min(1, Math.max(0, strength));
  if (!(step > 0) || !(k > 0)) return { seq, keys, sections };
  const target = (b: Beats) => quantize(b + (Math.round(b / step) * step - b) * k);
  let out = seq;
  const moved = keys.map((r) => {
    const cur = quantize(r.beat);
    const to = Math.max(0, target(cur));
    const res = setKeys(out, [{ ...r, beat: cur }], { beat: to });
    out = res.seq;
    return res.refs[0] ?? { ...r, beat: cur };
  });
  for (const r of sections) {
    const s = sectionStart(out, r);
    if (s !== undefined) out = moveSection(out, r.trackId, r.id, target(s));
  }
  return { seq: out, keys: moved, sections };
}
