// Flattened row list + prefix-sum layout. Single source for outliner, canvas, hit-test. No DOM here.
import type { Channel, Sequence, Track } from "./model";

/** Ids of expanded tracks (folders show children, channel tracks show channel rows). Default: collapsed. */
export type ExpansionState = ReadonlySet<string>;

export interface RowMetrics {
  /** Height of a track row, and of one section lane. */
  trackH: number;
  channelH: number;
}
export const DEFAULT_ROW_METRICS: RowMetrics = { trackH: 28, channelH: 22 };

export type Row =
  | { kind: "track"; id: string; track: Track; depth: number; expandable: boolean; expanded: boolean; y: number; h: number }
  | { kind: "channel"; id: string; track: Track; channel: Channel; depth: number; expandable: false; expanded: false; y: number; h: number };

export interface RowLayout {
  rows: Row[];
  /** Prefix sums: `ys[i]` = top of row i, `ys[rows.length]` = total height. */
  ys: Float64Array;
  totalHeight: number;
}

export const isExpanded = (s: ExpansionState, id: string): boolean => s.has(id);

export function toggleExpanded(s: ExpansionState, id: string, on = !s.has(id)): ExpansionState {
  const next = new Set(s);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/** Ids of every track that can expand (folders with children, channel tracks with channels). */
export function expandableIds(tracks: readonly Track[]): string[] {
  const out: string[] = [];
  for (const t of tracks) {
    if (isExpandable(t)) out.push(t.id);
    if (t.kind === "folder") out.push(...expandableIds(t.children));
  }
  return out;
}

function isExpandable(t: Track): boolean {
  return t.kind === "folder" ? t.children.length > 0 : t.kind === "channels" ? t.channels.length > 0 : false;
}

/** Height of one lane: section tracks holding a nested (`ref`) section get a taller lane for the child summary. */
export function lanePitch(t: Track, m: RowMetrics = DEFAULT_ROW_METRICS): number {
  return t.kind === "sections" && t.sections.some((s) => s.ref) ? Math.round(m.trackH * 1.6) : m.trackH;
}

/** Track row height: section tracks grow to fit their highest lane (`Section.row`). */
export function trackHeight(t: Track, m: RowMetrics = DEFAULT_ROW_METRICS): number {
  if (t.kind !== "sections") return m.trackH;
  let maxLane = 0;
  for (const s of t.sections) if (s.row > maxLane) maxLane = s.row;
  return lanePitch(t, m) * (Math.max(0, Math.floor(maxLane)) + 1);
}

/** Depth-first flatten of the track tree honouring expansion, with y/h filled from prefix sums. */
export function flattenRows(
  seq: Pick<Sequence, "tracks">,
  expansion: ExpansionState = new Set(),
  metrics: RowMetrics = DEFAULT_ROW_METRICS,
): RowLayout {
  const rows: Row[] = [];
  let y = 0;
  const walk = (tracks: readonly Track[], depth: number): void => {
    for (const track of tracks) {
      const expandable = isExpandable(track);
      const expanded = expandable && expansion.has(track.id);
      const h = trackHeight(track, metrics);
      rows.push({ kind: "track", id: track.id, track, depth, expandable, expanded, y, h });
      y += h;
      if (!expanded) continue;
      if (track.kind === "folder") walk(track.children, depth + 1);
      else if (track.kind === "channels") {
        for (const channel of track.channels) {
          rows.push({ kind: "channel", id: `${track.id}/${channel.id}`, track, channel, depth: depth + 1, expandable: false, expanded: false, y, h: metrics.channelH });
          y += metrics.channelH;
        }
      }
    }
  };
  walk(seq.tracks, 0);
  const ys = new Float64Array(rows.length + 1);
  rows.forEach((r, i) => (ys[i] = r.y));
  ys[rows.length] = y;
  return { rows, ys, totalHeight: y };
}

/** Index of the row containing content-space `y`, or -1 when outside [0, totalHeight). Binary search. */
export function rowIndexAtY(layout: RowLayout, y: number): number {
  const n = layout.rows.length;
  if (!(y >= 0) || y >= layout.totalHeight) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (layout.ys[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function rowAtY(layout: RowLayout, y: number): Row | undefined {
  return layout.rows[rowIndexAtY(layout, y)];
}

/** Half-open index range [first, end) of rows intersecting content-space [y0, y1]. */
export function visibleRowRange(layout: RowLayout, y0: number, y1: number): [number, number] {
  const n = layout.rows.length;
  if (n === 0 || y1 < 0 || y0 >= layout.totalHeight || y1 < y0) return [0, 0];
  const first = Math.max(0, rowIndexAtY(layout, Math.max(0, y0)));
  const last = y1 >= layout.totalHeight ? n - 1 : rowIndexAtY(layout, y1);
  return [first, last + 1];
}

/** Lane within a section track row for a y inside it (for drops between lanes). */
export function laneAtY(row: Row, y: number, m: RowMetrics = DEFAULT_ROW_METRICS): number {
  if (row.kind !== "track" || row.track.kind !== "sections") return 0;
  const p = lanePitch(row.track, m);
  return Math.max(0, Math.min(Math.floor((y - row.y) / p), Math.round(row.h / p) - 1));
}
