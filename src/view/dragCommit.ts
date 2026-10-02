// Commit a finished drag: ONE history entry per gesture (box drags only change the selection).
import { quantize, type Sequence } from "../core/model";
import { setAudioFade, setAudioGain, moveEvent, moveKeys, moveMarker, moveSection, moveSectionToTrack, movedKeyRef, setHandle, trimSection, MIN_SECTION_LENGTH } from "../edit/commands";
import { colorStopsDelta, moveColorStops, splitColorStops } from "../edit/colorCommands";
import { editClip, setEase } from "../edit/handleOps";
import { emptySelection, eventId, keyId, select, type Selection } from "../edit/selection";
import { findTrack } from "../edit/commands";
import { lanePitch } from "../core/rows";
import type { InteractionHost } from "./interaction";
import { xToBeat } from "./viewState";
import { sectionTrackIds, startOf, type Drag } from "./drag";

export function createDragCommitter(host: InteractionHost, seq: () => Sequence, setSel: (s: Selection) => void) {
  const boxSelect = (b: Extract<Drag, { kind: "box" }>): Selection => {
    const v = host.getView(), layout = host.getLayout();
    const [xa, xb] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)], [ya, yb] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const ba = xToBeat(v, xa), bb = xToBeat(v, xb);
    const sections: string[] = [], keys: string[] = [], events: string[] = [];
    for (const row of layout.rows) {
      if (row.y + row.h < ya || row.y > yb) continue;
      if (row.kind === "channel") {
        for (const k of row.channel.keys) if (k.beat >= ba && k.beat <= bb) keys.push(keyId({ trackId: row.track.id, channelId: row.channel.id, beat: k.beat }));
      } else if (row.track.kind === "events") {
        for (const ev of row.track.events) if (ev.beat >= ba && ev.beat <= bb) events.push(eventId(row.track.id, ev.id));
      } else if (row.track.kind === "sections") {
        for (const s of row.track.sections) {
          const lh = lanePitch(row.track, host.getMetrics?.()), top = row.y + Math.floor(s.row) * lh;
          if (s.start <= bb && s.start + s.length >= ba && top + lh >= ya && top <= yb) sections.push(s.id);
        }
      } else if (row.track.kind === "channels" && !row.expanded) {
        for (const ch of row.track.channels) for (const k of ch.keys) if (k.beat >= ba && k.beat <= bb) keys.push(keyId({ trackId: row.track.id, channelId: ch.id, beat: k.beat }));
      }
    }
    const base = b.mode === "add" ? host.getSelection() : emptySelection;
    return select(select(select(base, "sections", sections, "add"), "keys", keys, "add"), "events", events, "add");
  };

  const commitMoveSections = (g: Extract<Drag, { kind: "move" }>) => {
    const h = host.history;
    if (g.toTrack && g.fromTrack) {
      const to = g.toTrack, from = g.fromTrack;
      h.apply("Move section to track", (s) => moveSectionToTrack(s, from, g.primary, to, g.start + g.dBeat));
      return;
    }
    const tracks = sectionTrackIds(seq().tracks);
    h.begin("Move sections");
    h.preview((s) => g.ids.reduce((acc, id) => { const t = tracks.get(id); return t ? moveSection(acc, t, id, startOf(s, id) + g.dBeat) : acc; }, s));
    h.commit();
  };
  const commitKeys = (g: Extract<Drag, { kind: "keys" }>) => {
    const first = Math.min(...g.refs.map((r) => r.beat));
    host.history.apply("Move keys", (s) => moveKeys(s, g.refs, g.dBeat, g.dValue));
    setSel({ ...host.getSelection(), keys: new Set(g.refs.map((r) => keyId(movedKeyRef(r, g.dBeat, first)))) });
  };
  const commitColorStop = (g: Extract<Drag, { kind: "colorStop" }>) => {
    const before = seq(), { stops, keys } = splitColorStops(before, g.refs);
    const d = colorStopsDelta(before, stops, g.dBeat), first = Math.min(...keys.map((k) => k.beat));
    if (d === 0 && (!keys.length || g.dBeat === 0 || first === 0)) return;
    host.history.apply("Move color stops", (s) => moveKeys(moveColorStops(s, stops, d), keys, g.dBeat));
    const now = seq(), moved: string[] = [];
    const add = (trackId: string, beat: number, only?: string) => {
      const t = findTrack(now.tracks, trackId);
      if (t?.kind === "channels") for (const c of t.channels) if ((!only || c.id === only) && c.keys.some((k) => k.beat === beat)) moved.push(keyId({ trackId, channelId: c.id, beat }));
    };
    for (const k of keys) { const m = movedKeyRef(k, g.dBeat, first); add(m.trackId, m.beat, m.channelId); }
    for (const s of stops) add(s.trackId, quantize(s.beat + d));
    setSel({ ...host.getSelection(), keys: new Set(moved) });
  };
  const commitClipHandle = (g: Extract<Drag, { kind: "clipHandle" }>) => {
    const h = host.history;
    if (g.handle === "gain") h.apply("Edit audio gain", (s) => setAudioGain(s, g.trackId, g.id, g.gain));
    else h.apply("Edit audio fade", (s) => setAudioFade(s, g.trackId, g.id, g.handle === "fadeIn" ? { fadeIn: g.fadeIn } : { fadeOut: g.fadeOut }));
  };

  const commitDrag = (g: Drag) => {
    const h = host.history;
    switch (g.kind) {
      case "box": return setSel(boxSelect(g));
      case "marker": return h.apply("Move marker", (s) => moveMarker(s, g.id, g.beat));
      case "event": return h.apply("Move event", (s) => moveEvent(s, g.trackId, g.id, g.beat));
      case "move": return commitMoveSections(g);
      case "trim": return h.apply("Trim section", (s) => trimSection(s, g.trackId, g.id, g.edge, g.beat, MIN_SECTION_LENGTH));
      case "tangent": return h.apply("Edit tangent", (s) => setHandle(s, g.ref, g.side, g.dx, g.dy));
      case "ease": return h.apply("Edit ease", (s) => setEase(s, g.trackId, g.id, g.side, g.dur));
      case "clipHandle": return commitClipHandle(g);
      case "clip": return h.apply("Edit audio clip", (s) => editClip(s, g.trackId, g.id, g.edit));
      case "keys": return commitKeys(g);
      case "colorStop": return commitColorStop(g);
    }
  };
  return commitDrag;
}
