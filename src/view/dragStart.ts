// Which drag (if any) a press turns into once the pointer moves past the threshold.
import type { Beats } from "../core/model";
import { keyId, parseKeyId, type Selection } from "../edit/selection";
import { envelopeOf } from "./audioHandles";
import type { Hit } from "./hit";
import { colorGroupOf } from "./colorLane";
import type { Drag } from "./drag";

export interface PressState { x: number; y: number; hit: Hit; mod: boolean; moved: boolean }
interface MarkerPress { id: string; beat: Beats; color?: string }

export function startDrag(e: { altKey: boolean }, d: PressState, sel: Selection, mkDown: MarkerPress | null, contentY: (py: number) => number): Drag | null {
  const { hit } = d;
  if (mkDown) return { kind: "marker", ...mkDown, start: mkDown.beat };
  if (hit.kind === "key") {
    const id = keyId({ trackId: hit.row.track.id, channelId: hit.channelId, beat: hit.beat });
    if (!sel.keys.has(id)) return null;
    const cg = hit.row.kind === "track" && !hit.row.track.locked ? colorGroupOf(hit.row.track) : undefined;
    if (cg) return { kind: "colorStop", ref: { trackId: hit.row.track.id, groupId: cg.id, beat: hit.beat }, refs: [...sel.keys].map(parseKeyId), dBeat: 0 }; // collapsed color row: the whole stop (and every other selected stop or key) moves
    return { kind: "keys", refs: [...sel.keys].map(parseKeyId), primary: parseKeyId(id), dBeat: 0, dValue: 0 };
  }
  if (hit.kind === "tangent") {
    const k = hit.row.kind === "channel" ? hit.row.channel.keys[hit.keyIndex] : undefined;
    return k && !hit.row.track.locked ? { kind: "tangent", ref: { trackId: hit.row.track.id, channelId: hit.channelId, beat: k.beat }, value: k.value, side: hit.side, dx: 0, dy: 0 } : null;
  }
  if (hit.kind === "ease") {
    const t = hit.row.track, s = t.kind === "sections" ? t.sections.find((x) => x.id === hit.sectionId) : undefined;
    return s && !t.locked ? { kind: "ease", trackId: t.id, id: s.id, side: hit.side, start: s.start, length: s.length, dur: (hit.side === "in" ? s.easeIn : s.easeOut) ?? 0 } : null;
  }
  if (hit.kind === "clipHandle" && hit.row.track.kind === "audio" && !hit.row.track.locked) {
    const c = hit.row.track.clips.find((x) => x.id === hit.clipId);
    return c ? { kind: "clipHandle", trackId: hit.row.track.id, id: c.id, handle: hit.handle, start: c.start, length: c.length, ...envelopeOf(c) } : null;
  }
  if (hit.kind === "clip" && hit.row.track.kind === "audio" && !hit.row.track.locked) {
    const c = hit.row.track.clips.find((x) => x.id === hit.clipId);
    if (!c) return null;
    const mode = hit.zone === "edgeStart" ? "trimStart" : hit.zone === "edgeEnd" ? "trimEnd" : e.altKey ? "slip" : "move";
    const from = mode === "slip" ? c.offset : mode === "trimEnd" ? c.start + c.length : c.start;
    return { kind: "clip", trackId: hit.row.track.id, id: c.id, edit: { mode, beat: from }, grab: hit.beat, from, start: c.start, length: c.length };
  }
  if (hit.kind === "section" && sel.sections.has(hit.sectionId)) {
    const t = hit.row.track;
    const s = t.kind === "sections" ? t.sections.find((x) => x.id === hit.sectionId) : undefined;
    if (!s) return null;
    if (hit.zone === "body") return { kind: "move", ids: [...sel.sections], primary: s.id, start: s.start, end: s.start + s.length, dBeat: 0, fromTrack: t.id };
    const edge = hit.zone === "edgeStart" ? "start" : "end";
    return { kind: "trim", trackId: t.id, id: s.id, edge, beat: edge === "start" ? s.start : s.start + s.length };
  }
  if (hit.kind === "event") return hit.row.track.locked ? null : { kind: "event", trackId: hit.trackId, id: hit.eventId, start: hit.beat, beat: hit.beat };
  if (hit.kind === "none" || hit.kind === "row" || hit.kind === "clip") {
    const cy = contentY(d.y);
    return { kind: "box", x0: d.x, y0: cy, x1: d.x, y1: cy, mode: d.mod ? "add" : "replace" };
  }
  return null;
}
