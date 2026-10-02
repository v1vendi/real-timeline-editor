// Shared hit-test + snap context for pointer gestures: built once per attachInteraction and handed to
// the drag updaters. Snap providers are cached per sequence object (immutable edits swap it), so a
// drag builds them once instead of on every pointer move. The snap guide of the last snap lives here.
import type { Beats, Sequence } from "../core/model";
import { gridProvider, eventProvider, keyProvider, markerProvider, playheadProvider, resolveSnap, SNAP_THRESHOLD_PX, sectionEdgeProvider, type SnapProvider, type SnapTarget } from "../core/snap";
import { keyId } from "../edit/selection";
import { DEFAULT_ROW_METRICS } from "../core/rows";
import { hitTest, type Hit } from "./hit";
import type { InteractionHost } from "./interaction";

type ExcludeKey = (ch: string, b: Beats) => boolean;

interface HitSnap {
  hitAt(x: number, cy: number): Hit;
  snap(beat: Beats, e: { altKey: boolean }, exclude: Set<string>, excludeKey?: ExcludeKey): Beats;
  guide(): SnapTarget | null;
  setGuide(g: SnapTarget | null): void;
}

export function createHitSnap(host: InteractionHost, seq: () => Sequence): HitSnap {
  let guide: SnapTarget | null = null;
  let cache: { s: Sequence; head: SnapProvider[]; tail: SnapProvider; keys?: { ex: ExcludeKey | undefined; p: SnapProvider } } | undefined;

  const snap: HitSnap["snap"] = (beat, e, exclude, excludeKey) => {
    const v = host.getView(), s = seq();
    if (cache?.s !== s) cache = { s, head: [gridProvider, playheadProvider(host.getPlayhead), markerProvider(s), sectionEdgeProvider(s)], tail: eventProvider(s) };
    const keys = cache.keys?.ex === excludeKey && cache.keys ? cache.keys : (cache.keys = { ex: excludeKey, p: keyProvider(s, excludeKey) });
    const r = 2 * SNAP_THRESHOLD_PX / v.pxPerBeat;
    const t = resolveSnap([...cache.head, keys.p, cache.tail], { pxPerBeat: v.pxPerBeat, beatsPerBar: s.beatsPerBar, gridMode: host.getGridMode?.(), beat, range: [beat - r, beat + r], exclude }, { disabled: e.altKey });
    guide = t;
    return t?.beat ?? beat;
  };

  const hitAt: HitSnap["hitAt"] = (x, cy) => {
    const c = host.curve?.();
    const sel = host.getSelection();
    return hitTest(host.getLayout(), host.getView(), x, cy, { metrics: host.getMetrics?.() ?? DEFAULT_ROW_METRICS, ...(c ? { curve: { valueToY: c.valueToY, isKeySelected: (ch, i) => {
      const row = host.getLayout().rows.find((r) => r.kind === "channel" && r.channel.id === ch);
      const k = row?.kind === "channel" ? row.channel.keys[i] : undefined;
      return !!row && !!k && sel.keys.has(keyId({ trackId: row.track.id, channelId: ch, beat: k.beat }));
    } } } : {}) });
  };

  return { hitAt, snap, guide: () => guide, setGuide: (g) => { guide = g; } };
}
