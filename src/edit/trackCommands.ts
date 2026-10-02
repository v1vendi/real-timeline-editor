// Track-tree, event and marker commands.
import { quantize } from "../core/model";
import type { Beats, Sequence, TimelineEvent, Track } from "../core/model";
import { withTrack } from "./trackOps";

/** Add a track at `index` (default end) in the top level, or inside folder `parentId`. Duplicate ids are ignored. */
export function addTrack(seq: Sequence, track: Track, index?: number, parentId?: string): Sequence {
  const ins = (list: Track[]) => {
    const i = Math.max(0, Math.min(index ?? list.length, list.length));
    return [...list.slice(0, i), track, ...list.slice(i)];
  };
  if (findTrack(seq.tracks, track.id)) return seq;
  if (!parentId) return { ...seq, tracks: ins(seq.tracks) };
  return withTrack(seq, parentId, (t) => (t.kind === "folder" ? { ...t, children: ins(t.children) } : t));
}

/** Remove a track from wherever it is, honouring locks; null when missing or locked. */
function detach(list: Track[], id: string): { tracks: Track[]; track: Track } | null {
  const i = list.findIndex((t) => t.id === id);
  if (i >= 0) return list[i]!.locked ? null : { tracks: list.filter((_, j) => j !== i), track: list[i]! };
  for (let j = 0; j < list.length; j++) {
    const f = list[j]!;
    if (f.kind !== "folder" || f.locked) continue;
    const r = detach(f.children, id);
    if (r) return { track: r.track, tracks: list.map((t, n) => (n === j ? { ...f, children: r.tracks } : t)) };
  }
  return null;
}

/**
 * Nest/reparent: move a track into folder `parentId` (or the top level when null) at `index`
 * (default end). No-op when the track or folder is missing/locked, the parent is not a folder,
 * or the move would put a folder inside itself.
 */
export function nestTrack(seq: Sequence, trackId: string, parentId: string | null, index?: number): Sequence {
  const t = findTrack(seq.tracks, trackId);
  if (!t) return seq;
  if (parentId !== null && (parentId === trackId || (t.kind === "folder" && findTrack(t.children, parentId)))) return seq;
  const d = detach(seq.tracks, trackId);
  if (!d) return seq;
  const out = addTrack({ ...seq, tracks: d.tracks }, d.track, index, parentId ?? undefined);
  return out.tracks === d.tracks ? seq : out;
}

/** Reorder a track within its current parent list (use `nestTrack` to change parent). */
export function moveTrack(seq: Sequence, trackId: string, toIndex: number): Sequence {
  const mv = (list: Track[]): Track[] | null => {
    const from = list.findIndex((t) => t.id === trackId);
    if (from < 0) return null;
    const to = Math.max(0, Math.min(toIndex, list.length - 1));
    if (to === from) return list;
    const out = list.slice();
    out.splice(to, 0, out.splice(from, 1)[0]!);
    return out;
  };
  const top = mv(seq.tracks);
  if (top) return top === seq.tracks ? seq : { ...seq, tracks: top };
  const inFolder = (list: Track[]): Track[] => {
    let changed = false;
    const out = list.map((t) => {
      if (t.kind !== "folder" || t.locked) return t;
      const r = mv(t.children);
      const children = r ?? inFolder(t.children);
      if (children === t.children) return t;
      changed = true;
      return { ...t, children };
    });
    return changed ? out : list;
  };
  const tracks = inFolder(seq.tracks);
  return tracks === seq.tracks ? seq : { ...seq, tracks };
}

/** Remove a track (and its children) from wherever it is; no-op when missing or locked. Callers prune the selection. */
export function removeTrack(seq: Sequence, trackId: string): Sequence {
  const d = detach(seq.tracks, trackId);
  return d ? { ...seq, tracks: d.tracks } : seq;
}

export function findTrack(tracks: Track[], id: string): Track | undefined {
  for (const t of tracks) {
    if (t.id === id) return t;
    if (t.kind === "folder") { const r = findTrack(t.children, id); if (r) return r; }
  }
  return undefined;
}

function withEvents(seq: Sequence, trackId: string, fn: (e: TimelineEvent[]) => TimelineEvent[]): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "events") return t;
    const events = fn(t.events);
    return events === t.events ? t : { ...t, events };
  });
}
const byEventBeat = (a: TimelineEvent, b: TimelineEvent) => a.beat - b.beat;

/** Add an event (beat quantized, clamped to >= 0); duplicate ids are ignored. Events stay sorted by beat (stable). */
export function addEvent(seq: Sequence, trackId: string, event: TimelineEvent): Sequence {
  return withEvents(seq, trackId, (list) =>
    list.some((e) => e.id === event.id) ? list : [...list, { ...event, beat: Math.max(0, quantize(event.beat)) }].sort(byEventBeat));
}

export function moveEvent(seq: Sequence, trackId: string, id: string, beat: Beats): Sequence {
  const b = Math.max(0, quantize(beat));
  return withEvents(seq, trackId, (list) => {
    const i = list.findIndex((e) => e.id === id);
    if (i < 0 || list[i]!.beat === b) return list;
    return list.map((e, j) => (j === i ? { ...e, beat: b } : e)).sort(byEventBeat);
  });
}

export function deleteEvent(seq: Sequence, trackId: string, id: string): Sequence {
  return withEvents(seq, trackId, (list) => (list.some((e) => e.id === id) ? list.filter((e) => e.id !== id) : list));
}

export function deleteMarker(seq: Sequence, id: string): Sequence {
  return seq.markers.some((m) => m.id === id) ? { ...seq, markers: seq.markers.filter((m) => m.id !== id) } : seq;
}

/** Move a marker to `beat` (clamped to >= 0). */
export function moveMarker(seq: Sequence, id: string, beat: Beats): Sequence {
  const b = Math.max(0, quantize(beat));
  const i = seq.markers.findIndex((m) => m.id === id);
  if (i < 0 || seq.markers[i]!.beat === b) return seq;
  return { ...seq, markers: seq.markers.map((m, j) => (j === i ? { ...m, beat: b } : m)) };
}

