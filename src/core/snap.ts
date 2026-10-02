// Snapping: a list of providers returning candidate beats, one resolver. No DOM here.
import type { Beats, Sequence, Track } from "./model";
import { findKey } from "./curve";
import { gridStep, type GridMode } from "./time";

export type SnapKind = "marker" | "playhead" | "section" | "key" | "event" | "grid";

/** What the resolver tells the view: the snapped beat and the target, for drawing the guide line. */
export interface SnapTarget { beat: Beats; kind: SnapKind; id?: string }

export interface SnapContext {
  pxPerBeat: number;
  beatsPerBar: number;
  /** Grid flavour for the grid provider; default straight. */
  gridMode?: GridMode;
  /** Beat being dragged (or the edge nearest the pointer). */
  beat: Beats;
  /** Visible/relevant range; providers may skip targets outside it. */
  range: [Beats, Beats];
  /** Ids (sections, markers) being dragged: never snap to themselves. */
  exclude?: ReadonlySet<string>;
}

/** A provider returns candidate targets near `ctx.beat` (it may return more; the resolver filters). */
export type SnapProvider = (ctx: SnapContext) => SnapTarget[];

export const SNAP_THRESHOLD_PX = 8;

/** Lower wins when two targets are equally near. */
export const SNAP_PRIORITY: Record<SnapKind, number> = { marker: 0, playhead: 1, section: 2, key: 3, event: 3, grid: 4 };

export interface SnapOptions { thresholdPx?: number; disabled?: boolean }

/** Nearest target within `thresholdPx`; ties go to the higher-priority kind. Null if none or `disabled` (Alt held). */
export function resolveSnap(providers: SnapProvider[], ctx: SnapContext, opts: SnapOptions = {}): SnapTarget | null {
  if (opts.disabled) return null;
  const maxBeats = (opts.thresholdPx ?? SNAP_THRESHOLD_PX) / ctx.pxPerBeat;
  let best: SnapTarget | null = null;
  let bestDist = Infinity;
  for (const provider of providers) {
    for (const t of provider(ctx)) {
      const d = Math.abs(t.beat - ctx.beat);
      if (d > maxBeats) continue;
      const better = d < bestDist - 1e-9 ||
        (Math.abs(d - bestDist) <= 1e-9 && best !== null && SNAP_PRIORITY[t.kind] < SNAP_PRIORITY[best.kind]);
      if (better) { best = t; bestDist = d; }
    }
  }
  return best;
}

/** Beat value to use: the snapped beat, or the input unchanged. */
export function snapBeat(providers: SnapProvider[], ctx: SnapContext, opts?: SnapOptions): Beats {
  return resolveSnap(providers, ctx, opts)?.beat ?? ctx.beat;
}

/** Grid lines (beats/bars/subdivisions, whichever is the finest level readable at this zoom). */
export const gridProvider: SnapProvider = (ctx) => {
  const step = gridStep(ctx.pxPerBeat, ctx.beatsPerBar, undefined, ctx.gridMode);
  const n = Math.round(ctx.beat / step);
  return [{ beat: n * step, kind: "grid" }];
};

export const playheadProvider = (getBeat: () => Beats): SnapProvider => () => [{ beat: getBeat(), kind: "playhead" }];

export const markerProvider = (seq: Pick<Sequence, "markers">): SnapProvider => (ctx) =>
  seq.markers.filter((m) => !ctx.exclude?.has(m.id)).map((m) => ({ beat: m.beat, kind: "marker", id: m.id }));

function* walk(tracks: Track[]): Generator<Track> {
  for (const t of tracks) {
    yield t;
    if (t.kind === "folder") yield* walk(t.children);
  }
}

/** Start and end of every section (and audio clip) except excluded ids. */
export const sectionEdgeProvider = (seq: Pick<Sequence, "tracks">): SnapProvider => (ctx) => {
  const out: SnapTarget[] = [];
  const add = (id: string, start: Beats, length: Beats) => {
    if (ctx.exclude?.has(id)) return;
    out.push({ beat: start, kind: "section", id }, { beat: start + length, kind: "section", id });
  };
  for (const t of walk(seq.tracks)) {
    if (t.kind === "sections") for (const s of t.sections) add(s.id, s.start, s.length);
    else if (t.kind === "audio") for (const c of t.clips) add(c.id, c.start, c.length);
  }
  return out;
};

/** Key beats across all channels, limited to `ctx.range`. `excludeKey` skips keys being dragged. */
export const keyProvider = (seq: Pick<Sequence, "tracks">, excludeKey?: (channelId: string, beat: Beats) => boolean): SnapProvider => (ctx) => {
  const out: SnapTarget[] = [];
  for (const t of walk(seq.tracks)) {
    if (t.kind !== "channels") continue;
    for (const ch of t.channels) {
      const keys = ch.keys;
      // Keys are sorted by beat: binary-search to the range instead of scanning every key.
      for (let i = Math.max(0, findKey(keys, ctx.range[0] - 1e-9)); i < keys.length; i++) {
        const k = keys[i]!;
        if (k.beat > ctx.range[1]) break;
        if (k.beat < ctx.range[0] || excludeKey?.(ch.id, k.beat)) continue;
        out.push({ beat: k.beat, kind: "key", id: ch.id });
      }
    }
  }
  return out;
};

/** Event beats across all event tracks, limited to `ctx.range`. */
export const eventProvider = (seq: Pick<Sequence, "tracks">): SnapProvider => (ctx) => {
  const out: SnapTarget[] = [];
  for (const t of walk(seq.tracks)) {
    if (t.kind !== "events") continue;
    for (const e of t.events) if (e.beat >= ctx.range[0] && e.beat <= ctx.range[1] && !ctx.exclude?.has(e.id)) out.push({ beat: e.beat, kind: "event", id: e.id });
  }
  return out;
};

/** Default provider set for a sequence; `getPlayhead` reads the host clock at query time. */
export function defaultProviders(seq: Sequence, getPlayhead: () => Beats): SnapProvider[] {
  return [gridProvider, playheadProvider(getPlayhead), markerProvider(seq), sectionEdgeProvider(seq), keyProvider(seq), eventProvider(seq)];
}
