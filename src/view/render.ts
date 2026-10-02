import { eventId, keyId } from "../edit/selection";
import { evaluate, findKey } from "../core/curve";
import { lanePitch, visibleRowRange } from "../core/rows";
import type { RowLayout, Row, RowMetrics } from "../core/rows";
import { tickSteps, type GridMode } from "../core/time";
import type { AudioClip, Beats, Channel, ChannelGroup, Key, Section, Sequence, Track } from "../core/model";
import { beatToX, xToBeat } from "./viewState";
import { RULER_HEIGHT, drawRuler } from "./ruler";
import type { DrawContext } from "./layers";
import { drawEnvelope, envelopeOf } from "./audioHandles";
import { drawMarkers, drawWaveform } from "./lanesExtra";
import type { PeaksMap } from "./lanesExtra";
import { drawEventsLane } from "./eventsLane";
import { drawNestedSection } from "./nestedLane";
import type { SequenceResolver } from "../core/nested";
import { channelColor, colorGroupOf, drawChannelTint, drawColorStrip, keyFill } from "./colorLane";
import { darkTheme, type Theme } from "./theme";
import { clipRect, clipRound, fillBar, fillRound, glowBar, paintHook, strokeBarEdge, type Rect } from "./paint";

export interface RenderOptions {
  /** Theme to paint with (defaults to the DrawContext theme, then dark). */
  theme?: Theme;
  seq: Sequence;
  layout: RowLayout;
  /** Ids of selected sections (`sectionId`) for highlight. */
  selected?: ReadonlySet<string>;
  /** Selected key ids (`keyId`) drawn as enlarged white diamonds. */
  selectedKeys?: ReadonlySet<string>;
  /** Selected track / channel row ids: drawn as a tinted band with a left accent. */
  selectedTracks?: ReadonlySet<string>;
  selectedChannels?: ReadonlySet<string>;
  /** Selected audio clips (`eventId(trackId, clipId)`) and marker ids: drawn with the selection glow. */
  selectedClips?: ReadonlySet<string>;
  selectedMarkers?: ReadonlySet<string>;
  /** Host-supplied waveform peaks by `AudioClip.peaksId`. */
  peaks?: PeaksMap;
  /** Work range drawn as a band on the ruler. */
  range?: { start: Beats; end: Beats; loop?: boolean } | null;
  /** Row metrics the layout was built with (default metrics when absent). */
  metrics?: RowMetrics;
  /** Grid flavour for lines and the ruler readout (default straight). */
  gridMode?: GridMode;
  /** Host fallback for nested refs missing from `seq.library`. */
  resolveSequence?: SequenceResolver;
  /** Custom section painter (rect in canvas px, clipped to the section). Return true to skip the default fill and label. */
  renderSection?: (ctx: CanvasRenderingContext2D, section: Section, rect: { x: number; y: number; w: number; h: number }, track: Track) => boolean | void;
  /** Custom audio-clip painter (rect in canvas px, clipped to the clip). Return true to skip the default fill and waveform. */
  renderAudio?: (ctx: CanvasRenderingContext2D, clip: AudioClip, rect: { x: number; y: number; w: number; h: number }, track: Track) => boolean | void;
  /** Custom key painter for individual (non-decimated) keys: `rect` is the diamond's center and radius in canvas px. Return true to skip the default diamond. */
  renderKey?: (ctx: CanvasRenderingContext2D, key: Key, rect: { x: number; y: number; r: number }, info: { trackId: string; channelId: string; selected: boolean }) => boolean | void;
}

/** Keys closer than this many px collapse to one mark per pixel column. */
const LOD_PX = 3;

let occ = new Uint8Array(1024);
const valueRange = new WeakMap<Channel["keys"], [number, number]>();
function rangeOf(ch: Channel): [number, number] {
  // Cached per keys array (structural sharing makes the reference a valid cache key).
  let r = valueRange.get(ch.keys);
  if (!r) {
    let lo = Infinity, hi = -Infinity;
    for (const k of ch.keys) { if (k.value < lo) lo = k.value; if (k.value > hi) hi = k.value; }
    r = lo === Infinity ? [0, 1] : hi === lo ? [lo - 1, hi + 1] : [lo, hi];
    valueRange.set(ch.keys, r);
  }
  return r;
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.moveTo(x - r, y); ctx.lineTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.closePath();
}

/** Diamond into the batched path, or via the host's `renderKey` (flushes the batch around the hook). */
function markKey(ctx: CanvasRenderingContext2D, o: RenderOptions, trackId: string, channelId: string, k: Key, x: number, y: number, r: number, selected: boolean): void {
  if (o.renderKey) {
    ctx.fill(); ctx.save();
    const done = o.renderKey(ctx, k, { x, y, r }, { trackId, channelId, selected });
    ctx.restore(); ctx.beginPath();
    if (done) return;
  }
  diamond(ctx, x, y, r);
}

/** One key mark into the batched path; color-group tracks fill and outline each diamond on its own (flushes the batch). */
function keyMark(ctx: CanvasRenderingContext2D, th: Theme, o: RenderOptions, t: Track, channelId: string, k: Key, x: number, y: number, r: number, cg: ChannelGroup | undefined): void {
  if (!cg) { markKey(ctx, o, t.id, channelId, k, x, y, r, false); return; }
  // Color group: each diamond filled with the group's color at that key, outlined for contrast.
  ctx.beginPath(); ctx.fillStyle = keyFill(o.seq, t, cg, k.beat); ctx.strokeStyle = th.color.color.ring;
  markKey(ctx, o, t.id, channelId, k, x, y, r, false);
  ctx.fill(); ctx.stroke(); ctx.beginPath();
}

function drawChannel(ctx: CanvasRenderingContext2D, th: Theme, ch: Channel, view: DrawContext["view"], width: number, top: number, h: number, dim: boolean, o: RenderOptions, track: Track): void {
  const keys = ch.keys, cg = colorGroupOf(track);
  const line = channelColor(th, cg, ch) ?? th.color.curve;
  if (!keys.length) return;
  const b0 = xToBeat(view, -8), b1 = xToBeat(view, width + 8);
  const [vlo, vhi] = rangeOf(ch);
  const pad = 5, plotH = h - pad * 2;
  const yOf = (v: number) => top + pad + (1 - (v - vlo) / (vhi - vlo)) * plotH;
  const first = Math.max(0, findKey(keys, b0));
  let last = findKey(keys, b1) + 1;
  if (last >= keys.length) last = keys.length - 1;
  // Curve: polyline sampled every 3 px across the visible span of keyed range.
  const cx0 = Math.max(-8, beatToX(view, keys[0]!.beat)), cx1 = Math.min(width + 8, beatToX(view, keys[keys.length - 1]!.beat));
  if (cx1 > cx0 && keys.length > 1) {
    ctx.strokeStyle = line; ctx.globalAlpha = dim ? 0.5 : 0.95; ctx.lineWidth = 1.5; ctx.lineJoin = "round";
    ctx.beginPath();
    const step = keys.length > 1 && (last - first) * LOD_PX > width ? 4 : 2;
    for (let x = cx0; x <= cx1 + step; x += step) {
      const v = evaluate(ch, xToBeat(view, Math.min(x, cx1)));
      if (v === undefined) continue;
      if (x === cx0) ctx.moveTo(x, yOf(v)); else ctx.lineTo(x, yOf(v));
    }
    ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 1;
  }
  // Keys: one path, one fill; LOD bucketing by pixel column when dense.
  ctx.fillStyle = th.color.key; ctx.strokeStyle = th.color.keyStroke;
  ctx.beginPath();
  const dense = (last - first) * LOD_PX > width;
  let lastCol = -Infinity;
  for (let i = first; i <= last; i++) {
    const k = keys[i]!;
    const x = beatToX(view, k.beat);
    if (x < -8 || x > width + 8) continue;
    if (dense) {
      const col = Math.floor(x / LOD_PX);
      if (col === lastCol) continue;
      lastCol = col;
      ctx.rect(col * LOD_PX, yOf(k.value) - 1, 1.5, 3);
    } else keyMark(ctx, th, o, track, ch.id, k, Math.round(x), yOf(k.value), 4.5, cg);
  }
  ctx.fill(); if (!dense) ctx.stroke();
}

/** Selected keys of one row (channel row, or collapsed channels track) as white diamonds. */
function drawSelectedKeys(ctx: CanvasRenderingContext2D, th: Theme, row: Row, o: RenderOptions, c: DrawContext): void {
  const sel = o.selectedKeys;
  if (!sel?.size) return;
  const t = row.track, { view, width } = c;
  const top = RULER_HEIGHT + row.y - view.scrollY;
  const chans = row.kind === "channel" ? [row.channel] : t.kind === "channels" && !row.expanded ? t.channels : [];
  const b0 = xToBeat(view, -8), b1 = xToBeat(view, width + 8);
  ctx.fillStyle = th.color.selection; ctx.strokeStyle = th.color.key; ctx.lineWidth = 1.5; ctx.beginPath();
  for (const ch of chans) {
    const [vlo, vhi] = rangeOf(ch), pad = 5;
    for (let j = Math.max(0, findKey(ch.keys, b0)); j < ch.keys.length; j++) {
      const k = ch.keys[j]!;
      if (k.beat > b1) break;
      if (k.beat < b0 || !sel.has(keyId({ trackId: t.id, channelId: ch.id, beat: k.beat }))) continue;
      const y = row.kind === "channel" ? top + pad + (1 - (k.value - vlo) / (vhi - vlo)) * (row.h - pad * 2) : top + row.h / 2;
      markKey(ctx, o, t.id, ch.id, k, Math.round(beatToX(view, k.beat)), y, 6, true);
    }
  }
  ctx.shadowColor = th.color.selectionGlow; ctx.shadowBlur = 8;
  ctx.fill(); ctx.shadowBlur = 0; ctx.stroke(); ctx.lineWidth = 1;
}

function drawRowBg(ctx: CanvasRenderingContext2D, th: Theme, row: Row, i: number, c: DrawContext, o: RenderOptions): void {
  const top = RULER_HEIGHT + row.y - c.view.scrollY;
  ctx.fillStyle = i % 2 ? th.color.rowB : th.color.rowA;
  ctx.fillRect(0, top, c.width, row.h);
  ctx.fillStyle = th.color.rowLine; ctx.fillRect(0, top + row.h - 1, c.width, 1);
  if (row.kind === "channel" ? o.selectedChannels?.has(row.channel.id) : o.selectedTracks?.has(row.track.id)) {
    ctx.fillStyle = th.color.accentSoft; ctx.fillRect(0, top, c.width, row.h - 1);
    ctx.fillStyle = th.color.accent; ctx.fillRect(0, top, 3, row.h - 1);
  }
}

function drawSection(ctx: CanvasRenderingContext2D, th: Theme, o: RenderOptions, t: Track, s: Section, rect: Rect, view: DrawContext["view"]): void {
  const c = th.color, { x, y, w, h } = rect, r = th.radius.bar;
  ctx.globalAlpha = t.muted ? 0.4 : 1;
  const custom = paintHook(ctx, rect, o.renderSection, s, rect, t);
  if (!custom) {
    fillBar(ctx, th, s.color ?? c.section, x, y, w, h);
    if (s.ref) { clipRound(ctx, x, y, w, h, r); drawNestedSection(ctx, o.seq, s, rect, view.pxPerBeat, o.resolveSequence, th); ctx.restore(); }
    if (w > 4) strokeBarEdge(ctx, th, x, y, w, h, r);
  }
  ctx.globalAlpha = 1;
  if (o.selected?.has(s.id)) glowBar(ctx, th, x, y, w, h);
  if (!custom && s.label && w > 24) {
    clipRect(ctx, x + 2, y, w - 4, h);
    ctx.font = `600 ${th.font.size}px ${th.font.ui}`; ctx.textBaseline = h > 32 ? "top" : "middle";
    const lx = Math.round(Math.max(x, 0) + 7), ly = Math.round(h > 32 ? y + 6 : y + h / 2 + 0.5);
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillText(s.label, lx, ly + 1);
    ctx.fillStyle = c.textOnBar; ctx.fillText(s.label, lx, ly);
    ctx.restore();
  }
}

function drawSectionsTrack(ctx: CanvasRenderingContext2D, th: Theme, t: Extract<Track, { kind: "sections" }>, top: number, laneH: number, o: RenderOptions, c: DrawContext): void {
  const { view, width } = c, b0 = xToBeat(view, 0), b1 = xToBeat(view, width);
  for (const s of t.sections) {
    if (s.start + s.length < b0 || s.start > b1) continue;
    drawSection(ctx, th, o, t, s, { x: beatToX(view, s.start), y: top + Math.floor(s.row) * laneH + 2, w: Math.max(2, s.length * view.pxPerBeat), h: laneH - 4 }, view);
  }
}

/** Audio clip label chip over the waveform, clipped to the clip. */
function drawClipLabel(ctx: CanvasRenderingContext2D, th: Theme, label: string, { x, y, w, h }: Rect): void {
  clipRect(ctx, x + 2, y, w - 4, h);
  ctx.font = `600 ${th.font.small}px ${th.font.ui}`; ctx.textBaseline = "middle";
  const lx = Math.round(Math.max(x, 0) + 14), cw = Math.min(ctx.measureText(label).width + 8, x + w - lx - 2);
  fillRound(ctx, th.color.popup, lx - 4, y + 3, cw, 14, th.radius.chip);
  ctx.fillStyle = th.color.text; ctx.fillText(label, lx, y + 10.5);
  ctx.restore();
}

function drawAudioTrack(ctx: CanvasRenderingContext2D, th: Theme, t: Extract<Track, { kind: "audio" }>, top: number, h: number, o: RenderOptions, c: DrawContext): void {
  const { view, width } = c, b0 = xToBeat(view, 0), b1 = xToBeat(view, width), r = th.radius.bar;
  for (const a of t.clips) {
    if (a.start + a.length < b0 || a.start > b1) continue;
    const rect: Rect = { x: beatToX(view, a.start), y: top + 2, w: Math.max(2, a.length * view.pxPerBeat), h: h - 4 };
    if (paintHook(ctx, rect, o.renderAudio, a, rect, t)) continue;
    const { x, y, w, h: ah } = rect;
    fillBar(ctx, th, th.color.audio, x, y, w, ah);
    const mips = a.peaksId ? o.peaks?.get(a.peaksId) : undefined;
    clipRound(ctx, x, y, w, ah, r);
    if (mips) drawWaveform(ctx, a, mips, o.seq.tempo, view, width, y, ah, th);
    ctx.restore();
    strokeBarEdge(ctx, th, x, y, w, ah, r);
    if (o.selectedClips?.has(eventId(t.id, a.id))) glowBar(ctx, th, x, y, w, ah);
    if (!t.locked) drawEnvelope(ctx, envelopeOf(a), rect, view.pxPerBeat, undefined, th);
    if (a.label && w > 24) drawClipLabel(ctx, th, a.label, rect);
  }
}

/**
 * Collapsed channels: summary of all channels' keys merged onto one line. One occupancy
 * bitmap per row dedupes marks across channels; dense columns draw a 1.5px tick
 * instead of a diamond (cheaper path, no overdraw).
 */
function drawCollapsedChannels(ctx: CanvasRenderingContext2D, th: Theme, t: Extract<Track, { kind: "channels" }>, top: number, h: number, o: RenderOptions, c: DrawContext): void {
  const { view, width } = c, cg = colorGroupOf(t);
  const ncol = Math.ceil((width + 16) / LOD_PX) + 1;
  if (occ.length < ncol) occ = new Uint8Array(ncol); else occ.fill(0, 0, ncol);
  const cy = top + h / 2;
  ctx.fillStyle = th.color.key; ctx.strokeStyle = th.color.keyStroke; ctx.beginPath();
  const lo = xToBeat(view, 0) - 8 / view.pxPerBeat, hi = xToBeat(view, width + 8);
  let nVisible = 0;
  for (const ch of t.channels) nVisible += findKey(ch.keys, hi) - findKey(ch.keys, lo);
  const dense = !o.renderKey && nVisible * LOD_PX > width;
  for (const ch of t.channels) {
    const keys = ch.keys;
    for (let j = Math.max(0, findKey(keys, lo)); j < keys.length; j++) {
      const k = keys[j]!, x = beatToX(view, k.beat);
      if (x > width + 8) break;
      if (x < -8) continue;
      const col = ((x + 8) / LOD_PX) | 0;
      if (occ[col]) continue;
      occ[col] = 1;
      if (dense) ctx.rect(Math.round(x) - 1, cy - 2, 2, 4);
      else keyMark(ctx, th, o, t, ch.id, k, Math.round(x), cy, 3.5, cg);
    }
  }
  ctx.fill(); if (!dense) ctx.stroke();
}

function drawRow(ctx: CanvasRenderingContext2D, th: Theme, row: Row, o: RenderOptions, c: DrawContext): void {
  const { width, view } = c;
  const top = RULER_HEIGHT + row.y - view.scrollY;
  if (row.kind === "channel") {
    const g = colorGroupOf(row.track);
    if (g) drawChannelTint(ctx, th, g, row.channel, width, top, row.h);
    drawChannel(ctx, th, row.channel, view, width, top, row.h, false, o, row.track); drawSelectedKeys(ctx, th, row, o, c); return;
  }
  const t = row.track, cg = colorGroupOf(t);
  if (cg) drawColorStrip(ctx, th, o.seq, t, cg, view, width, top, row.h);
  if (t.kind === "sections") drawSectionsTrack(ctx, th, t, top, lanePitch(t, o.metrics), o, c);
  else if (t.kind === "events") drawEventsLane(ctx, t.events, view, width, top + row.h / 2, t.muted, th);
  else if (t.kind === "audio") drawAudioTrack(ctx, th, t, top, row.h, o, c);
  else if (t.kind === "channels" && !row.expanded) { drawCollapsedChannels(ctx, th, t, top, row.h, o, c); drawSelectedKeys(ctx, th, row, o, c); }
}

/** Static layer: backdrop, beat grid, visible rows (culled), then the ruler on top. */
export function drawBody(c: DrawContext, o: RenderOptions): void {
  const { ctx, width, height, view } = c;
  const { seq, layout } = o;
  const th = o.theme ?? c.theme ?? darkTheme;
  ctx.fillStyle = th.color.bg; ctx.fillRect(0, 0, width, height);
  ctx.font = `${th.font.size}px ${th.font.ui}`; ctx.textBaseline = "top"; ctx.lineWidth = 1;
  const [a, b] = visibleRowRange(layout, view.scrollY, view.scrollY + height - RULER_HEIGHT);
  ctx.save(); ctx.beginPath(); ctx.rect(0, RULER_HEIGHT, width, height - RULER_HEIGHT); ctx.clip();
  for (let i = a; i < b; i++) drawRowBg(ctx, th, layout.rows[i]!, i, c, o);
  const gridBottom = Math.min(height, RULER_HEIGHT + layout.totalHeight - view.scrollY);
  // Area past the sequence end.
  const endX = beatToX(view, seq.length);
  if (endX < width) { ctx.fillStyle = th.color.pastEnd; ctx.fillRect(Math.max(0, endX), RULER_HEIGHT, width - Math.max(0, endX), gridBottom - RULER_HEIGHT); }
  // Grid over rows: three weights (subdivision, beat, bar), one stroke each.
  const { minor, major } = tickSteps(view.pxPerBeat, seq.beatsPerBar, undefined, undefined, o.gridMode);
  const bpb = seq.beatsPerBar, near = (v: number, step: number) => Math.abs(v / step - Math.round(v / step)) < 1e-6;
  const gMinor = new Path2D(), gBeat = new Path2D(), gBar = new Path2D();
  for (let beat = Math.max(0, Math.floor(view.startBeat / minor) * minor); beat <= xToBeat(view, width); beat += minor) {
    const x = Math.round(beatToX(view, beat)) + 0.5;
    const p = near(beat, bpb) ? gBar : near(beat, Math.max(1, major >= 1 ? 1 : major)) || near(beat, major) ? gBeat : gMinor;
    p.moveTo(x, RULER_HEIGHT); p.lineTo(x, gridBottom);
  }
  ctx.strokeStyle = th.color.gridMinor; ctx.stroke(gMinor);
  ctx.strokeStyle = th.color.gridBeat; ctx.stroke(gBeat);
  ctx.strokeStyle = th.color.gridBar; ctx.stroke(gBar);
  for (let i = a; i < b; i++) drawRow(ctx, th, layout.rows[i]!, o, c);
  drawMarkers(ctx, seq.markers, view, width, RULER_HEIGHT, gridBottom, th, o.selectedMarkers);
  ctx.restore();
  drawRuler(c, { tempo: seq.tempo, beatsPerBar: seq.beatsPerBar, length: seq.length, range: o.range, gridMode: o.gridMode });
}

/** Overlay layer: playhead line and head. Cheap; never repaints the static layer. */
export function drawPlayhead({ ctx, height, view, theme }: DrawContext, beat: Beats): void {
  const th = theme ?? darkTheme;
  const x = Math.round(beatToX(view, beat)) + 0.5;
  ctx.fillStyle = th.color.playheadGlow; ctx.fillRect(x - 2, 0, 4, height);
  ctx.strokeStyle = th.color.playhead; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  ctx.fillStyle = th.color.playhead; ctx.beginPath();
  ctx.moveTo(x - 6, 1); ctx.lineTo(x + 6, 1); ctx.lineTo(x + 6, 8); ctx.lineTo(x, 15); ctx.lineTo(x - 6, 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.fillRect(x - 0.5, 4, 1, 5);
}
