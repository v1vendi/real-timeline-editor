// Color channel groups on the canvas: gradient strip over time, per-channel tint and curve color, key fill,
// hover readout chip. Color maths lives in ../color (pure); this file only paints. LOD: stop count follows pixel width.
import { colorAt, colorStops, toCss, toHex, type ColorStop } from "../core/color";
import type { Beats, Channel, ChannelGroup, Sequence, Track } from "../core/model";
import { visibleRowRange, type RowLayout } from "../core/rows";
import { beatToX, xToBeat, type ViewState } from "./viewState";
import { roundRectPath, type Theme } from "./theme";

const KINDS = new Set(["rgb", "rgba", "hsv", "hue"]);

/** First color-kind group of a channels track (the one the strip and swatch show). */
export function colorGroupOf(t: Track): ChannelGroup | undefined {
  if (t.kind !== "channels" || !t.groups) return undefined;
  for (const g of t.groups) if (g.kind && KINDS.has(g.kind)) return g;
  return undefined;
}

/** Theme color for channel `idx` of a color group (its curve / tint color); undefined when the group is not a color group. */
export function channelColor(th: Theme, g: ChannelGroup | undefined, ch: Channel): string | undefined {
  if (!g || !g.kind || !KINDS.has(g.kind)) return undefined;
  const i = g.channelIds.indexOf(ch.id), c = th.color.color;
  if (i < 0) return undefined;
  const set = g.kind === "hue" ? [c.h] : g.kind === "hsv" ? [c.h, c.s, c.v, c.a] : [c.r, c.g, c.b, c.a];
  return set[i];
}

const isHue = (g: ChannelGroup, idx: number) => idx === 0 && (g.kind === "hue" || g.kind === "hsv");
const HUES = [0, 60, 120, 180, 240, 300, 360];

/** Faint tint behind an expanded channel row in the color of the channel it edits. */
export function drawChannelTint(ctx: CanvasRenderingContext2D, th: Theme, g: ChannelGroup, ch: Channel, width: number, top: number, h: number): void {
  const i = g.channelIds.indexOf(ch.id);
  if (i < 0) return;
  ctx.save(); ctx.globalAlpha = 0.2;
  if (isHue(g, i)) {
    const gr = ctx.createLinearGradient(0, 0, width, 0);
    for (const hu of HUES) gr.addColorStop(hu / 360, `hsl(${hu},90%,55%)`);
    ctx.fillStyle = gr;
  } else ctx.fillStyle = channelColor(th, g, ch) ?? "transparent";
  ctx.fillRect(0, top, width, h - 1);
  ctx.restore();
}

let checker: { key: string; p: CanvasPattern } | null = null;
function checkerPattern(ctx: CanvasRenderingContext2D, th: Theme): CanvasPattern | null {
  const { checkerA: a, checkerB: b } = th.color.color, key = a + b;
  if (checker?.key === key) return checker.p;
  const c = document.createElement("canvas"); c.width = c.height = 8;
  const x = c.getContext("2d")!;
  x.fillStyle = a; x.fillRect(0, 0, 8, 8); x.fillStyle = b; x.fillRect(0, 0, 4, 4); x.fillRect(4, 4, 4, 4);
  const p = ctx.createPattern(c, "repeat");
  if (p) checker = { key, p };
  return p;
}

/** Number of keys of `c` inside (t0, t1), by binary search. */
function keysIn(c: Channel, t0: Beats, t1: Beats): number {
  const lb = (b: number) => { let lo = 0, hi = c.keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (c.keys[m]!.beat <= b) lo = m + 1; else hi = m; } return lo; };
  return Math.max(0, lb(t1 - 1e-9) - lb(t0));
}

/**
 * Stops for the strip. colorStops is exact (hard steps, bezier samples) but super-linear in the keys in view;
 * once the keys are denser than the stop budget they are sub-pixel anyway, so sample uniformly instead.
 */
function stripStops(seq: Sequence, t: Track, g: ChannelGroup, b0: Beats, b1: Beats, maxStops: number): ColorStop[] {
  // Repaints with an unchanged view (selection, hover, scroll) reuse the last stops; edits make a new Track object.
  const key = `${g.id}|${b0}|${b1}|${maxStops}`, hit = stopCache.get(t);
  if (hit && hit.key === key) return hit.stops;
  const stops = computeStops(seq, t, g, b0, b1, maxStops);
  stopCache.set(t, { key, stops });
  return stops;
}
const stopCache = new WeakMap<Track, { key: string; stops: ColorStop[] }>();

function computeStops(seq: Sequence, t: Track, g: ChannelGroup, b0: Beats, b1: Beats, maxStops: number): ColorStop[] {
  let n = 0;
  if (t.kind === "channels") for (const id of g.channelIds) { const c = t.channels.find((x) => x.id === id); if (c) n += keysIn(c, b0, b1); }
  if (n * 2 <= maxStops) return colorStops(seq, t.id, g.id, b0, b1, maxStops);
  const out: ColorStop[] = [];
  for (let i = 0; i < maxStops; i++) { const b = b0 + ((b1 - b0) * i) / (maxStops - 1), c = colorAt(seq, t.id, g.id, b); if (!c) return []; out.push({ beat: b, css: toCss(c) }); }
  return out;
}

/** Gradient strip of the group's color over the visible span (hard steps stay hard; checkerboard under alpha). */
export function drawColorStrip(ctx: CanvasRenderingContext2D, th: Theme, seq: Sequence, t: Track, g: ChannelGroup, view: ViewState, width: number, top: number, h: number): void {
  const b0 = Math.max(0, xToBeat(view, 0)), b1 = Math.min(seq.length, xToBeat(view, width));
  if (!(b1 > b0)) return;
  const x0 = Math.max(0, beatToX(view, b0)), x1 = Math.min(width, beatToX(view, b1));
  const stops = stripStops(seq, t, g, b0, b1, Math.max(2, Math.min(128, Math.floor((x1 - x0) / 3))));
  if (!stops.length) return;
  const gr = ctx.createLinearGradient(x0, 0, x1, 0), span = b1 - b0;
  for (const s of stops) gr.addColorStop(Math.min(1, Math.max(0, (s.beat - b0) / span)), s.css);
  const y = top + 3, hh = h - 7;
  ctx.save(); ctx.beginPath(); roundRectPath(ctx, x0, y, x1 - x0, hh, 3); ctx.clip();
  if (g.channelIds.length > 3) { const p = checkerPattern(ctx, th); if (p) { ctx.fillStyle = p; ctx.fillRect(x0, y, x1 - x0, hh); } }
  ctx.fillStyle = gr; ctx.fillRect(x0, y, x1 - x0, hh);
  ctx.restore();
  ctx.strokeStyle = th.color.shade; ctx.beginPath(); roundRectPath(ctx, x0 + 0.5, y + 0.5, x1 - x0 - 1, hh - 1, 3); ctx.stroke();
}

/** CSS color of the group at `beat` (for key fills). */
export function keyFill(seq: Sequence, t: Track, g: ChannelGroup, beat: Beats): string {
  const c = colorAt(seq, t.id, g.id, beat);
  return c ? toCss(c) : "transparent";
}

/** Color row under canvas y (content space = y - ruler + scrollY), if any. */
export function colorRowAt(layout: RowLayout, contentY: number): { track: Track; group: ChannelGroup } | undefined {
  const [a, b] = visibleRowRange(layout, contentY, contentY + 1);
  for (let i = a; i < b; i++) {
    const r = layout.rows[i]!, g = colorGroupOf(r.track);
    if (g && contentY >= r.y && contentY < r.y + r.h) return { track: r.track, group: g };
  }
  return undefined;
}

/** Overlay chip next to the cursor: swatch, hex and rgba of the group at the cursor beat. */
export function drawColorReadout(ctx: CanvasRenderingContext2D, th: Theme, seq: Sequence, hit: { track: Track; group: ChannelGroup }, view: ViewState, x: number, y: number, width: number): void {
  const beat = xToBeat(view, x), c = colorAt(seq, hit.track.id, hit.group.id, beat);
  if (!c) return;
  const rgba = `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Math.round((c.a / 255) * 100) / 100})`;
  const txt = `${toHex(c)}  ${rgba}  @${beat.toFixed(2)}`;
  ctx.save(); ctx.font = `${th.font.small}px ${th.font.mono}`; ctx.textBaseline = "middle";
  const w = ctx.measureText(txt).width + 30, h = 20;
  const cx = x + 14 + w > width ? x - 10 - w : x + 14, cy = Math.max(2, y - h - 6);
  ctx.fillStyle = th.color.popup; ctx.beginPath(); roundRectPath(ctx, cx, cy, w, h, th.radius.chip); ctx.fill();
  ctx.strokeStyle = th.color.popupBorder; ctx.stroke();
  const p = checkerPattern(ctx, th);
  if (p) { ctx.fillStyle = p; ctx.fillRect(cx + 4, cy + 4, 12, 12); }
  ctx.fillStyle = toCss(c); ctx.fillRect(cx + 4, cy + 4, 12, 12);
  ctx.strokeStyle = th.color.popupBorder; ctx.strokeRect(cx + 3.5, cy + 3.5, 13, 13);
  ctx.fillStyle = th.color.text; ctx.fillText(txt, cx + 22, cy + h / 2 + 0.5);
  ctx.restore();
}
