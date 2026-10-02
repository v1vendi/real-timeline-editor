// Section commands: add/delete/move/trim and cross-track moves (lanes are reassigned after each).
import { quantize } from "../core/model";
import type { Beats, Section, Sequence, Track } from "../core/model";
import { assignLanes, placeSection } from "../core/lanes";
import { wouldCreateCycle } from "../core/nested";
import { withTrack } from "./trackOps";

/** Smallest section length after a trim (one 1/16 beat grid step by default). */
export const MIN_SECTION_LENGTH = 1 / 16;

function withSections(seq: Sequence, trackId: string, fn: (s: Section[]) => Section[]): Sequence {
  return withTrack(seq, trackId, (t) => {
    if (t.kind !== "sections") return t;
    const sections = fn(t.sections);
    return sections === t.sections ? t : { ...t, sections };
  });
}

function withSection(seq: Sequence, trackId: string, id: string, fn: (s: Section) => Section): Sequence {
  return withSections(seq, trackId, (list) => {
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) return list;
    const next = fn(list[i]!);
    return next === list[i] ? list : list.map((s, j) => (j === i ? next : s));
  });
}

/** Recompute lanes after a structural change; returns `list` itself when nothing moved lanes. */
function relane(list: Section[]): Section[] {
  const out = assignLanes(list);
  return out.every((s, i) => s === list[i]) ? list : out;
}

/**
 * Add a section in the first free lane. Duplicate ids are ignored; a `ref` that would create a
 * cycle (self-reference included) is rejected, as is a ref to a sequence that reaches this one.
 */
export function addSection(seq: Sequence, trackId: string, section: Omit<Section, "row"> & { row?: number }): Sequence {
  if (section.ref && wouldCreateCycle(seq, seq.id, section.ref.sequenceId)) return seq;
  return withSections(seq, trackId, (list) =>
    list.some((s) => s.id === section.id) ? list : [...list, placeSection({
      row: 0, ...section,
      start: Math.max(0, quantize(section.start)),
      length: Math.max(MIN_SECTION_LENGTH, quantize(section.length)),
    }, list)]);
}

export function deleteSection(seq: Sequence, trackId: string, id: string): Sequence {
  return withSections(seq, trackId, (list) => (list.some((s) => s.id === id) ? relane(list.filter((s) => s.id !== id)) : list));
}

/** Reassign lanes on a track after move/trim (no-op when `seq` was not changed by the edit). */
function relaneTrack(seq: Sequence, trackId: string): Sequence {
  return withSections(seq, trackId, relane);
}

/** Move a section to `start` (clamped to >= 0). */
export function moveSection(seq: Sequence, trackId: string, id: string, start: Beats): Sequence {
  const b = Math.max(0, quantize(start));
  return relaneTrack(withSection(seq, trackId, id, (s) => (s.start === b ? s : { ...s, start: b })), trackId);
}

/**
 * Trim an edge to `beat`. The left edge keeps content in place by shifting `offset`;
 * the right edge changes length only. Length is clamped to `minLength`.
 */
export function trimSection(seq: Sequence, trackId: string, id: string, edge: "start" | "end", beat: Beats,
  minLength: Beats = MIN_SECTION_LENGTH): Sequence {
  return relaneTrack(withSection(seq, trackId, id, (s) => {
    const end = s.start + s.length;
    if (edge === "end") {
      const length = Math.max(minLength, quantize(beat - s.start));
      return length === s.length ? s : { ...s, length };
    }
    const start = Math.max(0, Math.min(quantize(beat), end - minLength));
    if (start === s.start) return s;
    return { ...s, start, length: quantize(end - start), offset: quantize((s.offset ?? 0) + (start - s.start) * (s.scale ?? 1)) };
  }), trackId);
}

/** Move a section from one section track to another at `start`; the lane is reassigned (first free). No-op when either track is locked/not a section track or the id is missing/duplicated there. */
export function moveSectionToTrack(seq: Sequence, fromId: string, id: string, toId: string, start: Beats): Sequence {
  if (fromId === toId) return moveSection(seq, fromId, id, start);
  let found: Section | undefined, ok = false;
  const scan = (l: Track[]) => { for (const t of l) { if (t.id === toId && t.kind === "sections" && !t.locked && !t.sections.some((s) => s.id === id)) ok = true; if (t.id === fromId && t.kind === "sections" && !t.locked) found = t.sections.find((s) => s.id === id); if (t.kind === "folder") scan(t.children); } };
  scan(seq.tracks);
  if (!found || !ok) return seq;
  const { row: _row, ...rest } = found as Section;
  return addSection(deleteSection(seq, fromId, id), toId, { ...rest, start });
}
