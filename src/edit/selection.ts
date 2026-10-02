// Selection store value: separate id sets per kind, immutable. Not part of undo.
import type { Channel, Sequence, Track } from "../core/model";
import { findKey } from "../core/curve";
import type { KeyRef } from "./commands";

export interface Selection {
  sections: ReadonlySet<string>;
  keys: ReadonlySet<string>; // encoded KeyRef, see keyId()
  channels: ReadonlySet<string>;
  tracks: ReadonlySet<string>;
  events: ReadonlySet<string>; // encoded event ref, see eventId()
  markers: ReadonlySet<string>; // Marker.id
  clips: ReadonlySet<string>; // encoded audio clip ref (trackId + clip id), see eventId()
}
export type SelectionKind = keyof Selection;
export type SelectMode = "replace" | "toggle" | "add";

export const emptySelection: Selection = { sections: new Set(), keys: new Set(), channels: new Set(), tracks: new Set(), events: new Set(), markers: new Set(), clips: new Set() };

export const keyId = (r: KeyRef): string => `${r.trackId}\0${r.channelId}\0${r.beat}`;
export function parseKeyId(id: string): KeyRef {
  const [trackId = "", channelId = "", beat = "0"] = id.split("\0");
  return { trackId, channelId, beat: Number(beat) };
}

export const eventId = (trackId: string, id: string): string => `${trackId}\0${id}`;
export function parseEventId(ref: string): { trackId: string; id: string } {
  const [trackId = "", id = ""] = ref.split("\0");
  return { trackId, id };
}

/** Click replaces; Ctrl/Shift toggles; box-select with a modifier adds. Other kinds are kept (keys and sections are separate sets). */
export function select(sel: Selection, kind: SelectionKind, ids: string[], mode: SelectMode = "replace"): Selection {
  const cur = sel[kind];
  const next = new Set(mode === "replace" ? [] : cur);
  for (const id of ids) {
    if (mode === "toggle" && cur.has(id)) next.delete(id);
    else next.add(id);
  }
  return { ...sel, [kind]: next };
}

export function clearSelection(): Selection { return emptySelection; }

export function isEmpty(sel: Selection): boolean {
  return !sel.sections.size && !sel.keys.size && !sel.channels.size && !sel.tracks.size && !sel.events.size && !sel.markers.size && !sel.clips.size;
}

/** Drop ids that no longer exist (after a commit or undo). Returns `sel` itself when nothing was dropped. Cost ~ selection size, not key count. */
export function pruneSelection(sel: Selection, seq: Sequence): Selection {
  if (isEmpty(sel)) return sel;
  const sections = new Set<string>(), channels = new Map<string, Channel>(), tracks = new Set<string>(), events = new Set<string>(), clips = new Set<string>();
  const need = { sections: sel.sections.size > 0, events: sel.events.size > 0, keys: sel.keys.size > 0, clips: sel.clips.size > 0 };
  const walk = (list: Track[]) => {
    for (const t of list) {
      tracks.add(t.id);
      if (t.kind === "sections") { if (need.sections) for (const s of t.sections) sections.add(s.id); }
      else if (t.kind === "channels") for (const c of t.channels) channels.set(need.keys ? `${t.id}\0${c.id}` : c.id, c);
      else if (t.kind === "events") { if (need.events) for (const e of t.events) events.add(eventId(t.id, e.id)); }
      else if (t.kind === "audio") { if (need.clips) for (const c of t.clips) clips.add(eventId(t.id, c.id)); }
      else if (t.kind === "folder") walk(t.children);
    }
  };
  walk(seq.tracks);
  const f = (s: ReadonlySet<string>, live: (id: string) => boolean) => {
    if (!s.size) return s;
    const out = new Set<string>();
    for (const i of s) if (live(i)) out.add(i);
    return out.size === s.size ? s : out;
  };
  const chanIds = need.keys ? new Set([...channels.values()].map((c) => c.id)) : new Set(channels.keys());
  const keyLive = (id: string) => {
    const r = parseKeyId(id), ch = channels.get(`${r.trackId}\0${r.channelId}`);
    if (!ch) return false;
    const i = findKey(ch.keys, r.beat);
    return i >= 0 && ch.keys[i]!.beat === r.beat;
  };
  const n = { sections: f(sel.sections, (i) => sections.has(i)), keys: f(sel.keys, keyLive), channels: f(sel.channels, (i) => chanIds.has(i)), tracks: f(sel.tracks, (i) => tracks.has(i)), events: f(sel.events, (i) => events.has(i)), markers: f(sel.markers, (i) => seq.markers.some((m) => m.id === i)), clips: f(sel.clips, (i) => clips.has(i)) };
  return n.sections === sel.sections && n.keys === sel.keys && n.channels === sel.channels && n.tracks === sel.tracks && n.events === sel.events && n.markers === sel.markers && n.clips === sel.clips ? sel : n;
}
