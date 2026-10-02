// Nested sequences: parent<->child time transform and cycle checks. No DOM.
// Sequences are resolved from the root's flat `library` (plus the root itself by id).

import type { Beats, Section, Sequence, Track } from "./model";

/** Loop wrap lengths at or below this are treated as "no loop" (avoids division by ~0). */
const MIN_LOOP = 1e-9;

/** Child time for parent beat `t`: (t - start) * scale + offset, wrapped over `childLength` when `ref.loop`. */
export function parentToChild(s: Pick<Section, "start" | "offset" | "scale" | "ref">, t: Beats, childLength: Beats): Beats {
  const c = (t - s.start) * (s.scale ?? 1) + (s.offset ?? 0);
  if (!s.ref?.loop || childLength <= MIN_LOOP) return c;
  return ((c % childLength) + childLength) % childLength;
}

/** Inverse of the linear part: the parent beat where unwrapped child time `c` lands. `null` when scale is 0. */
export function childToParent(s: Pick<Section, "start" | "offset" | "scale">, c: Beats): Beats | null {
  const k = s.scale ?? 1;
  return k === 0 ? null : s.start + (c - (s.offset ?? 0)) / k;
}

/** Whether parent beat `t` falls inside the section (half-open `[start, start+length)`). */
export function sectionContains(s: Pick<Section, "start" | "length">, t: Beats): boolean {
  return t >= s.start && t < s.start + s.length;
}

/** Host hook: supply a sequence that is not in the root's library (e.g. loaded on demand). Must be synchronous and cheap. */
export type SequenceResolver = (id: string) => Sequence | undefined;

/** Look up a sequence by id: the root itself, else its library, else the optional host resolver. */
export function resolveSequence(root: Sequence, id: string, host?: SequenceResolver): Sequence | undefined {
  if (id === root.id) return root;
  return Object.prototype.hasOwnProperty.call(root.library, id) ? root.library[id] : host?.(id);
}

function* sections(tracks: Track[]): Generator<Section> {
  for (const t of tracks) {
    if (t.kind === "sections") yield* t.sections;
    else if (t.kind === "folder") yield* sections(t.children);
  }
}

/** Ids of sequences directly referenced by `seq`'s sections. */
export function childRefs(seq: Sequence): string[] {
  const out = new Set<string>();
  for (const s of sections(seq.tracks)) if (s.ref) out.add(s.ref.sequenceId);
  return [...out];
}

/** True when `from` can reach `target` through refs (a sequence reaches itself only via a real path). */
function reaches(root: Sequence, from: string, target: string, seen = new Set<string>()): boolean {
  const seq = resolveSequence(root, from);
  if (!seq) return false;
  for (const id of childRefs(seq)) {
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    if (reaches(root, id, target, seen)) return true;
  }
  return false;
}

/** Would adding a section in `hostId` that refs `refId` create a cycle? (self-reference counts). */
export function wouldCreateCycle(root: Sequence, hostId: string, refId: string): boolean {
  return hostId === refId || reaches(root, refId, hostId);
}

/** Id path of the first cycle found from the root (e.g. `["a","b","a"]`), or `null` when acyclic. */
export function findCycle(root: Sequence): string[] | null {
  const state = new Map<string, 1 | 2>(); // 1 = on stack, 2 = done
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...path.slice(path.indexOf(id)), id];
    const seq = resolveSequence(root, id);
    if (!seq) return null;
    state.set(id, 1);
    path.push(id);
    for (const c of childRefs(seq)) {
      const cyc = visit(c);
      if (cyc) return cyc;
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  return visit(root.id);
}

/** Section refs that point at a sequence missing from the library. */
export function danglingRefs(root: Sequence): string[] {
  const out = new Set<string>();
  for (const id of [root.id, ...Object.keys(root.library)]) {
    const seq = resolveSequence(root, id);
    if (seq) for (const r of childRefs(seq)) if (!resolveSequence(root, r)) out.add(r);
  }
  return [...out];
}
