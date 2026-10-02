// Small canvas painting helpers shared by the draw files (render, lanes, ruler). No state, no DOM access.
import { fillSheen, roundRectPath, type Theme } from "./theme";

export interface Rect { x: number; y: number; w: number; h: number }

/** Begin a clip to a plain rect. Pair with `ctx.restore()`. */
export function clipRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
}

/** Begin a clip to a rounded rect. Pair with `ctx.restore()`. */
export function clipRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.save(); ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); ctx.clip();
}

/** Fill a new rounded-rect path with `fill`. */
export function fillRound(ctx: CanvasRenderingContext2D, fill: string, x: number, y: number, w: number, h: number, r: number): void {
  ctx.fillStyle = fill; ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); ctx.fill();
}

/** Hairline outline (theme `shade`) inset by half a pixel, for bars. */
export function strokeBarEdge(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, w: number, h: number, r: number): void {
  ctx.strokeStyle = th.color.shade; ctx.beginPath(); roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke();
}

/** Selection outline with glow around a rounded rect (the rect is the stroke path as given). */
export function glowRound(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, w: number, h: number, r: number, blur: number, lineWidth: number): void {
  ctx.save(); ctx.shadowColor = th.color.selectionGlow; ctx.shadowBlur = blur; ctx.strokeStyle = th.color.selection; ctx.lineWidth = lineWidth;
  ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore();
}

/** Bar body: solid fill plus the sheen gradient. */
export function fillBar(ctx: CanvasRenderingContext2D, th: Theme, fill: string, x: number, y: number, w: number, h: number): void {
  const r = th.radius.bar;
  fillRound(ctx, fill, x, y, w, h, r); fillSheen(ctx, th, x, y, w, h, r);
}

/** Selection glow on a bar (section / clip), inset so the stroke sits inside the rect. */
export function glowBar(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, w: number, h: number): void {
  glowRound(ctx, th, x + 0.75, y + 0.75, w - 1.5, h - 1.5, th.radius.bar, 9, 1.5);
}

/** Run a host paint hook clipped to `rect`; true when it handled the drawing. */
export function paintHook<A extends unknown[]>(ctx: CanvasRenderingContext2D, rect: Rect, hook: ((ctx: CanvasRenderingContext2D, ...a: A) => boolean | void) | undefined, ...a: A): boolean {
  if (!hook) return false;
  clipRect(ctx, rect.x, rect.y, rect.w, rect.h);
  const done = !!hook(ctx, ...a);
  ctx.restore();
  return done;
}
