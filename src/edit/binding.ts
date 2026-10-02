// Track binding: retarget / bind-selected commands and validity query.
import type { Sequence, Track, TrackBinding } from "../core/model";
import type { History } from "./history";

/** Host callback: does the bound object still exist? Types only; the host supplies it. */
export type BindingValidity = (targetId: string) => boolean;

function mapTrack(tracks: Track[], id: string, fn: (t: Track) => Track): Track[] | undefined {
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i]!;
    let next: Track | undefined;
    if (t.id === id) next = fn(t);
    else if (t.kind === "folder") {
      const c = mapTrack(t.children, id, fn);
      if (c) next = { ...t, children: c };
    }
    if (next) return [...tracks.slice(0, i), next, ...tracks.slice(i + 1)];
  }
  return undefined;
}

/** Pure: set (or clear with null) a track's binding. Unknown track or no change returns `seq`. */
export function setTrackBinding(seq: Sequence, trackId: string, targetId: string | null): Sequence {
  const tracks = mapTrack(seq.tracks, trackId, (t) => {
    if (targetId === null || targetId === "") {
      if (!t.binding) return t;
      const { binding: _b, ...rest } = t;
      return rest as Track;
    }
    return t.binding?.targetId === targetId ? t : ({ ...t, binding: { targetId } } as Track);
  });
  if (!tracks) return seq;
  return tracks === seq.tracks || JSON.stringify(tracks) === JSON.stringify(seq.tracks) ? seq : { ...seq, tracks };
}

/** Pure: retarget every track bound to `from` onto `to`. No match returns `seq`. */
export function retargetBinding(seq: Sequence, from: string, to: string): Sequence {
  if (from === to || !to) return seq;
  const walk = (ts: Track[]): Track[] => {
    let changed = false;
    const out = ts.map((t) => {
      let n = t;
      if (t.kind === "folder") { const c = walk(t.children); if (c !== t.children) n = { ...t, children: c }; }
      if (n.binding?.targetId === from) n = { ...n, binding: { targetId: to } } as Track;
      if (n !== t) changed = true;
      return n;
    });
    return changed ? out : ts;
  };
  const tracks = walk(seq.tracks);
  return tracks === seq.tracks ? seq : { ...seq, tracks };
}

/** Binding of a track, if any. */
export function bindingOf(t: Track): TrackBinding | undefined { return t.binding; }

/** Ids of tracks whose binding the host reports invalid (unbound tracks are never broken). */
export function brokenTrackIds(seq: Sequence, valid: BindingValidity): Set<string> {
  const out = new Set<string>();
  const walk = (ts: Track[]) => {
    for (const t of ts) {
      if (t.binding && !valid(t.binding.targetId)) out.add(t.id);
      if (t.kind === "folder") walk(t.children);
    }
  };
  walk(seq.tracks);
  return out;
}

/** Bind each given track to the selected host object ("add selected"); one history entry. */
export function applyBindSelected(h: History, trackIds: string[], targetId: string): void {
  h.apply("Bind to selected", (s) => trackIds.reduce((a, id) => setTrackBinding(a, id, targetId), s));
}

/** Retarget all tracks bound to `from` onto `to` ("replace with"); one history entry. */
export function applyRetarget(h: History, from: string, to: string): void {
  h.apply("Retarget binding", (s) => retargetBinding(s, from, to));
}
