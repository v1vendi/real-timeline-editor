// Pointer + keyboard controller (docs/behavior.md sections 4, 5, 6, 15). Wires hit testing,
// edit commands, history, selection, snapping and clipboard. A drag only draws a preview on the
// overlay and commits ONE history entry on pointer up. The ruler (scrub) is handled by attachScrub.
import type { Beats, Section, Sequence } from "../core/model";
import { gridStep, type GridMode } from "../core/time";
import type { History } from "../edit/history";
import { emptySelection, eventId, keyId, select, type Selection } from "../edit/selection";
import type { RowLayout } from "../core/rows";
import type { RowMetrics } from "../core/rows";
import { colorPickTargetOf, cursorFor, curveTargetOf, hitMarker, type Hit } from "./hit";
import { createHitSnap } from "./hitSnap";
import type { DrawContext, Layer } from "./layers";
import { RULER_HEIGHT } from "./ruler";
import { buildKeymap, eventChord, type CommandId, type KeymapOverrides } from "./keymap";
import type { ViewState } from "./viewState";
import { createRenamer, type RenameTarget } from "./rename";
import { solo, type Drag } from "./drag";
import { createCommands } from "./commands";
import { drawDragOverlay } from "./overlay";
import { startDrag, type PressState } from "./dragStart";
import { createDragUpdater } from "./dragUpdate";
import { createDragCommitter } from "./dragCommit";

export type { CommandId };
/** Default keymap: canonical chord -> action (behavior.md section 15). See keymap.ts to build overridden ones. */
export const DEFAULT_KEYMAP: Record<string, CommandId> = buildKeymap().map;

export interface InteractionHost {
  history: History;
  getLayout(): RowLayout;
  getView(): ViewState;
  getSelection(): Selection;
  setSelection(s: Selection): void;
  getPlayhead(): Beats;
  /** Request a seek (host owns the clock). */
  seek(beat: Beats): void;
  invalidate(layer: Layer): void;
  /** Called after the sequence changed (edit, undo, redo): rebuild layout, repaint static. */
  edited(): void;
  onPlayToggle?(): void;
  onAddMarker?(beat: Beats): void;
  /** Fully resolved chord -> action map (replaces the defaults). Ignored when `keymapOverrides` is set. */
  keymap?: Record<string, CommandId>;
  /** Per-action overrides merged over the defaults (see buildKeymap). */
  keymapOverrides?: KeymapOverrides;
  newId?(): string;
  /** Row metrics in use (default metrics when absent). */
  getMetrics?(): RowMetrics;
  /** Z / X: frame the selection (or the sequence) and zoom out. */
  zoomSelection?(): void;
  zoomOut?(): void;
  /** Grid flavour for snapping and step keys (default straight). */
  getGridMode?(): GridMode;
  /** Curve-view value axis (content-space y <-> value). Enables tangent-handle hits and vertical key drag. */
  curve?(channelId?: string): { valueToY(v: number, channelId?: string): number; yToValue(y: number, channelId?: string): number } | undefined;
  /** When true, only selection drags (box) start; move/trim/key/event drags never do. */
  readOnly?(): boolean;
  /** Double-click on a nested (`ref`) section: enter its child. Return true when handled. */
  enterChild?(section: Section): boolean;
  /** Sequence currently shown (defaults to the history root); differs from it inside a child. */
  viewSeq?(): Sequence;
  /** Leave the current child sequence (one level up). Return true when it moved. */
  goUp?(): boolean;
  /** Double-click on a channel row, a collapsed channels track or a key: open the curve editor (`channelId` absent = every channel of the track). Return true when handled. */
  openCurve?(trackId: string, channelId?: string): boolean;
  pickColor?(trackId: string, groupId: string, beat: number | null): boolean;
  /** Open the outliner's inline editor on a track / channel row. Return true when handled. */
  renameRow?(trackId: string, channelId?: string): boolean;
}


interface Interaction { drawOverlay(c: DrawContext): void; detach(): void; /** Rename action (R / F2): the selected row / single section / event / marker / clip. */ renameSelection(): boolean }


export function attachInteraction(el: HTMLElement, host: InteractionHost): Interaction {
  if (el.tabIndex < 0) el.tabIndex = 0;
  let drag: Drag | null = null;
  let down: PressState | null = null;
  let mkDown: { id: string; beat: Beats; color?: string } | null = null;
  let spaceDown = false;
  let n = 0;
  const newId = host.newId ?? (() => `n${Date.now().toString(36)}${n++}`);
  const seq = (): Sequence => host.viewSeq?.() ?? host.history.seq;
  const pos = (e: PointerEvent | MouseEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const contentY = (py: number) => py - RULER_HEIGHT + host.getView().scrollY;
  const step = () => gridStep(host.getView().pxPerBeat, seq().beatsPerBar, undefined, host.getGridMode?.());
  const refresh = () => { host.edited(); host.invalidate("overlay"); };
  const renamer = createRenamer(el, host, seq, refresh);
  const { run, addEventAt } = createCommands({ host, seq, newId, step, refresh, rename: renamer.startSelection });
  const setSel = (s: Selection) => { host.setSelection(s); host.invalidate("overlay"); };

  const hs = createHitSnap(host, seq);
  const { hitAt, snap } = hs;

  /** Pointer-down selection: toggle with a modifier, else select the item unless it is already selected. */
  const pressSelect = (hit: Hit, mod: boolean) => {
    const sel = host.getSelection();
    const pick = (kind: "keys" | "sections" | "events" | "clips", id: string) =>
      setSel(mod ? select(sel, kind, [id], "toggle") : sel[kind].has(id) ? sel : solo(sel, kind, id));
    if (hit.kind === "key") pick("keys", keyId({ trackId: hit.row.track.id, channelId: hit.channelId, beat: hit.beat }));
    else if (hit.kind === "section") pick("sections", hit.sectionId);
    else if (hit.kind === "event") pick("events", eventId(hit.trackId, hit.eventId));
    else if (hit.kind === "clip" || hit.kind === "clipHandle") pick("clips", eventId(hit.row.track.id, hit.clipId));
  };

  const onDown = (e: PointerEvent) => {
    el.focus({ preventScroll: true });
    const p = pos(e);
    if (e.button !== 0 || spaceDown || p.y < RULER_HEIGHT) return;
    const mid = hitMarker(seq().markers, host.getView(), p.x, p.y, RULER_HEIGHT);
    const mk = mid ? seq().markers.find((m) => m.id === mid) : undefined;
    if (mk) {
      mkDown = { id: mk.id, beat: mk.beat, color: mk.color };
      const sel = host.getSelection(), mm = e.ctrlKey || e.metaKey || e.shiftKey;
      setSel(mm ? select(sel, "markers", [mk.id], "toggle") : sel.markers.has(mk.id) ? sel : solo(sel, "markers", mk.id));
      down = { x: p.x, y: p.y, hit: { kind: "none" }, mod: false, moved: false };
      el.setPointerCapture(e.pointerId); e.stopImmediatePropagation();
      return;
    }
    const cy = contentY(p.y);
    const hit = hitAt(p.x, cy);
    const mod = e.ctrlKey || e.metaKey || e.shiftKey;
    down = { x: p.x, y: p.y, hit, mod, moved: false };
    el.setPointerCapture(e.pointerId);
    pressSelect(hit, mod);
  };

  const updateDrag = createDragUpdater({ host, seq, contentY, ...hs });
  const commitDrag = createDragCommitter(host, seq, setSel);

  const onMove = (e: PointerEvent) => {
    const p = pos(e);
    if (!down) {
      if (p.y >= RULER_HEIGHT) el.style.cursor = cursorFor(hitAt(p.x, contentY(p.y)));
      return;
    }
    if (!down.moved) {
      if (Math.hypot(p.x - down.x, p.y - down.y) < 3) return;
      down.moved = true;
      drag = startDrag(e, down, host.getSelection(), mkDown, contentY);
      if (drag && drag.kind !== "box" && host.readOnly?.()) drag = null;
    }
    if (!drag) return;
    updateDrag(drag, p, down, { altKey: e.altKey });
    host.invalidate("overlay");
  };

  /** A press released without a drag: click-select the pressed item (or clear on empty space). */
  const commitClick = (d: NonNullable<typeof down>, isMarker: boolean) => {
    if (isMarker || d.moved || d.mod) return;
    const h = d.hit, sel = host.getSelection();
    if (h.kind === "clip") setSel(solo(sel, "clips", eventId(h.row.track.id, h.clipId)));
    else if (h.kind === "none" || h.kind === "row") setSel(emptySelection);
    else if (h.kind === "key") setSel(solo(sel, "keys", keyId({ trackId: h.row.track.id, channelId: h.channelId, beat: h.beat })));
    else if (h.kind === "section") setSel(solo(sel, "sections", h.sectionId));
    else if (h.kind === "event") setSel(solo(sel, "events", eventId(h.trackId, h.eventId)));
  };


  const onUp = (e: PointerEvent) => {
    if (!down) return;
    const d = down, g = drag, isMarker = !!mkDown;
    down = null; drag = null; hs.setGuide(null); mkDown = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!g) { commitClick(d, isMarker); return; }
    commitDrag(g);
    refresh();
  };


  /** Double-click target to rename: sections (nested refs need Alt), events, clips; markers are handled on the ruler. */
  const renameTargetOf = (hit: Hit, alt: boolean): RenameTarget | undefined => {
    if (hit.kind === "event") return { kind: "event", trackId: hit.trackId, id: hit.eventId };
    if (hit.kind === "clip" || hit.kind === "clipHandle") return { kind: "clip", trackId: hit.row.track.id, id: hit.clipId };
    if (hit.kind === "section" && hit.zone === "body") {
      const t = hit.row.track, s = t.kind === "sections" ? t.sections.find((x) => x.id === hit.sectionId) : undefined;
      if (s && (!s.ref || alt)) return { kind: "section", trackId: t.id, id: s.id };
    }
    return undefined;
  };
  const onDbl = (e: MouseEvent) => {
    const p = pos(e);
    const mid = hitMarker(seq().markers, host.getView(), p.x, p.y, RULER_HEIGHT);
    if (mid) { renamer.start({ kind: "marker", id: mid }); return; }
    if (p.y < RULER_HEIGHT) return;
    const hit = hitAt(p.x, contentY(p.y));
    const rt = renameTargetOf(hit, e.altKey);
    if (rt) { renamer.start(rt); return; }
    if (hit.kind === "section") {
      const t = hit.row.track, s = t.kind === "sections" ? t.sections.find((x) => x.id === hit.sectionId) : undefined;
      if (s?.ref && host.enterChild?.(s)) return;
    }
    const cp = colorPickTargetOf(hit);
    if (cp && host.pickColor?.(cp.trackId, cp.groupId, cp.beat)) return;
    const ct = curveTargetOf(hit);
    if (ct && host.openCurve?.(ct.trackId, ct.channelId)) return;
    if (hit.kind !== "row" || hit.row.track.kind !== "events" || hit.row.track.locked) return;
    addEventAt(Math.max(0, snap(hit.beat, e, new Set())), hit.row.track.id);
    hs.setGuide(null);
  };


  let cached: { o: KeymapOverrides; map: Record<string, CommandId> } | undefined;
  const activeMap = (): Record<string, CommandId> => {
    const o = host.keymapOverrides;
    if (!o) return host.keymap ?? DEFAULT_KEYMAP;
    if (cached?.o !== o) cached = { o, map: buildKeymap(o).map };
    return cached.map;
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Space") spaceDown = e.type === "keydown";
    if (e.type === "keyup") return;
    const cmd = activeMap()[eventChord(e)];
    if (cmd && !e.repeat && run(cmd)) e.preventDefault();
    else if (cmd && e.repeat && (cmd === "stepBack" || cmd === "stepForward") && run(cmd)) e.preventDefault();
  };
  const onBlur = () => { spaceDown = false; };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("dblclick", onDbl);
  el.addEventListener("keydown", onKey);
  el.addEventListener("keyup", onKey);
  el.addEventListener("blur", onBlur);


  return {
    drawOverlay: (c: DrawContext) => drawDragOverlay(c, host, seq, drag, hs.guide()),
    renameSelection: renamer.startSelection,
    detach() {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("dblclick", onDbl);
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("keyup", onKey);
      el.removeEventListener("blur", onBlur);
    },
  };
}

