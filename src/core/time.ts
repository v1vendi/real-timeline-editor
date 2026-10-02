// Time helpers: inverse of beatToSeconds and ruler/grid tick steps. No DOM here.
import type { Beats, TempoPoint } from "./model";

/** Beat at `seconds`, inverse of `beatToSeconds`. `tempo` must be sorted and start at beat 0. */
export function secondsToBeat(tempo: TempoPoint[], seconds: number): Beats {
  if (seconds <= 0) return 0;
  let elapsed = 0;
  for (let i = 0; i < tempo.length; i++) {
    const p = tempo[i]!;
    const next = tempo[i + 1];
    const segSeconds = next ? ((next.beat - p.beat) * 60) / p.bpm : Infinity;
    if (seconds <= elapsed + segSeconds) return p.beat + ((seconds - elapsed) * p.bpm) / 60;
    elapsed += segSeconds;
  }
  return 0;
}

export interface TickSteps {
  /** Beats between labeled (major) ticks. */
  major: Beats;
  /** Beats between minor ticks; divides `major` (equal when there is no finer level). */
  minor: Beats;
}

/** Grid subdivision flavour: straight binary, triplet (x2/3) or dotted (x3/2) beat subdivisions. Bar levels are unchanged. */
export type GridMode = "straight" | "triplet" | "dotted";

/** Grid levels coarse to fine: multiples of a bar, then beat and binary subdivisions. */
function levels(beatsPerBar: number, mode: GridMode): Beats[] {
  const f = mode === "triplet" ? 2 / 3 : mode === "dotted" ? 1.5 : 1;
  const out: Beats[] = [];
  for (let bars = 64; bars >= 1; bars /= 2) out.push(bars * beatsPerBar);
  for (let beat = 1; beat >= 1 / 64; beat /= 2) out.push(beat * f);
  return out.sort((a, b) => b - a);
}

/**
 * Grid step for a zoom level. `major` is the finest level with at least `minLabelPx` between
 * ticks (labels); `minor` is the finest level with at least `minMinorPx`, never coarser than
 * `major`. Bar and beat levels are skipped when they don't fit, so the step thins out as you zoom out.
 */
export function tickSteps(pxPerBeat: number, beatsPerBar: number, minLabelPx = 60, minMinorPx = 8, mode: GridMode = "straight"): TickSteps {
  const ls = levels(beatsPerBar, mode);
  let major = ls[0]!;
  let minor = ls[0]!;
  for (const step of ls) {
    const px = step * pxPerBeat;
    if (px >= minLabelPx) major = step;
    if (px >= minMinorPx) minor = step;
  }
  return { major, minor: Math.min(minor, major) };
}

/** Single grid step (for snapping, playhead step): the finest level with at least `minPx` spacing. */
export function gridStep(pxPerBeat: number, beatsPerBar: number, minPx = 12, mode: GridMode = "straight"): Beats {
  return tickSteps(pxPerBeat, beatsPerBar, minPx, minPx, mode).minor;
}
