// Shared track-rewrite helper for the edit modules (not re-exported from the package root).
import type { Sequence, Track } from "../core/model";

/** Rewrite track `id` with `fn`; ancestors of a locked folder and locked tracks reject the edit. */
function editTrack(tracks: Track[], id: string, fn: (t: Track) => Track): Track[] {
  let changed = false;
  const out = tracks.map((t) => {
    let n = t;
    if (t.id === id) n = t.locked ? t : fn(t);
    else if (t.kind === "folder" && !t.locked) {
      const children = editTrack(t.children, id, fn);
      if (children !== t.children) n = { ...t, children };
    }
    if (n !== t) changed = true;
    return n;
  });
  return changed ? out : tracks;
}

export function withTrack(seq: Sequence, id: string, fn: (t: Track) => Track): Sequence {
  const tracks = editTrack(seq.tracks, id, fn);
  return tracks === seq.tracks ? seq : { ...seq, tracks };
}
