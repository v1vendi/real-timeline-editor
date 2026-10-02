/**
 * Studio demo host. PUBLIC API ONLY (createTimeline etc. from ../src). Panels are separate files;
 * this one only wires them up.
 *
 * PANEL CONTRACT
 *   Put a file in demo/studio/panels/<name>.ts (auto-loaded via import.meta.glob, alphabetical order):
 *       import type { StudioCtx } from "../studio";
 *       export default function mount(ctx: StudioCtx): void { ... }
 *   Append your own DOM to ctx.toolbar (top bar, inline buttons) and/or ctx.side (right panel, wrap
 *   your UI in one <section> with an <h4> title). Style inline; no shared CSS.
 *
 *   ctx = {
 *     tl                      Timeline handle (createTimeline result)
 *     toolbar, side           HTMLElement containers
 *     getSeq()                current Sequence (tl.getSequence())
 *     edit(label, fn)         pure `seq => seq` edit as ONE undo entry (tl.edit)
 *     setSeq(seq)             replace the document (clears undo, like tl.setSequence)
 *     getBeat() / seek(beat)  fake host clock; seek moves the playhead
 *     onUpdate(cb) -> off     cb() after any edit/undo/redo, selection change, setSeq or seek
 *   }
 *   Sample data: demo/studio/sample.ts exports `sample: Sequence` and `peaks: Map<string, PeakMips>`
 *   (keep these two export names).
 */
/// <reference types="vite/client" />
import { createTimeline, type KeymapConflict, type KeymapOverrides, type Sequence, type Timeline } from "../src";
import { sample, peaks } from "./studio/sample";

export interface StudioCtx {
  /** Current timeline; REPLACED by rebind(), so re-read it on every use, never cache it. */
  readonly tl: Timeline;
  toolbar: HTMLElement;
  side: HTMLElement;
  getSeq(): Sequence;
  edit(label: string, fn: (seq: Sequence) => Sequence): void;
  setSeq(seq: Sequence): void;
  getBeat(): number;
  seek(beat: number): void;
  onUpdate(cb: () => void): () => void;
  /** Destroy and recreate the timeline with keymapOverrides, keeping sequence (undo history is lost), view, selection, work range, read-only, grid mode. */
  rebind(overrides: KeymapOverrides, onWarning?: (w: { conflicts: KeymapConflict[]; invalid: string[] }) => void): void;
  /** cb() after a rebind, once ctx.tl is the new timeline. */
  onRebind(cb: () => void): () => void;
}

let beat = 0;
const clockSubs = new Set<(b: number) => void>();
const updateSubs = new Set<() => void>();
const fire = () => updateSubs.forEach((f) => f());
const seek = (b: number) => { beat = Math.max(0, b); clockSubs.forEach((f) => f(beat)); fire(); };

const rebindSubs = new Set<() => void>();
// Open the folders and the clip lanes; leave channel tracks folded to their summary rows.
let expanded: string[] = ["f-light", "f-fx", "fx-main", "f-audio"];
const make = (seq: Sequence, overrides?: KeymapOverrides, onWarning?: (w: { conflicts: KeymapConflict[]; invalid: string[] }) => void): Timeline => createTimeline(document.getElementById("tl")!, {
  sequence: seq, peaks, expanded, outlinerWidth: 210,
  theme: { base: document.documentElement.dataset.theme === "light" ? "light" : "dark" },
  keymapOverrides: overrides, onKeymapWarning: onWarning,
  clock: { getTime: () => beat, subscribe: (cb) => { clockSubs.add(cb); return () => clockSubs.delete(cb); } },
  onSeek: seek,
  onChange: fire,
  onNavigate: fire,
  onSelect: fire,
  onPlayToggle: () => document.getElementById("studio-play")?.click(),
  // Double-click on a channel row / key: the curve panel listens for this DOM event.
  onOpenCurve: (trackId, channelId) => document.dispatchEvent(new CustomEvent("studio-open-curve", { detail: { trackId, channelId } })),
  // Double-click on a color group row: the color panel listens for this DOM event.
  onPickColor: (trackId, groupId, beat) => document.dispatchEvent(new CustomEvent("studio-pick-color", { detail: { trackId, groupId, beat } })),
});
let tl = make(sample);

const ctx: StudioCtx = {
  get tl() { return tl; },
  toolbar: document.getElementById("toolbar")!,
  side: document.getElementById("side")!,
  getSeq: () => tl.getSequence(),
  edit: (label, fn) => tl.edit(label, fn),
  setSeq: (seq) => { tl.setSequence(seq); fire(); },
  getBeat: () => beat,
  seek,
  onUpdate: (cb) => { updateSubs.add(cb); return () => updateSubs.delete(cb); },
  onRebind: (cb) => { rebindSubs.add(cb); return () => rebindSubs.delete(cb); },
  rebind(overrides, onWarning) {
    const old = tl, seq = old.getSequence(), view = old.getView(), sel = old.getSelection(), ro = old.readOnly, ex = old.getExpanded(), gm = old.getGridMode(), wr = old.getWorkRange();
    old.destroy();
    tl = make(seq, overrides, onWarning);
    tl.setView(view); tl.setSelection(sel); tl.setReadOnly(ro); tl.setGridMode(gm); tl.setWorkRange(wr); tl.setExpanded(ex);
    rebindSubs.forEach((f) => f());
    fire();
  },
};

const panels = import.meta.glob<{ default: (ctx: StudioCtx) => void }>("./studio/panels/*.ts", { eager: true });
for (const [path, m] of Object.entries(panels).sort(([a], [b]) => a.localeCompare(b))) {
  try { m.default(ctx); } catch (e) { console.error(`panel ${path} failed`, e); }
}
(window as unknown as { studio: StudioCtx }).studio = ctx;
