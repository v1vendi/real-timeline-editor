// Hit-testing in content space (pure math, no DOM). Precedence (docs/behavior.md section 4): keys above
// section/clip bars; section edges (trim) above body (move); clicking a body never hits its keys.
import type { Channel, Section } from "../core/model";
import { findKey, handlesOf } from "../core/curve";
import { lanePitch, laneAtY, rowAtY, DEFAULT_ROW_METRICS, type Row, type RowLayout, type RowMetrics } from "../core/rows";
import { beatToX, xToBeat, type ViewState } from "./viewState";
import { hitEvent } from "./eventsLane";
import { hitClipHandle, type ClipHandle } from "./audioHandles";
import { colorGroupOf } from "./colorLane";

interface HitOptions {
  /** Key pick radius in px (x only; keys are hit anywhere vertically in their row). */
  keyTolPx: number;
  /** Width of the trim zone inside each end of a section, px (capped at 1/3 of its width). */
  edgePx: number;
  metrics: RowMetrics;
  /** Pick radius of tangent and ease handles, px (euclidean). */
  handlePx: number;
  /** Curve view only: enables tangent-handle hits on channel rows (handles exist only for selected keys). */
  curve?: { valueToY: (value: number, channelId?: string) => number; isKeySelected: (channelId: string, keyIndex: number) => boolean };
}
export const DEFAULT_HIT_OPTIONS: HitOptions = { keyTolPx: 6, edgePx: 6, metrics: DEFAULT_ROW_METRICS, handlePx: 6 };

export type Hit =
  | { kind: "none" }
  | { kind: "row"; row: Row; beat: number }
  | { kind: "key"; row: Row; channelId: string; keyIndex: number; beat: number }
  | { kind: "tangent"; row: Row; channelId: string; keyIndex: number; side: "in" | "out"; beat: number }
  | { kind: "ease"; row: Row; sectionId: string; side: "in" | "out"; beat: number }
  | { kind: "section"; row: Row; sectionId: string; zone: "body" | "edgeStart" | "edgeEnd"; lane: number; beat: number }
  | { kind: "clip"; row: Row; clipId: string; zone: "body" | "edgeStart" | "edgeEnd"; beat: number }
  | { kind: "clipHandle"; row: Row; clipId: string; handle: ClipHandle; beat: number }
  | { kind: "event"; row: Row; trackId: string; eventId: string; beat: number };

type CursorName = "default" | "pointer" | "move" | "ew-resize" | "grab" | "crosshair";

/** Index of the key nearest `beat` within `tolBeats`, or -1. Uses findKey (binary search). */
export function nearestKeyIndex(keys: Channel["keys"], beat: number, tolBeats: number): number {
  const i = findKey(keys, beat);
  let best = -1, bestD = Infinity;
  for (const j of [i, i + 1]) {
    const k = keys[j];
    if (!k) continue;
    const d = Math.abs(k.beat - beat);
    if (d <= tolBeats && d < bestD) { best = j; bestD = d; }
  }
  return best;
}

function zone(view: ViewState, start: number, length: number, x: number, edgePx: number): "body" | "edgeStart" | "edgeEnd" | null {
  const x0 = beatToX(view, start), x1 = beatToX(view, start + length);
  if (x < x0 - edgePx / 2 || x > x1 + edgePx / 2) return null;
  const e = Math.min(edgePx, (x1 - x0) / 3);
  if (x <= x0 + e) return "edgeStart";
  if (x >= x1 - e) return "edgeEnd";
  return "body";
}

/** Nearest tangent handle of a selected key within `handlePx` of (x, y), or null. Handle of key k: (k.beat + dx, k.value + dy). */
export function hitTangent(row: Row, view: ViewState, x: number, y: number, o: HitOptions): Hit | null {
  if (row.kind !== "channel" || !o.curve) return null;
  const { keys, id } = row.channel;
  let best: Hit | null = null, bestD = o.handlePx;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    if (!o.curve.isKeySelected(id, i)) continue;
    if (k.interp !== "bezier" && keys[i - 1]?.interp !== "bezier") continue;
    const h = handlesOf(keys, i);
    for (const side of ["in", "out"] as const) {
      const dx = side === "in" ? h.inDx : h.outDx, dy = side === "in" ? h.inDy : h.outDy;
      const d = Math.hypot(beatToX(view, k.beat + dx) - x, o.curve.valueToY(k.value + dy, id) - y);
      if (d <= bestD) { bestD = d; best = { kind: "tangent", row, channelId: id, keyIndex: i, side, beat: k.beat + dx }; }
    }
  }
  return best;
}

/** Ease corner handles sit on the lane's top edge at start+easeIn and end-easeOut; topmost section wins. */
function hitEase(row: Row, sections: readonly Section[], lane: number, view: ViewState, x: number, y: number, o: HitOptions): Hit | null {
  const cy = row.y + lane * lanePitch(row.track, o.metrics);
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i]!;
    if (Math.floor(s.row) !== lane) continue;
    for (const side of ["in", "out"] as const) {
      const beat = side === "in" ? s.start + (s.easeIn ?? 0) : s.start + s.length - (s.easeOut ?? 0);
      if (Math.hypot(beatToX(view, beat) - x, cy - y) <= o.handlePx) return { kind: "ease", row, sectionId: s.id, side, beat };
    }
  }
  return null;
}

/** Sections in the lane under `y`; topmost (last in array) wins. Edge zones beat bodies across overlaps. */
function hitSection(row: Row, sections: readonly Section[], lane: number, view: ViewState, x: number, o: HitOptions): Hit | null {
  let body: Hit | null = null;
  const beat = xToBeat(view, x);
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i]!;
    if (Math.floor(s.row) !== lane) continue;
    const z = zone(view, s.start, s.length, x, o.edgePx);
    if (!z) continue;
    const h: Hit = { kind: "section", row: row, sectionId: s.id, zone: z, lane, beat };
    if (z !== "body") return h;
    body ??= h;
  }
  return body;
}

/** Hit-test content-space point (x relative to the canvas left, y includes scrollY). */
export function hitTest(layout: RowLayout, view: ViewState, x: number, y: number, opts: Partial<HitOptions> = {}): Hit {
  const o: HitOptions = { ...DEFAULT_HIT_OPTIONS, ...opts };
  const row = rowAtY(layout, y);
  if (!row) return { kind: "none" };
  const beat = xToBeat(view, x);
  const tol = o.keyTolPx / view.pxPerBeat;

  if (row.kind === "channel") {
    const t = hitTangent(row, view, x, y, o);
    if (t) return t;
    const i = nearestKeyIndex(row.channel.keys, beat, tol);
    if (i >= 0) return { kind: "key", row, channelId: row.channel.id, keyIndex: i, beat: row.channel.keys[i]!.beat };
  } else if (row.track.kind === "channels" && !row.expanded) {
    // Collapsed summary row shows every channel's keys; nearest across channels wins.
    let best: Hit | null = null, bestD = Infinity;
    for (const ch of row.track.channels) {
      const i = nearestKeyIndex(ch.keys, beat, tol);
      const d = i >= 0 ? Math.abs(ch.keys[i]!.beat - beat) : Infinity;
      if (d < bestD) { bestD = d; best = { kind: "key", row, channelId: ch.id, keyIndex: i, beat: ch.keys[i]!.beat }; }
    }
    if (best) return best;
  } else if (row.track.kind === "sections") {
    const lane = laneAtY(row, y, o.metrics);
    const e = hitEase(row, row.track.sections, lane, view, x, y, o);
    if (e) return e;
    const h = hitSection(row, row.track.sections, lane, view, x, o);
    if (h) return h;
  } else if (row.track.kind === "events") {
    const i = hitEvent(row.track.events, view, x);
    if (i >= 0) return { kind: "event", row, trackId: row.track.id, eventId: row.track.events[i]!.id, beat: row.track.events[i]!.beat };
  } else if (row.track.kind === "audio") {
    const rect = (c: { start: number; length: number }) => ({ x: beatToX(view, c.start), y: row.y + 2, w: Math.max(2, c.length * view.pxPerBeat), h: row.h - 4 });
    for (let i = row.track.clips.length - 1; i >= 0; i--) {
      const c = row.track.clips[i]!;
      const hd = hitClipHandle(c, view, rect(c), x, y, o.handlePx);
      if (hd) return { kind: "clipHandle", row, clipId: c.id, handle: hd, beat };
      const z = zone(view, c.start, c.length, x, o.edgePx);
      if (z) return { kind: "clip", row, clipId: c.id, zone: z, beat };
    }
  }
  return { kind: "row", row, beat };
}

/** Cursor for a hit; locked tracks never show edit cursors. */
export function cursorFor(hit: Hit): CursorName {
  if (hit.kind === "none" || hit.kind === "row") return "default";
  if (hit.row.track.locked) return "default";
  if (hit.kind === "key" || hit.kind === "event") return "pointer";
  if (hit.kind === "tangent" || hit.kind === "ease") return hit.kind === "ease" ? "ew-resize" : "crosshair";
  if (hit.kind === "clipHandle") return "grab";
  return hit.zone === "body" ? "move" : "ew-resize";
}

/** What a double-click opens the curve editor for: an expanded channel row or a key hit (one channel), or a collapsed channels track (`channelId` absent = all its channels). Anything else: undefined. */
export function curveTargetOf(hit: Hit): { trackId: string; channelId?: string } | undefined {
  if (hit.kind === "key") return { trackId: hit.row.track.id, channelId: hit.channelId };
  if (hit.kind === "row" && hit.row.kind === "channel") return { trackId: hit.row.track.id, channelId: hit.row.channel.id };
  if (hit.kind === "row" && hit.row.kind === "track" && hit.row.track.kind === "channels") return { trackId: hit.row.track.id };
  return undefined;
}

/**
 * What a double-click picks a color for: a track row that has a color group (expanded or collapsed). On a stop mark
 * (collapsed row key) `beat` is that key's beat; elsewhere on the strip it is the beat under the pointer, where the host
 * may add a stop. Other hits: undefined. `beat` is null only when the hit carries no beat.
 */
export function colorPickTargetOf(hit: Hit): { trackId: string; groupId: string; beat: number | null } | undefined {
  if (hit.kind !== "key" && hit.kind !== "row") return undefined;
  if (hit.row.kind !== "track") return undefined;
  const g = colorGroupOf(hit.row.track);
  if (!g) return undefined;
  return { trackId: hit.row.track.id, groupId: g.id, beat: Number.isFinite(hit.beat) ? hit.beat : null };
}

/** Marker flag under (x, y) in viewport coords: the pennant just below the ruler (`flagH` tall, from `rulerH`). Nearest wins. */
export function hitMarker(markers: readonly { id: string; beat: number }[], view: ViewState, x: number, y: number, rulerH: number, flagH = 14): string | null {
  if (y < rulerH || y > rulerH + flagH) return null;
  let best: string | null = null, bd = Infinity;
  for (const m of markers) {
    const d = x - beatToX(view, m.beat);
    if (d < -4 || d > 12 || Math.abs(d - 4) >= bd) continue;
    bd = Math.abs(d - 4); best = m.id;
  }
  return best;
}
