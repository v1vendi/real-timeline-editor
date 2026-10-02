// Audio clip commands: delete, fades, gain.
import { quantize } from "../core/model";
import type { AudioClip, Beats, Sequence } from "../core/model";
import { withTrack } from "./trackOps";

/** Delete an audio clip; a locked track is refused. */
export function deleteClip(seq: Sequence, trackId: string, id: string): Sequence {
  return withTrack(seq, trackId, (t) => (t.kind !== "audio" || t.locked || !t.clips.some((c) => c.id === id) ? t : { ...t, clips: t.clips.filter((c) => c.id !== id) }));
}

function withClip(seq: Sequence, trackId: string, id: string, fn: (c: AudioClip) => AudioClip): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "audio") return t;
    const i = t.clips.findIndex((c) => c.id === id);
    if (i < 0) return t;
    const next = fn(t.clips[i]!);
    return next === t.clips[i] ? t : { ...t, clips: t.clips.map((c, j) => (j === i ? next : c)) };
  });
}

/** Drop a field that equals its default so the serialized form stays canonical. */
function setOpt<K extends "fadeIn" | "fadeOut" | "gain">(c: AudioClip, k: K, v: number, dflt: number): AudioClip {
  if (v === (c[k] ?? dflt)) return c;
  const n: AudioClip = { ...c, [k]: v };
  if (v === dflt) delete n[k];
  return n;
}

/**
 * Set a clip's fade lengths (beats, quantized, clamped to >= 0). A given `fadeIn` is clamped to the
 * clip length; `fadeOut` to what is left after the fade-in, so fadeIn + fadeOut <= length.
 * Omitted fields are unchanged. No-op on a locked track or missing clip.
 */
export function setAudioFade(seq: Sequence, trackId: string, id: string, fade: { fadeIn?: Beats; fadeOut?: Beats }): Sequence {
  return withClip(seq, trackId, id, (c) => {
    let n = c;
    if (fade.fadeIn !== undefined) n = setOpt(n, "fadeIn", Math.min(Math.max(0, quantize(fade.fadeIn)), n.length - (n.fadeOut ?? 0)), 0);
    if (fade.fadeOut !== undefined) n = setOpt(n, "fadeOut", Math.min(Math.max(0, quantize(fade.fadeOut)), n.length - (n.fadeIn ?? 0)), 0);
    return n;
  });
}

/** Set a clip's linear gain (>= 0, non-finite ignored; 1 is the default and is stored as absent). */
export function setAudioGain(seq: Sequence, trackId: string, id: string, gain: number): Sequence {
  if (!Number.isFinite(gain)) return seq;
  return withClip(seq, trackId, id, (c) => setOpt(c, "gain", Math.max(0, gain), 1));
}
