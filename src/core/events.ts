// Event lanes: a pure query over a host-supplied span. The library never fires events or reads a clock.
import type { Beats, Sequence, TimelineEvent, Track } from "./model";

export interface EventHit { event: TimelineEvent; trackId: string; /** 0 for the first segment, 1 after a loop wrap. Host dedupes per pass. */ pass: number }
export interface EventsOptions {
  /** Loop region. When `t1 < t0` the span is taken to have wrapped: [t0, end] then [start, t1). */
  loop?: { start: Beats; end: Beats };
}

function* eventTracks(tracks: Track[]): Generator<Extract<Track, { kind: "events" }>> {
  for (const t of tracks) {
    if (t.kind === "events") yield t;
    else if (t.kind === "folder") yield* eventTracks(t.children);
  }
}

/**
 * Events in firing order (by segment, then beat, then track order) within `[t0, t1)`; muted tracks
 * skipped. Endpoint events count: one at `t0` is reported, one at `t1` belongs to the next span.
 * With a wrapping span the loop end is inclusive, so an event at `loop.end` fires once per pass.
 */
export function eventsBetween(seq: Pick<Sequence, "tracks">, t0: Beats, t1: Beats, opts: EventsOptions = {}): EventHit[] {
  const segments: Array<[Beats, Beats, boolean]> =
    opts.loop && t1 < t0 ? [[t0, opts.loop.end, true], [opts.loop.start, t1, false]] : t1 > t0 ? [[t0, t1, false]] : [];
  const out: EventHit[] = [];
  segments.forEach(([a, b, inclusive], pass) => {
    const hits: EventHit[] = [];
    for (const t of eventTracks(seq.tracks)) {
      if (t.muted) continue;
      for (const event of t.events) if (event.beat >= a && (inclusive ? event.beat <= b : event.beat < b)) hits.push({ event, trackId: t.id, pass });
    }
    out.push(...hits.sort((x, y) => x.event.beat - y.event.beat)); // stable: keeps track order on ties
  });
  return out;
}
