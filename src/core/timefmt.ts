// Display helpers: beats as seconds/timecode/frames at a host fps, and the fit-length value. No DOM here.
import { beatToSeconds, quantize, type Beats, type Sequence, type TempoPoint, type Track } from "./model";

export type TimeDisplay = "seconds" | "timecode" | "frames";

/** Whole frame count at `fps` for `beat` (rounded to nearest frame). */
export function beatToFrames(tempo: TempoPoint[], beat: Beats, fps: number): number {
  return Math.round(beatToSeconds(tempo, beat) * fps);
}

/** `seconds`: "1.250"; `frames`: "30"; `timecode`: "MM:SS:FF" (HH: prefix from one hour). Negative beats clamp to 0. */
export function formatBeat(tempo: TempoPoint[], beat: Beats, mode: TimeDisplay, fps = 30): string {
  const b = Math.max(0, beat);
  if (mode === "seconds") return beatToSeconds(tempo, b).toFixed(3);
  const frames = beatToFrames(tempo, b, fps);
  if (mode === "frames") return String(frames);
  const f = Math.round(fps);
  const ff = frames % f, total = Math.floor(frames / f);
  const ss = total % 60, mm = Math.floor(total / 60) % 60, hh = Math.floor(total / 3600);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${hh > 0 ? `${p(hh)}:` : ""}${p(mm)}:${p(ss)}:${p(ff)}`;
}

function trackEnd(t: Track): Beats {
  switch (t.kind) {
    case "sections": return Math.max(0, ...t.sections.map((s) => s.start + s.length));
    case "audio": return Math.max(0, ...t.clips.map((c) => c.start + c.length));
    case "channels": return Math.max(0, ...t.channels.flatMap((c) => c.keys.map((k) => k.beat)));
    case "events": return Math.max(0, ...t.events.map((e) => e.beat));
    case "folder": return Math.max(0, ...t.children.map(trackEnd));
  }
}

/** Length that fits the content: last key beat or section/clip end over all tracks (0 when empty). */
export function fitLength(seq: Sequence): Beats {
  return quantize(Math.max(0, ...seq.tracks.map(trackEnd)));
}
