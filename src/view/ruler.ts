import { beatToSeconds, type Beats, type Marker, type TempoPoint } from "../core/model";
import { gridStep, tickSteps, type GridMode } from "../core/time";
import { resolveSnap, type SnapProvider } from "../core/snap";
import { beatToX, xToBeat, type ViewState } from "./viewState";
import type { DrawContext } from "./layers";
import { darkTheme, type Theme } from "./theme";
import { fillRound } from "./paint";

interface RulerOptions {
  tempo: TempoPoint[];
  beatsPerBar: number;
  /** Sequence length in beats; area past it is shaded. */
  length: Beats;
  /** Ruler strip height in CSS px (drawn from y = 0). */
  height?: number;
  /** Sequence.markers: a flag at the marker beat with its label. */
  markers?: Marker[];
  /** Work / selection range in beats, drawn as a translucent band with edge lines. */
  range?: { start: Beats; end: Beats; loop?: boolean } | null;
  /** Grid flavour for ticks; the current step is shown as a readout chip at the right edge. */
  gridMode?: GridMode;
}

export const RULER_HEIGHT = 28;
const EPS = 1e-6;

/** Label for a beat: `bar`, `bar.beat` or `bar.beat.sub` (1-based; sub in 1/64ths shown as tick index from 1). */
function beatLabel(beat: Beats, beatsPerBar: number, major: Beats): string {
  const bar = Math.floor(beat / beatsPerBar + EPS);
  const inBar = beat - bar * beatsPerBar;
  if (inBar < EPS) return String(bar + 1);
  const whole = Math.floor(inBar + EPS);
  const frac = inBar - whole;
  if (major >= 1 || frac < EPS) return `${bar + 1}.${whole + 1}`;
  return `${bar + 1}.${whole + 1}.${Math.round(frac / major) + 1}`;
}

/** Width of the grid readout chip at the ruler's right edge (clickable: cycles the grid mode). */
export const GRID_CHIP_W = 52;

/** Readout for a grid step in beats (beat = quarter note): `1/16`, `1/8T` (triplet), `1/8.` (dotted), `2 bars`. */
function gridLabel(step: Beats, beatsPerBar: number, mode: GridMode = "straight"): string {
  if (step >= beatsPerBar - EPS) { const n = Math.round(step / beatsPerBar); return n === 1 ? "1 bar" : `${n} bars`; }
  const f = mode === "triplet" ? 2 / 3 : mode === "dotted" ? 1.5 : 1;
  const denom = Math.round(4 / (step / f));
  return `1/${denom}${mode === "triplet" ? "T" : mode === "dotted" ? "." : ""}`;
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(r < 10 ? 2 : 1).padStart(r < 10 ? 5 : 4, "0")}` : `${r.toFixed(2)}s`;
}

/** Draw the ruler strip into the static layer: minor/major ticks, bars.beats labels, seconds underneath. */
export function drawRuler({ ctx, width, view, theme }: DrawContext, o: RulerOptions): void {
  const th = theme ?? darkTheme, c = th.color;
  const h = o.height ?? RULER_HEIGHT;
  const { major, minor } = tickSteps(view.pxPerBeat, o.beatsPerBar, undefined, undefined, o.gridMode);
  ctx.fillStyle = c.rulerBg;
  ctx.fillRect(0, 0, width, h);

  // Out-of-range shading.
  const x0 = beatToX(view, 0);
  const x1 = beatToX(view, o.length);
  ctx.fillStyle = c.pastEnd;
  if (x0 > 0) ctx.fillRect(0, 0, Math.min(x0, width), h);
  if (x1 < width) ctx.fillRect(Math.max(x1, 0), 0, width - Math.max(x1, 0), h);

  const first = Math.max(0, Math.floor(view.startBeat / minor) * minor);
  const last = view.startBeat + width / view.pxPerBeat;
  ctx.textBaseline = "top";
  const n = Math.ceil((last - first) / minor);
  const tMinor = new Path2D(), tBeat = new Path2D(), tBar = new Path2D();
  const labels: { x: number; beat: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const beat = first + i * minor;
    const x = Math.round(beatToX(view, beat)) + 0.5;
    const isMajor = Math.abs(beat / major - Math.round(beat / major)) < EPS;
    const isBar = Math.abs(beat / o.beatsPerBar - Math.round(beat / o.beatsPerBar)) < EPS;
    const p = isBar ? tBar : isMajor ? tBeat : tMinor;
    const tickH = isBar ? h - 6 : isMajor ? h * 0.42 : h * 0.22;
    p.moveTo(x, h - tickH); p.lineTo(x, h);
    if (isMajor) labels.push({ x, beat });
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.rulerTick; ctx.stroke(tMinor);
  ctx.strokeStyle = c.rulerTickStrong; ctx.globalAlpha = 0.7; ctx.stroke(tBeat); ctx.globalAlpha = 1;
  ctx.strokeStyle = c.rulerTickStrong; ctx.stroke(tBar);
  for (const l of labels) {
    ctx.font = `600 ${th.font.small + 1}px ${th.font.ui}`; ctx.fillStyle = c.rulerText;
    ctx.fillText(beatLabel(l.beat, o.beatsPerBar, major), l.x + 4, 3);
    ctx.font = `${th.font.small}px ${th.font.ui}`; ctx.fillStyle = c.rulerSub;
    ctx.fillText(formatSeconds(beatToSeconds(o.tempo, l.beat)), l.x + 4, 15);
  }
  if (o.range && o.range.end > o.range.start) drawRange(ctx, th, view, width, h, o.range);
  if (o.markers) drawMarkers(ctx, view, width, h, o.markers, th);
  drawGridChip(ctx, th, width, h, gridLabel(minor, o.beatsPerBar, o.gridMode), o.gridMode ?? "straight");
  ctx.strokeStyle = c.rulerLine;
  ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(width, h - 0.5); ctx.stroke();
}

/** Work-range band with edge lines; a loop range adds a bracket along the bottom edge. */
function drawRange(ctx: CanvasRenderingContext2D, th: Theme, view: ViewState, width: number, h: number, range: { start: Beats; end: Beats; loop?: boolean }): void {
  const c = th.color, rx0 = Math.round(beatToX(view, range.start)) + 0.5, rx1 = Math.round(beatToX(view, range.end)) + 0.5;
  if (rx1 < 0 || rx0 > width) return;
  ctx.fillStyle = c.range;
  ctx.fillRect(rx0, 0, rx1 - rx0, h);
  ctx.strokeStyle = c.rangeEdge;
  ctx.beginPath();
  ctx.moveTo(rx0, 0); ctx.lineTo(rx0, h);
  ctx.moveTo(rx1, 0); ctx.lineTo(rx1, h);
  ctx.stroke();
  if (!range.loop) return;
  ctx.strokeStyle = c.loop; ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(rx0 + 7, h - 9); ctx.lineTo(rx0 + 2, h - 9); ctx.lineTo(rx0 + 2, h - 2); ctx.lineTo(rx1 - 2, h - 2); ctx.lineTo(rx1 - 2, h - 9); ctx.lineTo(rx1 - 7, h - 9);
  ctx.stroke(); ctx.lineWidth = 1; ctx.lineCap = "butt";
}

/** Grid readout chip at the right edge (accent-filled when the grid is not straight). */
function drawGridChip(ctx: CanvasRenderingContext2D, th: Theme, width: number, h: number, text: string, mode: GridMode): void {
  const c = th.color, straight = mode === "straight", cx = width - GRID_CHIP_W - 4;
  fillRound(ctx, straight ? c.chip : c.chipActive, cx, 4, GRID_CHIP_W, h - 9, th.radius.chip + 1);
  ctx.fillStyle = straight ? c.chipText : c.chipActiveText;
  ctx.font = `600 ${th.font.small + 1}px ${th.font.ui}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
  ctx.fillText(text, cx + GRID_CHIP_W / 2, h / 2 - 0.5);
  ctx.textAlign = "left"; ctx.textBaseline = "top";
}

/** Marker flags: a small pennant at the top of the ruler plus a label; drawn over the ticks. */
function drawMarkers(ctx: CanvasRenderingContext2D, view: ViewState, width: number, h: number, markers: Marker[], th: Theme): void {
  ctx.font = `600 ${th.font.small}px ${th.font.ui}`;
  ctx.textBaseline = "top";
  for (const m of markers) {
    const x = Math.round(beatToX(view, m.beat)) + 0.5;
    if (x < -2 || x > width + 2) { // label may still reach in from the left
      if (x > width + 2 || x + ctx.measureText(m.label).width + 12 < 0) continue;
    }
    const color = m.color ?? th.color.marker;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 7, 4); ctx.lineTo(x, 8); ctx.closePath(); ctx.fill();
    if (m.label) {
      const w = ctx.measureText(m.label).width;
      ctx.globalAlpha = 0.9; fillRound(ctx, th.color.rulerBg, x + 9, h - 14, w + 6, 12, 3); ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillText(m.label, x + 12, h - 13);
    }
  }
}

interface ScrubOptions {
  beatsPerBar: number | (() => number);
  /** Grid flavour for the default scrub snap. */
  gridMode?: GridMode | (() => GridMode);
  /** Extra snap targets (keys, section edges, markers) used when Shift is held. */
  targets?: () => Beats[];
  /** Real snap providers (src/snap.ts defaultProviders). Shift snaps to their non-grid targets; takes precedence over `targets`. */
  providers?: SnapProvider[];
  /** Shift+drag on the ruler sets the work range instead of scrubbing (snaps to keys/edges/markers); a Shift+click without drag passes null. */
  onRange?(range: { start: Beats; end: Beats; loop?: boolean } | null): void;
  /** Snap threshold in px for `targets`. */
  targetPx?: number;
}

/** Beat for a pointer x on the ruler: grid-snapped by default, free with Alt, nearest target with Shift. Clamped to >= 0. */
function scrubBeat(view: ViewState, x: number, mods: { alt?: boolean; shift?: boolean }, o: ScrubOptions): Beats {
  const raw = Math.max(0, xToBeat(view, x));
  if (mods.alt) return raw;
  const bpb = typeof o.beatsPerBar === "function" ? o.beatsPerBar() : o.beatsPerBar;
  if (mods.shift && o.providers) {
    const nonGrid: SnapProvider = (ctx) => o.providers!.flatMap((p) => p(ctx)).filter((t) => t.kind !== "grid");
    const hit = resolveSnap([nonGrid], {
      pxPerBeat: view.pxPerBeat, beatsPerBar: bpb, beat: raw,
      range: [raw - 64 / view.pxPerBeat, raw + 64 / view.pxPerBeat],
    }, { thresholdPx: o.targetPx });
    return Math.max(0, hit?.beat ?? raw);
  }
  if (mods.shift && o.targets) {
    let best = raw;
    let bestD = (o.targetPx ?? 8) / view.pxPerBeat;
    for (const t of o.targets()) {
      const d = Math.abs(t - raw);
      if (d <= bestD) { best = t; bestD = d; }
    }
    return Math.max(0, best);
  }
  const step = gridStep(view.pxPerBeat, bpb, undefined, typeof o.gridMode === "function" ? o.gridMode() : o.gridMode);
  return Math.max(0, Math.round(raw / step) * step);
}

/**
 * Pointer scrub on `el` (the ruler strip). Down starts, move continues (pointer captured),
 * each change calls `onSeek(beat)`. The host owns the clock; this only requests seeks.
 * Returns a detach function.
 */
export function attachScrub(
  el: HTMLElement,
  getView: () => ViewState,
  o: ScrubOptions,
  onSeek: (beat: Beats) => void,
  rulerHeight = RULER_HEIGHT,
): () => void {
  let active = false;
  let anchor: { beat: Beats; moved: boolean } | null = null;
  const seek = (e: PointerEvent) => {
    const x = e.clientX - el.getBoundingClientRect().left;
    if (anchor) {
      const b = scrubBeat(getView(), x, { alt: e.altKey, shift: true }, o);
      if (b !== anchor.beat) { anchor.moved = true; o.onRange?.({ start: Math.min(anchor.beat, b), end: Math.max(anchor.beat, b), loop: true }); }
      return;
    }
    onSeek(scrubBeat(getView(), x, { alt: e.altKey, shift: e.shiftKey }, o));
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || e.clientY - el.getBoundingClientRect().top > rulerHeight) return;
    active = true;
    el.setPointerCapture(e.pointerId);
    if (e.shiftKey && o.onRange) anchor = { beat: scrubBeat(getView(), e.clientX - el.getBoundingClientRect().left, { alt: e.altKey, shift: true }, o), moved: false };
    else seek(e);
  };
  const move = (e: PointerEvent) => { if (active) seek(e); };
  const up = () => { if (active && anchor && !anchor.moved) o.onRange?.(null); active = false; anchor = null; };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
}
