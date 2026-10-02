import { beatToSeconds } from "../core/model";
import type { AudioClip, Marker, TempoPoint } from "../core/model";
import { pickMip } from "../core/waveform";
import type { PeakMips } from "../core/waveform";
import { beatToX, xToBeat } from "./viewState";
import type { ViewState } from "./viewState";
import { darkTheme, roundRectPath, type Theme } from "./theme";
import { glowRound } from "./paint";

/** Host-supplied peaks keyed by `AudioClip.peaksId`. */
export type PeaksMap = ReadonlyMap<string, PeakMips>;

const MARKER_FLAG_H = 15;

/** Marker lines over the rows (top..bottom) plus a labeled flag at `top`. Culled to the view. */
export function drawMarkers(ctx: CanvasRenderingContext2D, markers: readonly Marker[], view: ViewState, width: number, top: number, bottom: number, th: Theme = darkTheme, selected?: ReadonlySet<string>): void {
  const b0 = xToBeat(view, -200), b1 = xToBeat(view, width);
  ctx.save();
  ctx.lineWidth = 1;
  for (const m of markers) {
    if (m.beat < b0 || m.beat > b1) continue;
    const x = Math.round(beatToX(view, m.beat)) + 0.5;
    const col = m.color ?? th.color.marker;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.4; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 1; ctx.fillStyle = col;
    ctx.font = `600 ${th.font.small}px ${th.font.ui}`; ctx.textBaseline = "middle";
    const tw = m.label ? Math.ceil(ctx.measureText(m.label).width) + 12 : 10;
    ctx.beginPath(); roundRectPath(ctx, x, top + 1, tw, MARKER_FLAG_H - 2, 3); ctx.fill();
    ctx.fillRect(x - 0.5, top, 1.5, MARKER_FLAG_H);
    if (selected?.has(m.id)) {
      glowRound(ctx, th, x - 1, top, tw + 2, MARKER_FLAG_H, 4, 8, 2);
    }
    if (m.label) { ctx.fillStyle = th.color.markerText; ctx.fillText(m.label, Math.round(x + 7), top + MARKER_FLAG_H / 2 + 0.5); }
  }
  ctx.restore();
}

/** Waveform of one clip: a min/max bar per pixel column from the mip level picked for the zoom. */
export function drawWaveform(ctx: CanvasRenderingContext2D, clip: AudioClip, mips: PeakMips, tempo: TempoPoint[], view: ViewState, width: number, top: number, h: number, th: Theme = darkTheme): void {
  const x0 = Math.max(0, Math.floor(beatToX(view, clip.start)));
  const x1 = Math.min(width, Math.ceil(beatToX(view, clip.start + clip.length)));
  if (x1 <= x0 || !mips.levels.length) return;
  const mid = (xToBeat(view, x0) + xToBeat(view, x1)) / 2;
  const secPerPx = beatToSeconds(tempo, mid + 0.5 / view.pxPerBeat) - beatToSeconds(tempo, mid - 0.5 / view.pxPerBeat);
  const lvl = mips.levels[pickMip(mips, 1 / Math.max(secPerPx, 1e-9))]!;
  const pps = lvl.peaksPerSecond, n = lvl.min.length;
  const t0 = beatToSeconds(tempo, clip.start), c0 = beatToSeconds(tempo, clip.offset);
  const half = (h - 6) / 2, cy = top + h / 2;
  ctx.fillStyle = th.color.waveform;
  ctx.beginPath();
  for (let x = x0; x < x1; x++) {
    const a = Math.max(0, Math.floor((beatToSeconds(tempo, xToBeat(view, x)) - t0 + c0) * pps));
    const b = Math.min(n - 1, Math.max(a, Math.floor((beatToSeconds(tempo, xToBeat(view, x + 1)) - t0 + c0) * pps - 1e-9)));
    if (a >= n) break;
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i <= b; i++) { if (lvl.min[i]! < lo) lo = lvl.min[i]!; if (lvl.max[i]! > hi) hi = lvl.max[i]!; }
    const y0 = cy - Math.min(1, Math.max(-1, hi)) * half, y1 = cy - Math.min(1, Math.max(-1, lo)) * half;
    ctx.rect(x, y0, 1, Math.max(1, y1 - y0));
  }
  ctx.fill();
}
