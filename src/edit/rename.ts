// Rename ops (pure): (seq, ...) => seq. Names are trimmed; empty, unchanged, unknown or locked returns `seq`.
import type { Sequence, Track } from "../core/model";
import { withTrack } from "./trackOps";

/** Trimmed name, or undefined when empty. */
export function cleanName(name: string): string | undefined {
  const n = name.trim();
  return n ? n : undefined;
}

function renameIn<T extends { id: string }>(list: T[], id: string, key: keyof T, name: string): T[] {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0 || list[i]![key] === name) return list;
  return [...list.slice(0, i), { ...list[i]!, [key]: name }, ...list.slice(i + 1)];
}

function onTrack(seq: Sequence, trackId: string, name: string, fn: (t: Track, n: string) => Track): Sequence {
  const n = cleanName(name);
  return n === undefined ? seq : withTrack(seq, trackId, (t) => fn(t, n));
}

/** Rename a track or folder. A locked track (or one under a locked folder) is refused. */
export function renameTrack(seq: Sequence, trackId: string, name: string): Sequence {
  return onTrack(seq, trackId, name, (t, n) => (t.name === n ? t : { ...t, name: n }));
}

export function renameChannel(seq: Sequence, trackId: string, channelId: string, name: string): Sequence {
  return onTrack(seq, trackId, name, (t, n) => {
    if (t.kind !== "channels") return t;
    const channels = renameIn(t.channels, channelId, "name", n);
    return channels === t.channels ? t : { ...t, channels };
  });
}

/** Sets the section `label`. */
export function renameSection(seq: Sequence, trackId: string, sectionId: string, name: string): Sequence {
  return onTrack(seq, trackId, name, (t, n) => {
    if (t.kind !== "sections") return t;
    const sections = renameIn(t.sections, sectionId, "label", n);
    return sections === t.sections ? t : { ...t, sections };
  });
}

export function renameEvent(seq: Sequence, trackId: string, eventId: string, name: string): Sequence {
  return onTrack(seq, trackId, name, (t, n) => {
    if (t.kind !== "events") return t;
    const events = renameIn(t.events, eventId, "name", n);
    return events === t.events ? t : { ...t, events };
  });
}

/** Sets the clip `label`. */
export function renameClip(seq: Sequence, trackId: string, clipId: string, name: string): Sequence {
  return onTrack(seq, trackId, name, (t, n) => {
    if (t.kind !== "audio") return t;
    const clips = renameIn(t.clips, clipId, "label", n);
    return clips === t.clips ? t : { ...t, clips };
  });
}

/** Markers are sequence-level (no lock). */
export function renameMarker(seq: Sequence, markerId: string, name: string): Sequence {
  const n = cleanName(name);
  if (n === undefined) return seq;
  const markers = renameIn(seq.markers, markerId, "label", n);
  return markers === seq.markers ? seq : { ...seq, markers };
}
