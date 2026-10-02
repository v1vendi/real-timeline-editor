// Drag state, section lookup helpers and click-select shared by the pointer dispatcher, overlay and commands.
import type { Beats, Sequence, Track } from "../core/model";
import type { KeyRef } from "../edit/commands";
import type { ClipEdit } from "../edit/handleOps";
import type { ColorStopRef } from "../edit/colorCommands";
import type { Selection } from "../edit/selection";
import type { ClipHandle } from "./audioHandles";

export type Drag =
  | { kind: "move"; ids: string[]; primary: string; start: Beats; end: Beats; dBeat: Beats; fromTrack?: string; toTrack?: string }
  | { kind: "marker"; id: string; start: Beats; beat: Beats; color?: string }
  | { kind: "trim"; trackId: string; id: string; edge: "start" | "end"; beat: Beats }
  | { kind: "keys"; refs: KeyRef[]; primary: KeyRef; dBeat: Beats; dValue: number }
  | { kind: "colorStop"; ref: ColorStopRef; refs: KeyRef[]; dBeat: Beats }
  | { kind: "tangent"; ref: KeyRef; value: number; side: "in" | "out"; dx: Beats; dy: number }
  | { kind: "ease"; trackId: string; id: string; side: "in" | "out"; start: Beats; length: Beats; dur: Beats }
  | { kind: "clipHandle"; trackId: string; id: string; handle: ClipHandle; start: Beats; length: Beats; fadeIn: Beats; fadeOut: Beats; gain: number }
  | { kind: "clip"; trackId: string; id: string; edit: ClipEdit; grab: Beats; from: number; start: Beats; length: Beats }
  | { kind: "event"; trackId: string; id: string; start: Beats; beat: Beats }
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number; mode: "replace" | "add" };

export function sectionTrackIds(tracks: Track[], out = new Map<string, string>()): Map<string, string> {
  for (const t of tracks) {
    if (t.kind === "sections") for (const s of t.sections) out.set(s.id, t.id);
    else if (t.kind === "folder") sectionTrackIds(t.children, out);
  }
  return out;
}

function sectionField(s: Sequence, id: string, f: "start" | "length"): Beats {
  let r = 0;
  const walk = (l: Track[]) => { for (const t of l) { if (t.kind === "sections") { const x = t.sections.find((q) => q.id === id); if (x) r = x[f]; } else if (t.kind === "folder") walk(t.children); } };
  walk(s.tracks);
  return r;
}
export const startOf = (s: Sequence, id: string): Beats => sectionField(s, id, "start");
export const lenOf = (s: Sequence, id: string): Beats => sectionField(s, id, "length");

/** Click-select one item of `kind`: replaces sections/keys/events/markers/clips, keeps tracks/channels. */
export const solo = (sel: Selection, kind: "sections" | "keys" | "events" | "markers" | "clips", id: string): Selection =>
  ({ ...sel, sections: new Set(), keys: new Set(), events: new Set(), markers: new Set(), clips: new Set(), [kind]: new Set([id]) });
