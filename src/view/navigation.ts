// Zoom / pan / frame controller (docs/behavior.md section 2). Pure helpers + DOM attach.
import type { Sequence, Track } from "../core/model";
import { parseEventId, parseKeyId, type Selection } from "../edit/selection";
import { MAX_PX_PER_BEAT, MIN_PX_PER_BEAT, zoomAt, type ViewState } from "./viewState";

const FRAME_PADDING = 0.05;
const ZOOM_SENSITIVITY = 0.0015;

/** Keep scrollY within [0, contentH - viewportH] (0 when content fits). */
export function clampScrollY(scrollY: number, contentH: number, viewportH: number): number {
  return Math.min(Math.max(0, contentH - viewportH), Math.max(0, scrollY));
}

/** View showing [startBeat, endBeat] across `widthPx` with fractional padding on each side. Zoom-limited. */
export function frameRange(v: ViewState, startBeat: number, endBeat: number, widthPx: number, padding = FRAME_PADDING): ViewState {
  if (!(widthPx > 0)) return v;
  const lo = Math.min(startBeat, endBeat);
  const span = Math.max(Math.abs(endBeat - startBeat), 1e-6);
  const pad = span * padding;
  const pxPerBeat = Math.min(MAX_PX_PER_BEAT, Math.max(MIN_PX_PER_BEAT, widthPx / (span + 2 * pad)));
  // Center the range (matters when the zoom limit stops us from filling the width).
  const visible = widthPx / pxPerBeat;
  return { ...v, pxPerBeat, startBeat: lo + span / 2 - visible / 2 };
}

/** Beat extent of the selected keys, sections and events (at least 1 beat wide), or null when none. */
export function selectionRange(seq: Pick<Sequence, "tracks">, sel: Selection): { start: number; end: number } | null {
  let lo = Infinity, hi = -Infinity;
  const add = (a: number, b = a) => { if (a < lo) lo = a; if (b > hi) hi = b; };
  for (const id of sel.keys) add(parseKeyId(id).beat);
  const evs = new Set([...sel.events].map((e) => { const r = parseEventId(e); return `${r.trackId}\0${r.id}`; }));
  const walk = (l: readonly Track[]) => {
    for (const t of l) {
      if (t.kind === "sections") { for (const s of t.sections) if (sel.sections.has(s.id)) add(s.start, s.start + s.length); }
      else if (t.kind === "events") { for (const e of t.events) if (evs.has(`${t.id}\0${e.id}`)) add(e.beat); }
      else if (t.kind === "folder") walk(t.children);
    }
  };
  walk(seq.tracks);
  if (lo > hi) return null;
  return hi - lo < 1 ? { start: lo - (1 - (hi - lo)) / 2, end: hi + (1 - (hi - lo)) / 2 } : { start: lo, end: hi };
}

interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }

/** Wheel deltas in px (line/page modes converted). */
const toPx = (d: number, mode: number, pageSize: number): number => (mode === 1 ? d * 16 : mode === 2 ? d * pageSize : d);

/** Apply a wheel event: Ctrl/Cmd = zoom about anchorX, Shift = horizontal pan, plain = vertical scroll (+ horizontal from deltaX). */
export function applyWheel(v: ViewState, e: WheelLike, anchorX: number, contentH: number, viewport: { w: number; h: number }): ViewState {
  const dx = toPx(e.deltaX, e.deltaMode, viewport.w);
  const dy = toPx(e.deltaY, e.deltaMode, viewport.h);
  if (e.ctrlKey || e.metaKey) return zoomAt(v, anchorX, Math.exp(-dy * ZOOM_SENSITIVITY));
  if (e.shiftKey) return { ...v, startBeat: v.startBeat + (dx || dy) / v.pxPerBeat };
  return {
    ...v,
    startBeat: v.startBeat + dx / v.pxPerBeat,
    scrollY: clampScrollY(v.scrollY + dy, contentH, viewport.h),
  };
}

interface NavigationHost {
  getView(): ViewState;
  setView(v: ViewState): void;
  /** Sequence extent in beats, for Home. */
  getSequenceRange(): { start: number; end: number };
  /** Bounding beat range of the selection, or null (F falls back to the sequence). */
  getSelectionRange(): { start: number; end: number } | null;
  /** Total content height in px (rows layout), for scroll clamping. */
  getContentHeight(): number;
}

/** Wire wheel, middle/space-drag pan, Home and F onto `el` (a focusable canvas/container). Returns detach. */
export function attachNavigation(el: HTMLElement, host: NavigationHost): () => void {
  if (el.tabIndex < 0) el.tabIndex = 0;
  const size = () => ({ w: el.clientWidth, h: el.clientHeight });
  let spaceDown = false;
  let drag: { x: number; y: number; view: ViewState } | null = null;

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const x = e.clientX - el.getBoundingClientRect().left;
    host.setView(applyWheel(host.getView(), e, x, host.getContentHeight(), size()));
  };
  const onPointerDown = (e: PointerEvent) => {
    el.focus({ preventScroll: true });
    if (e.button !== 1 && !(e.button === 0 && spaceDown)) return;
    e.preventDefault();
    drag = { x: e.clientX, y: e.clientY, view: host.getView() };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag) return;
    const { view } = drag;
    host.setView({
      ...view,
      startBeat: view.startBeat - (e.clientX - drag.x) / view.pxPerBeat,
      scrollY: clampScrollY(view.scrollY - (e.clientY - drag.y), host.getContentHeight(), size().h),
    });
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!drag) return;
    drag = null;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "Space") { spaceDown = true; return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const w = size().w;
    if (e.key === "Home") {
      const r = host.getSequenceRange();
      host.setView(frameRange(host.getView(), r.start, r.end, w));
    } else if (e.key === "f" || e.key === "F") {
      const r = host.getSelectionRange() ?? host.getSequenceRange();
      host.setView(frameRange(host.getView(), r.start, r.end, w));
    } else return;
    e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceDown = false; };
  const onBlur = () => { spaceDown = false; };

  el.addEventListener("wheel", onWheel, { passive: false });
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  el.addEventListener("keydown", onKeyDown);
  el.addEventListener("keyup", onKeyUp);
  el.addEventListener("blur", onBlur);
  return () => {
    el.removeEventListener("wheel", onWheel);
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
    el.removeEventListener("keydown", onKeyDown);
    el.removeEventListener("keyup", onKeyUp);
    el.removeEventListener("blur", onBlur);
  };
}
