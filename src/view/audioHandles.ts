// Audio clip envelope: fade ramps, gain line and their drag handles. Geometry is shared by render, hit-test and the drag ghost.
import type { AudioClip, Beats } from "../core/model";
import type { ViewState } from "./viewState";
import { darkTheme, type Theme } from "./theme";

export type ClipHandle = "fadeIn" | "fadeOut" | "gain";
/** Gain shown at the top of the clip; 1 (unity) sits at mid-height. */
const MAX_GAIN_SHOWN = 2;
const HANDLE_R = 4;

interface ClipRect { x: number; y: number; w: number; h: number }
interface Envelope { fadeIn: Beats; fadeOut: Beats; gain: number }

export const envelopeOf = (c: Pick<AudioClip, "fadeIn" | "fadeOut" | "gain">): Envelope => ({ fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0, gain: c.gain ?? 1 });
const gainToY = (gain: number, r: ClipRect): number => r.y + r.h - (Math.min(Math.max(gain, 0), MAX_GAIN_SHOWN) / MAX_GAIN_SHOWN) * r.h;
/** Inverse of `gainToY`, clamped to 0..MAX_GAIN_SHOWN. */
export const yToGain = (y: number, r: ClipRect): number => Math.min(MAX_GAIN_SHOWN, Math.max(0, ((r.y + r.h - y) / r.h) * MAX_GAIN_SHOWN));

/** Handle centers in the same px space as `r`: fades on the top edge, gain on the gain line at mid-length. */
function handlePoints(e: Envelope, r: ClipRect, pxPerBeat: number): Record<ClipHandle, { x: number; y: number }> {
  return {
    fadeIn: { x: r.x + e.fadeIn * pxPerBeat, y: r.y },
    fadeOut: { x: r.x + r.w - e.fadeOut * pxPerBeat, y: r.y },
    gain: { x: r.x + r.w / 2, y: gainToY(e.gain, r) },
  };
}

/** Nearest handle of a clip within `radius` px of (x, y) (same px space as `r`), or null. */
export function hitClipHandle(c: AudioClip, view: ViewState, r: ClipRect, x: number, y: number, radius: number): ClipHandle | null {
  if (r.w < 12) return null;
  const pts = handlePoints(envelopeOf(c), r, view.pxPerBeat);
  let best: ClipHandle | null = null, bd = radius;
  for (const k of ["gain", "fadeIn", "fadeOut"] as const) {
    const d = Math.hypot(pts[k].x - x, pts[k].y - y);
    if (d <= bd) { bd = d; best = k; }
  }
  return best;
}

/** Draw fade ramps (dimmed triangles), the gain line and the three handles. `active` highlights one handle (drag ghost). */
export function drawEnvelope(ctx: CanvasRenderingContext2D, e: Envelope, r: ClipRect, pxPerBeat: number, active?: ClipHandle, th: Theme = darkTheme): void {
  ctx.save(); ctx.beginPath(); ctx.rect(r.x - HANDLE_R, r.y - HANDLE_R, r.w + HANDLE_R * 2, r.h + HANDLE_R * 2); ctx.clip();
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  const fi = e.fadeIn * pxPerBeat, fo = e.fadeOut * pxPerBeat;
  if (fi > 0) { ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + fi, r.y); ctx.lineTo(r.x, r.y + r.h); ctx.closePath(); ctx.fill(); }
  if (fo > 0) { ctx.beginPath(); ctx.moveTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w - fo, r.y); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 1;
  if (fi > 0) { ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h); ctx.lineTo(r.x + fi, r.y); ctx.stroke(); }
  if (fo > 0) { ctx.beginPath(); ctx.moveTo(r.x + r.w - fo, r.y); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.stroke(); }
  const pts = handlePoints(e, r, pxPerBeat);
  const gy = Math.round(pts.gain.y) + 0.5;
  ctx.strokeStyle = th.color.handleGain; ctx.globalAlpha = e.gain === 1 && active !== "gain" ? 0.45 : 1;
  ctx.setLineDash(e.gain === 1 ? [4, 3] : []);
  ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (r.w >= 12) {
    for (const k of ["fadeIn", "fadeOut", "gain"] as const) {
      const p = pts[k];
      ctx.fillStyle = active === k ? th.color.selection : k === "gain" ? th.color.handleGain : th.color.handle; ctx.strokeStyle = th.color.handleStroke;
      ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}
