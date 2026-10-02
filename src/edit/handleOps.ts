// Edit ops behind the handle drags: section ease durations and audio clip trim / move / slip.
// Same contract as commands.ts: pure, return the same `seq` on no-op (locked track, missing id).
import { quantize, type AudioClip, type Sequence } from "../core/model";
import { MIN_SECTION_LENGTH } from "./commands";
import type { Beats } from "../core/model";
import { withTrack } from "./trackOps";

/** Set a section's ease-in / ease-out duration; clamped to >= 0 and so easeIn + easeOut <= length. */
export function setEase(seq: Sequence, trackId: string, id: string, side: "in" | "out", duration: Beats): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "sections") return t;
    const s = t.sections.find((x) => x.id === id);
    if (!s) return t;
    const other = (side === "in" ? s.easeOut : s.easeIn) ?? 0;
    const d = quantize(Math.max(0, Math.min(duration, s.length - other)));
    if (d === ((side === "in" ? s.easeIn : s.easeOut) ?? 0)) return t;
    return { ...t, sections: t.sections.map((x) => (x === s ? { ...x, [side === "in" ? "easeIn" : "easeOut"]: d } : x)) };
  });
}

/** Keep fadeIn + fadeOut <= length after a trim: fadeIn first, fadeOut gets the rest; a 0 fade is stored as absent. */
function clampFades(c: AudioClip): AudioClip {
  const n = { ...c };
  if (n.fadeIn !== undefined) { n.fadeIn = Math.min(n.fadeIn, n.length); if (n.fadeIn === 0) delete n.fadeIn; }
  if (n.fadeOut !== undefined) { n.fadeOut = Math.min(n.fadeOut, n.length - (n.fadeIn ?? 0)); if (n.fadeOut === 0) delete n.fadeOut; }
  return n.fadeIn === c.fadeIn && n.fadeOut === c.fadeOut ? c : n;
}

export type ClipEdit =
  | { mode: "trimStart" | "trimEnd" | "move" | "slip"; beat: Beats };

/**
 * Edit an audio clip. trimStart: left edge to `beat` (offset follows so the audio stays put);
 * trimEnd: right edge to `beat`; move: clip start to `beat`; slip: offset to `beat` (>= 0).
 */
export function editClip(seq: Sequence, trackId: string, id: string, e: ClipEdit): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "audio") return t;
    const c = t.clips.find((x) => x.id === id);
    if (!c) return t;
    const end = c.start + c.length;
    let n: AudioClip;
    if (e.mode === "move") n = { ...c, start: quantize(Math.max(0, e.beat)) };
    else if (e.mode === "slip") n = { ...c, offset: quantize(Math.max(0, e.beat)) };
    else if (e.mode === "trimEnd") n = { ...c, length: quantize(Math.max(MIN_SECTION_LENGTH, e.beat - c.start)) };
    else {
      // The offset can't go below 0: the clip can't extend left past the start of its audio.
      const start = Math.max(0, Math.min(quantize(e.beat), end - MIN_SECTION_LENGTH), c.start - c.offset);
      n = { ...c, start, length: quantize(end - start), offset: quantize(c.offset + start - c.start) };
    }
    n = clampFades(n);
    return n.start === c.start && n.length === c.length && n.offset === c.offset && n.fadeIn === c.fadeIn && n.fadeOut === c.fadeOut ? t : { ...t, clips: t.clips.map((x) => (x === c ? n : x)) };
  });
}
