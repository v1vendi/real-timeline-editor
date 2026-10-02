// Copy / paste / duplicate / split (docs/behavior.md sections 5 and 10). Pure: (seq, ...) => result.
// The clipboard is plain JSON (beats relative to the earliest item) so a host can bridge it.
import { quantize } from "../core/model";
import type { Beats, Key, Section, Sequence, TimelineEvent } from "../core/model";
import { placeSection } from "../core/lanes";
import { addEvent, addKey, addSection, deleteEvent, deleteKeys, deleteSection, findTrack, MIN_SECTION_LENGTH, trimSection } from "./commands";
import type { KeyRef } from "./commands";
import { parseEventId, parseKeyId } from "./selection";
import type { Selection } from "./selection";

export interface Clipboard {
  version: 1;
  sections: { trackId: string; rel: Beats; section: Section }[];
  keys: { trackId: string; channelId: string; rel: Beats; key: Key }[];
  /** Absent in clips made before events were copyable. */
  events?: { trackId: string; rel: Beats; event: TimelineEvent }[];
}
/** What copy/cut/duplicate read from a Selection (events optional for older callers). */
type Sel = Pick<Selection, "sections" | "keys"> & { events?: ReadonlySet<string> };
/** Where to paste when the source track/channel is gone or of the wrong kind. */
export interface PasteTarget { trackId?: string; channelId?: string }
export interface PasteResult { seq: Sequence; sections: { trackId: string; id: string }[]; keys: KeyRef[]; events: { trackId: string; id: string }[] }

const sectionsOf = (seq: Sequence, trackId: string) => { const t = findTrack(seq.tracks, trackId); return t?.kind === "sections" ? t.sections : undefined; };
const eventsOf = (seq: Sequence, trackId: string) => { const t = findTrack(seq.tracks, trackId); return t?.kind === "events" ? t.events : undefined; };

/** Copy the selected sections and keys; null when nothing resolves. */
export function copySelection(seq: Sequence, sel: Sel): Clipboard | null {
  const secs: { trackId: string; section: Section }[] = [];
  const keys: { trackId: string; channelId: string; key: Key }[] = [];
  const walk = (list: Sequence["tracks"]) => {
    for (const t of list) {
      if (t.kind === "sections") for (const s of t.sections) { if (sel.sections.has(s.id)) secs.push({ trackId: t.id, section: s }); }
      else if (t.kind === "folder") walk(t.children);
    }
  };
  walk(seq.tracks);
  for (const id of sel.keys) {
    const r = parseKeyId(id);
    const t = findTrack(seq.tracks, r.trackId);
    const k = t?.kind === "channels" ? t.channels.find((c) => c.id === r.channelId)?.keys.find((x) => x.beat === quantize(r.beat)) : undefined;
    if (k) keys.push({ trackId: r.trackId, channelId: r.channelId, key: k });
  }
  const evs: { trackId: string; event: TimelineEvent }[] = [];
  for (const id of sel.events ?? []) {
    const r = parseEventId(id);
    const e = eventsOf(seq, r.trackId)?.find((x) => x.id === r.id);
    if (e) evs.push({ trackId: r.trackId, event: e });
  }
  if (!secs.length && !keys.length && !evs.length) return null;
  const origin = Math.min(...secs.map((s) => s.section.start), ...keys.map((k) => k.key.beat), ...evs.map((e) => e.event.beat));
  return {
    version: 1,
    sections: secs.map((s) => ({ trackId: s.trackId, rel: quantize(s.section.start - origin), section: s.section })),
    keys: keys.map((k) => ({ trackId: k.trackId, channelId: k.channelId, rel: quantize(k.key.beat - origin), key: k.key })),
    ...(evs.length ? { events: evs.map((e) => ({ trackId: e.trackId, rel: quantize(e.event.beat - origin), event: e.event })) } : {}),
  };
}

/** Copy the selection, then delete it. Null (seq untouched) when nothing resolves. Locked tracks keep their items. */
export function cutSelection(seq: Sequence, sel: Sel): { seq: Sequence; clip: Clipboard } | null {
  const clip = copySelection(seq, sel);
  if (!clip) return null;
  let out = seq;
  for (const c of clip.sections) out = deleteSection(out, c.trackId, c.section.id);
  out = deleteKeys(out, clip.keys.map((c) => ({ trackId: c.trackId, channelId: c.channelId, beat: c.key.beat })));
  for (const c of clip.events ?? []) out = deleteEvent(out, c.trackId, c.event.id);
  return { seq: out, clip };
}

/** Add one section to `trackId` with a free lane. Returns the same seq when the track rejects it. */
function putSection(seq: Sequence, trackId: string, section: Section): Sequence {
  const existing = sectionsOf(seq, trackId);
  if (!existing) return seq;
  const s = { ...section, start: Math.max(0, quantize(section.start)), length: Math.max(MIN_SECTION_LENGTH, quantize(section.length)) };
  return addSection(seq, trackId, placeSection(s, existing));
}

const hasEvent = (seq: Sequence, trackId: string, id: string) => eventsOf(seq, trackId)?.some((e) => e.id === id) ?? false;
const hasSection = (seq: Sequence, trackId: string, id: string) => sectionsOf(seq, trackId)?.some((x) => x.id === id) ?? false;

/**
 * Paste at `playhead` keeping relative offsets. Sections go to their source track if it still
 * exists as a section track, else `target.trackId`; keys to the same channel, else
 * `target.channelId` on `target.trackId` (keys from several channels then collapse onto it).
 * `newId` mints section ids.
 */
export function paste(seq: Sequence, clip: Clipboard, playhead: Beats, newId: () => string, target: PasteTarget = {}): PasteResult {
  let out = seq;
  const sections: PasteResult["sections"] = [];
  const keys: KeyRef[] = [];
  const events: PasteResult["events"] = [];
  for (const c of clip.sections) {
    const trackId = sectionsOf(out, c.trackId) ? c.trackId : target.trackId;
    if (!trackId) continue;
    const id = newId();
    out = putSection(out, trackId, { ...c.section, id, start: playhead + c.rel });
    if (hasSection(out, trackId, id)) sections.push({ trackId, id });
  }
  for (const c of clip.keys) {
    const own = findTrack(out.tracks, c.trackId);
    const hasChannel = own?.kind === "channels" && own.channels.some((x) => x.id === c.channelId);
    const trackId = hasChannel ? c.trackId : target.trackId;
    const channelId = hasChannel ? c.channelId : target.channelId;
    if (!trackId || !channelId) continue;
    const beat = Math.max(0, quantize(playhead + c.rel));
    const next = addKey(out, trackId, channelId, { ...c.key, beat });
    if (next !== out) { out = next; keys.push({ trackId, channelId, beat }); }
  }
  for (const c of clip.events ?? []) {
    const trackId = eventsOf(out, c.trackId) ? c.trackId : target.trackId;
    if (!trackId) continue;
    const id = newId();
    out = addEvent(out, trackId, { ...c.event, id, beat: playhead + c.rel });
    if (hasEvent(out, trackId, id)) events.push({ trackId, id });
  }
  return { seq: out, sections, keys, events };
}

/**
 * Duplicate the selection: each section directly after its original, each key and event `step` beats
 * later on the same channel/track. Returns the new items so the caller can select them.
 */
export function duplicate(seq: Sequence, sel: Sel, newId: () => string, step: Beats): PasteResult {
  const clip = copySelection(seq, sel);
  if (!clip) return { seq, sections: [], keys: [], events: [] };
  let out = seq;
  const sections: PasteResult["sections"] = [];
  const keys: KeyRef[] = [];
  const events: PasteResult["events"] = [];
  for (const c of clip.sections) {
    const id = newId();
    out = putSection(out, c.trackId, { ...c.section, id, start: c.section.start + c.section.length });
    if (hasSection(out, c.trackId, id)) sections.push({ trackId: c.trackId, id });
  }
  for (const c of clip.keys) {
    const beat = quantize(c.key.beat + step);
    const next = addKey(out, c.trackId, c.channelId, { ...c.key, beat });
    if (next !== out) { out = next; keys.push({ trackId: c.trackId, channelId: c.channelId, beat }); }
  }
  for (const c of clip.events ?? []) {
    const id = newId();
    out = addEvent(out, c.trackId, { ...c.event, id, beat: c.event.beat + step });
    if (hasEvent(out, c.trackId, id)) events.push({ trackId: c.trackId, id });
  }
  return { seq: out, sections, keys, events };
}

/**
 * Split section `id` at `at` into two: the second starts at the cut and keeps its content in
 * place via `offset += cut * scale`. No-op unless both halves are >= MIN_SECTION_LENGTH.
 * Returns the new (second) section's id, or null for a no-op.
 */
export function splitSection(seq: Sequence, trackId: string, id: string, at: Beats, newId: () => string): { seq: Sequence; id: string | null } {
  const s = sectionsOf(seq, trackId)?.find((x) => x.id === id);
  const cut = quantize(at);
  if (!s || cut - s.start < MIN_SECTION_LENGTH || s.start + s.length - cut < MIN_SECTION_LENGTH) return { seq, id: null };
  const second: Section = {
    ...s, id: newId(), start: cut, length: quantize(s.start + s.length - cut),
    offset: quantize((s.offset ?? 0) + (cut - s.start) * (s.scale ?? 1)),
  };
  delete second.easeIn;
  const trimmed = trimSection(seq, trackId, id, "end", cut);
  if (trimmed === seq) return { seq, id: null };
  // The cut edge is no longer a section edge: the first half loses easeOut.
  const first = sectionsOf(trimmed, trackId)?.find((x) => x.id === id);
  let base = trimmed;
  if (first?.easeOut !== undefined) {
    const { easeOut: _drop, ...rest } = first;
    base = putSection(deleteSection(trimmed, trackId, id), trackId, rest);
  }
  const out = putSection(base, trackId, second);
  return { seq: out, id: hasSection(out, trackId, second.id) ? second.id : null };
}

/** Split every selected section the playhead cuts through. */
export function splitAt(seq: Sequence, sel: Pick<Selection, "sections">, at: Beats, newId: () => string): { seq: Sequence; ids: string[] } {
  const clip = copySelection(seq, { sections: sel.sections, keys: new Set() });
  let out = seq;
  const ids: string[] = [];
  for (const c of clip?.sections ?? []) {
    const r = splitSection(out, c.trackId, c.section.id, at, newId);
    out = r.seq;
    if (r.id) ids.push(r.id);
  }
  return { seq: out, ids };
}
