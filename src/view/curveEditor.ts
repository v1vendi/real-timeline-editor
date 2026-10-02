// Curve editor: value/time view of selected channels with tangent handle dragging.
// Standalone canvas; edits go through a History (one undo entry per drag) and out via onChange.
// Wheel = zoom time, shift+wheel = zoom value, F = frame. Click/box (shift = add) selects keys;
// drag a key to move the selection (shift = lock axis); drag empty = box select, middle/alt-drag = pan.
// 1/2/3 = tangent mode auto/aligned/free on selected keys; ctrl+Z / ctrl+shift+Z undo/redo.
import type { Key, Sequence, Tangent, Track } from "../core/model";
import { handlesOf } from "../core/curve";
import { moveKeys, setHandle, movedKeyRef, type KeyRef } from "../edit/commands";
import { History } from "../edit/history";
import { quantize } from "../core/model";
import type { Row } from "../core/rows";
import { darkTheme, type Theme } from "./theme";
import { clipRect } from "./paint";
import { channelColor, colorGroupOf } from "./colorLane";
import { hitTangent, DEFAULT_HIT_OPTIONS, type Hit } from "./hit";
import { beatToX, defaultViewState, xToBeat, zoomAt, type ViewState } from "./viewState";
import { fitValues, keysInBox, lockAxis, panValue, setTangentMode, sampleChannel, valueRange, valueTicks, valueToY, yToValue, zoomValueAt, type ValueAxis } from "./curveMath";

interface CurveEditorOptions {
  onChange(seq: Sequence): void;
  /** Called when the user changes the key selection (not for `select()` calls). */
  onSelect?(refs: KeyRef[]): void;
  /** Shared history (host undo stack); a private one is created when omitted. */
  history?: History;
  gutterPx?: number;
  /** Theme source, read on every paint (default dark). */
  theme?: () => Theme;
}
/** `playhead` is a beat (vertical line); `selection` replaces the selected keys (e.g. from the main timeline). */
interface CurveEditorState { seq: Sequence; channelIds: readonly string[]; playhead?: number; selection?: readonly KeyRef[] }
export interface CurveEditor {
  update(s: Partial<CurveEditorState>): void; frame(selectedOnly?: boolean): void; destroy(): void;
  selection(): KeyRef[]; setTangentMode(mode: Tangent["mode"]): void; history: History;
}


function collectRows(tracks: readonly Track[], ids: ReadonlySet<string>, out: Row[] = []): Row[] {
  for (const t of tracks) {
    if (t.kind === "folder") collectRows(t.children, ids, out);
    else if (t.kind === "channels") for (const channel of t.channels) if (ids.has(channel.id)) out.push({ kind: "channel", id: channel.id, track: t, channel, depth: 0, expandable: false, expanded: false, y: 0, h: 0 });
  }
  return out;
}

export function mountCurveEditor(host: HTMLElement, opts: CurveEditorOptions, init: CurveEditorState): CurveEditor {
  const gutter = opts.gutterPx ?? 48;
  const history = opts.history ?? new History(init.seq);
  if (history.seq !== init.seq && !opts.history) history.seq = init.seq;
  let st = init, rows = collectRows(history.seq.tracks, new Set(st.channelIds));
  const rebuild = () => { rows = collectRows(history.seq.tracks, new Set(st.channelIds)); };
  let view: ViewState = defaultViewState();
  let axis: ValueAxis = { top: 1, pxPerUnit: 100 };
  const X = (b: number) => beatToX(view, b), Y = (v: number) => valueToY(axis, v);
  const selected = new Map<string, KeyRef>();
  const keyId = (c: string, beat: number) => `${c}@${quantize(beat)}`;
  const keysOf = (c: string) => { for (const r of rows) if (r.kind === "channel" && r.id === c) return r.channel.keys; return []; };
  const refOf = (r: Row, beat: number): KeyRef => ({ trackId: r.kind === "channel" ? r.track.id : "", channelId: r.kind === "channel" ? r.id : "", beat });
  const setSel = (refs: readonly KeyRef[]) => { selected.clear(); for (const r of refs) selected.set(keyId(r.channelId, r.beat), r); };
  const notifySel = () => opts.onSelect?.([...selected.values()]);
  const boxSel = { box: null as null | { x0: number; y0: number; x1: number; y1: number } };
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "width:100%;height:100%;display:block";
  canvas.tabIndex = 0;
  host.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  let raf = 0;
  const draw = () => { raf = 0; paint(); };
  const invalidate = () => { raf ||= requestAnimationFrame(draw); };
  const hitOpts = () => ({ ...DEFAULT_HIT_OPTIONS, curve: { valueToY: Y, isKeySelected: (c: string, i: number) => selected.has(keyId(c, keysOf(c)[i]?.beat ?? NaN)) } });

  function frame(selectedOnly = false) {
    const pick = rows.map((r) => r.kind === "channel" ? r.channel : undefined).filter((c) => !!c);
    const chans = selectedOnly && selected.size ? pick.map((c) => ({ keys: c.keys.filter((k) => selected.has(keyId(c.id, k.beat))) })) : pick;
    const range = valueRange(chans);
    const all = chans.flatMap((c) => c.keys.map((k) => k.beat));
    if (!range || !all.length) return;
    const w = Math.max(1, canvas.clientWidth - gutter), b0 = Math.min(...all), b1 = Math.max(...all);
    const pxPerBeat = Math.max(1, (w - 48) / (b1 - b0 || 1));
    view = { ...view, pxPerBeat, startBeat: b0 - 24 / pxPerBeat };
    axis = fitValues(range[0], range[1], canvas.clientHeight);
    invalidate();
  }

  /** Tangent handles (stem + dot) of the key at `i`. */
  function paintHandles(tc: Theme["color"], keys: readonly Key[], i: number) {
    const k = keys[i]!, h = handlesOf(keys, i);
    for (const [dx, dy] of [[h.inDx, h.inDy], [h.outDx, h.outDy]] as const) {
      ctx.strokeStyle = tc.textDim; ctx.beginPath(); ctx.moveTo(X(k.beat), Y(k.value)); ctx.lineTo(X(k.beat + dx), Y(k.value + dy)); ctx.stroke();
      ctx.fillStyle = tc.handle; ctx.beginPath(); ctx.arc(X(k.beat + dx), Y(k.value + dy), 3.5, 0, 7); ctx.fill();
    }
  }

  function paint() {
    const dpr = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const th = opts.theme?.() ?? darkTheme, tc = th.color;
    ctx.fillStyle = tc.bg; ctx.fillRect(0, 0, W, H);
    ctx.font = `${th.font.small}px ${th.font.ui}`; ctx.textBaseline = "middle"; ctx.textAlign = "right";
    for (const v of valueTicks(yToValue(axis, H), yToValue(axis, 0), axis.pxPerUnit)) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? tc.rulerTick : tc.rowLine; ctx.beginPath(); ctx.moveTo(gutter, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = tc.textDim; ctx.fillText(String(v), gutter - 6, y);
    }
    clipRect(ctx, gutter, 0, W - gutter, H); ctx.translate(gutter, 0);
    rows.forEach((r, n) => {
      if (r.kind !== "channel") return;
      const color = channelColor(th, colorGroupOf(r.track), r.channel) ?? tc.series[n % tc.series.length]!, keys = r.channel.keys;
      const pts = sampleChannel(r.channel, view.startBeat, xToBeat(view, W - gutter), view.pxPerBeat);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) ctx[i ? "lineTo" : "moveTo"](X(pts[i]!), Y(pts[i + 1]!));
      ctx.stroke(); ctx.lineWidth = 1;
      keys.forEach((k, i) => {
        const sel = selected.has(keyId(r.id, k.beat));
        if (sel && (k.interp === "bezier" || keys[i - 1]?.interp === "bezier")) paintHandles(tc, keys, i);
        ctx.fillStyle = sel ? tc.selection : color; ctx.strokeStyle = tc.handleStroke;
        ctx.beginPath(); ctx.rect(X(k.beat) - 4, Y(k.value) - 4, 8, 8); ctx.fill(); ctx.stroke();
      });
    });
    if (st.playhead !== undefined) {
      const px = Math.round(X(st.playhead)) + 0.5;
      ctx.strokeStyle = tc.playhead; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
    }
    const bx = boxSel.box;
    if (bx) {
      ctx.fillStyle = tc.box; ctx.strokeStyle = tc.boxEdge;
      const rx = Math.min(bx.x0, bx.x1), ry = Math.min(bx.y0, bx.y1), rw = Math.abs(bx.x1 - bx.x0), rh = Math.abs(bx.y1 - bx.y0);
      ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    }
    ctx.restore();
  }

  type Drag =
    | { kind: "handle"; ref: KeyRef; side: "in" | "out"; beat: number; value: number }
    | { kind: "keys"; refs: KeyRef[]; x0: number; y0: number; moved: boolean }
    | { kind: "box"; x0: number; y0: number; add: boolean; base: KeyRef[] }
    | { kind: "pan"; x: number; y: number };
  let drag: Drag | null = null;
  const pos = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left - gutter, y: e.clientY - r.top }; };
  // Curves share one plot, so hit-test per channel: tangent handles before keys.
  function hitAt(x: number, y: number): Hit | null {
    let key: Hit | null = null;
    for (const r of rows) {
      if (r.kind !== "channel") continue;
      const t = hitTangent(r, view, x, y, hitOpts());
      if (t) return t;
      r.channel.keys.forEach((k, i) => {
        if (!key && Math.abs(X(k.beat) - x) <= 6 && Math.abs(Y(k.value) - y) <= 6) key = { kind: "key", row: r, channelId: r.id, keyIndex: i, beat: k.beat };
      });
    }
    return key;
  }
  const changed = () => { rebuild(); opts.onChange(history.seq); invalidate(); };

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = pos(e);
    const h = hitAt(x, y);
    canvas.setPointerCapture(e.pointerId); canvas.focus();
    if (e.button === 1 || e.altKey) { drag = { kind: "pan", x: e.clientX, y: e.clientY }; return; }
    if (h?.kind === "tangent" && h.row.kind === "channel") {
      const k = h.row.channel.keys[h.keyIndex]!;
      history.begin("Edit tangent");
      drag = { kind: "handle", ref: refOf(h.row, k.beat), side: h.side, beat: k.beat, value: k.value };
    } else if (h?.kind === "key") {
      const ref = refOf(h.row, h.beat), id = keyId(h.channelId, h.beat);
      if (e.shiftKey && selected.has(id)) selected.delete(id);
      else { if (!e.shiftKey && !selected.has(id)) selected.clear(); selected.set(id, ref); }
      notifySel();
      drag = { kind: "keys", refs: [...selected.values()], x0: x, y0: y, moved: false };
    } else {
      if (!e.shiftKey) { selected.clear(); notifySel(); }
      drag = { kind: "box", x0: x, y0: y, add: e.shiftKey, base: e.shiftKey ? [...selected.values()] : [] };
    }
    invalidate();
  });
  canvas.addEventListener("pointermove", (e) => {
    const { x, y } = pos(e);
    if (!drag) { const h = hitAt(x, y); canvas.style.cursor = h?.kind === "tangent" ? "crosshair" : h ? "move" : "default"; return; }
    if (drag.kind === "handle") {
      const d = drag, dBeat = xToBeat(view, x) - d.beat, dVal = yToValue(axis, y) - d.value;
      history.preview((s) => setHandle(s, d.ref, d.side, dBeat, dVal));
      changed();
    } else if (drag.kind === "keys") {
      if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 3) return;
      if (!drag.moved) { drag.moved = true; history.begin("Move keys"); }
      let dx = x - drag.x0, dy = y - drag.y0;
      if (e.shiftKey) [dx, dy] = lockAxis(dx, dy);
      const dBeat = dx / view.pxPerBeat, dValue = -dy / axis.pxPerUnit, refs = drag.refs;
      history.preview((s) => moveKeys(s, refs, dBeat, dValue));
      const earliest = Math.min(...refs.map((r) => r.beat));
      setSel(refs.map((r) => movedKeyRef(r, dBeat, earliest)));
      changed();
    } else if (drag.kind === "box") {
      boxSel.box = { x0: drag.x0, y0: drag.y0, x1: x, y1: y };
      const hits = keysInBox(rows.flatMap((r) => (r.kind === "channel" ? [r.channel] : [])), xToBeat(view, drag.x0), xToBeat(view, x), yToValue(axis, drag.y0), yToValue(axis, y));
      setSel([...drag.base, ...hits.map((hh) => refOf(rows.find((r) => r.kind === "channel" && r.id === hh.channelId)!, hh.beat))]);
      invalidate();
    } else {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag = { ...drag, x: e.clientX, y: e.clientY };
      view = { ...view, startBeat: view.startBeat - dx / view.pxPerBeat };
      axis = panValue(axis, dy);
      invalidate();
    }
  });
  const endDrag = (cancel = false) => {
    const d = drag; drag = null; boxSel.box = null;
    if (d?.kind === "handle" || (d?.kind === "keys" && d.moved)) { if (cancel) { history.cancel(); setSel(d.kind === "keys" ? d.refs : []); changed(); } else { history.commit(); if (d.kind === "keys") notifySel(); } }
    else if (d?.kind === "box") notifySel();
    invalidate();
  };
  canvas.addEventListener("pointerup", () => endDrag());
  canvas.addEventListener("pointercancel", () => endDrag(true));
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const { x, y } = pos(e), f = Math.exp(-e.deltaY * 0.002);
    if (e.shiftKey) axis = zoomValueAt(axis, y, f); else view = zoomAt(view, x, f);
    invalidate();
  }, { passive: false });
  const applyMode = (mode: Tangent["mode"]) => {
    const refs = [...selected.values()];
    if (!refs.length) return;
    history.apply("Tangent mode", (s) => setTangentMode(s, refs, mode));
    changed();
  };
  canvas.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "f") frame(true);
    else if (k === "1") applyMode("auto");
    else if (k === "2") applyMode("aligned");
    else if (k === "3") applyMode("free");
    else if (k === "z" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey ? history.redo() : history.undo()) changed(); }
  });
  const ro = new ResizeObserver(invalidate); ro.observe(host);
  frame(); invalidate();

  return {
    update(s) {
      st = { ...st, ...s };
      if (s.seq && s.seq !== history.seq && !drag) history.seq = s.seq;
      if (s.selection) setSel(s.selection);
      rebuild(); invalidate();
    },
    selection: () => [...selected.values()],
    setTangentMode: applyMode,
    history,
    frame,
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); canvas.remove(); },
  };
}
