// Embeddable widget: assembles renderer, interaction, navigation, scrub, outliner, history,
// selection and snapping behind one call. DOM-touching: core modules must not import this.
// The host owns the clock; the widget only requests seeks (onSeek) and never plays.
import { colorRowAt, drawColorReadout } from "./colorLane";
import type { Beats, Section } from "../core/model";
import type { GridMode } from "../core/time";
import { defaultProviders } from "../core/snap";
import { History } from "../edit/history";
import { emptySelection, pruneSelection, type Selection } from "../edit/selection";
import { flattenRows, type RowMetrics } from "../core/rows";
import { LayeredCanvas } from "./layers";
import { RULER_HEIGHT, attachScrub } from "./ruler";
import { attachNavigation, frameRange, selectionRange } from "./navigation";
import { attachInteraction, DEFAULT_KEYMAP, type CommandId } from "./interaction";
import { buildKeymap } from "./keymap";
import { drawBody, drawPlayhead } from "./render";
import { mountOutliner, type Outliner } from "./outliner";
import type { PeaksMap } from "./lanesExtra";
import { createNestedNav, drawChildReadout } from "./nestedLane";
import { lazyPeaks, type LazyPeaks } from "../core/peaksLoader";
import { zoomAt, type ViewState } from "./viewState";
import { TIMELINE_CSS } from "./timelineStyle";
import type { Timeline, TimelineOptions } from "./timelineTypes";
import { applyThemeVars, resolveTheme } from "./theme";
import { renderCrumbs } from "./crumbs";
import { timelineApi } from "./timelineApi";
import type { TimelineState } from "./timelineState";
import { attachEditBlock, attachGridChip, makePeakSource } from "./timelineParts";
export * from "./timelineTypes";

export function createTimeline(el: HTMLElement, o: TimelineOptions): Timeline {
  const theme = resolveTheme(o.theme);
  const st: TimelineState = {
    showOutliner: o.outliner !== false, theme, expansion: new Set(o.expanded ?? []), selection: emptySelection,
    readOnly: !!o.readOnly, destroyed: false, metrics: theme.rows, gridMode: o.gridMode ?? "straight",
    workRange: null, peaks: o.peaks, playhead: o.clock.getTime(), layout: flattenRows(o.sequence, new Set(o.expanded ?? []), theme.rows),
  };
  const root = document.createElement("div");
  root.className = "tl-root";
  root.style.cssText = "display:flex;width:100%;height:100%;min-height:0;overflow:hidden";
  applyThemeVars(root, st.theme);
  const outHost = document.createElement("div");
  outHost.style.cssText = `flex:none;width:${o.outlinerWidth ?? 180}px;display:${st.showOutliner ? "block" : "none"}`;
  const canvasHost = document.createElement("div");
  canvasHost.style.cssText = "flex:1;min-width:0;position:relative";
  root.append(outHost, canvasHost);
  el.append(root);

  const nav = createNestedNav(() => history.seq);
  const vs = () => nav.current();
  const inChild = () => nav.path.length > 1;
  const ro = () => st.readOnly || inChild();
  const lazy: LazyPeaks | undefined = o.resolvePeaks && lazyPeaks(o.resolvePeaks, () => { if (!st.destroyed) lc.invalidate("static"); });
  const peakSource: PeaksMap | undefined = lazy ? makePeakSource(() => st.peaks, (id) => lazy.get(id)) : undefined;
  let outliner: Outliner;
  const history = new History(o.sequence, { onChange: (s, info) => o.onChange?.(s, info) });
  const lc = new LayeredCanvas(canvasHost);
  lc.theme = st.theme;
  const relayout = () => { st.layout = flattenRows(vs(), st.expansion, st.metrics); };

  const paintSel = () => { outliner?.update({ selTracks: st.selection.tracks, selChannels: st.selection.channels }); lc.invalidate("overlay"); lc.invalidate("static"); };
  const emitSelect = (s: Selection) => { o.onSelect?.(s); o.onSelectionChange?.(s); };
  const setSel = (s: Selection) => { st.selection = s; emitSelect(s); paintSel(); };
  const syncOutliner = () => { outliner.update({ seq: vs(), expansion: st.expansion, scrollY: lc.getView().scrollY, metrics: st.metrics }); st.layout = outliner.layout(); };
  const edited = () => {
    const pruned = pruneSelection(st.selection, vs());
    if (pruned !== st.selection) { st.selection = pruned; emitSelect(pruned); }
    if (st.showOutliner) syncOutliner(); else relayout();
    lc.invalidate("static");
  };
  outliner = mountOutliner(outHost, {
    headerHeight: RULER_HEIGHT,
    // Outliner edits (rename, flags, nest) go through history so they undo like everything else.
    onChange: (s, label) => { if (ro()) return; history.apply(label ?? "Edit track", () => s); edited(); },
    readOnly: ro,
    onEditorClose: () => canvasHost.focus({ preventScroll: true }),
    onExpansion: (e) => { st.expansion = e; edited(); },
    onSelectRow: (t, c) => { canvasHost.focus({ preventScroll: true }); setSel({ ...emptySelection, tracks: c ? new Set() : new Set([t]), channels: c ? new Set([c]) : new Set() }); },
  }, { seq: vs(), expansion: st.expansion, scrollY: 0, metrics: st.metrics, theme: st.theme });
  st.layout = outliner.layout();

  const setView = (v: ViewState) => {
    const maxY = Math.max(0, st.layout.totalHeight + RULER_HEIGHT - canvasHost.clientHeight);
    lc.setView({ ...v, startBeat: Math.max(0, v.startBeat), scrollY: Math.min(maxY, Math.max(0, v.scrollY)) });
    if (st.showOutliner) outliner.update({ scrollY: lc.getView().scrollY });
  };
  const setPlayhead = (b: Beats) => { if (!st.destroyed && b !== st.playhead) { st.playhead = b; outliner.setPlayhead(b); lc.invalidate("overlay"); } };
  outliner.setPlayhead(st.playhead);
  // Color rows: hovering one shows a readout chip (hex + rgba at the cursor beat) on the overlay.
  let hover: { x: number; y: number } | null = null;
  const onHover = (e: PointerEvent) => {
    const r = canvasHost.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const on = e.buttons === 0 && y > RULER_HEIGHT && !!colorRowAt(st.layout, y - RULER_HEIGHT + lc.getView().scrollY);
    if (on || hover) { hover = on ? { x, y } : null; lc.invalidate("overlay"); }
  };
  const onLeave = () => { if (hover) { hover = null; lc.invalidate("overlay"); } };
  canvasHost.addEventListener("pointermove", onHover); canvasHost.addEventListener("pointerleave", onLeave);

  // Breadcrumb bar (visible inside a child only): Up button, clickable crumbs, read-only notice.
  const crumbEl = document.createElement("div");
  crumbEl.className = "tl-crumbs";
  crumbEl.style.cssText = "position:absolute;left:10px;bottom:10px;display:none;z-index:5";
  canvasHost.append(crumbEl);
  const goUp = (): boolean => { const n = nav.crumbs().length; if (n < 2) return false; goTo(n - 2); return true; };
  const savedViews: ViewState[] = []; // parent view per depth, restored on the way back up
  const afterNav = (restore?: ViewState) => {
    st.selection = emptySelection;
    const cs = nav.crumbs();
    renderCrumbs(crumbEl, cs, { goUp: () => { goUp(); }, goTo, focus: () => canvasHost.focus?.() });
    lc.setView(restore ?? { ...lc.getView(), startBeat: 0, scrollY: 0 });
    edited(); lc.invalidate("overlay");
    o.onNavigate?.(cs);
  };
  const enterChild = (s: Section): boolean => { const d = nav.crumbs().length - 1, v = lc.getView(); if (!nav.enter(s)) return false; savedViews[d] = v; afterNav(); return true; };
  const goTo = (i: number) => { if (i >= 0 && i < nav.crumbs().length - 1) { nav.goTo(i); afterNav(savedViews[i]); } };

  const EDIT_CMDS: CommandId[] = ["undo", "redo", "cut", "paste", "duplicate", "split", "delete", "nudgeLeft", "nudgeRight", "quantize", "rename"];
  let baseMap = o.keymap ?? DEFAULT_KEYMAP;
  if (o.keymapOverrides) {
    const r = buildKeymap(o.keymapOverrides);
    baseMap = r.map;
    if (r.conflicts.length || r.invalid.length) o.onKeymapWarning?.({ conflicts: r.conflicts, invalid: r.invalid });
  }
  const readOnlyMap = Object.fromEntries(Object.entries(baseMap).filter(([, c]) => !EDIT_CMDS.includes(c)));
  const ui = attachInteraction(canvasHost, {
    history, getLayout: () => st.layout, getView: () => lc.getView(),
    getSelection: () => st.selection, setSelection: setSel, readOnly: ro, viewSeq: vs, enterChild, goUp,
    getMetrics: () => st.metrics, renameRow: (t, c) => outliner.rename(t, c),
    zoomSelection: () => { const r = selectionRange(vs(), st.selection) ?? { start: 0, end: vs().length }; setView(frameRange(lc.getView(), r.start, r.end, canvasHost.clientWidth)); },
    zoomOut: () => setView(zoomAt(lc.getView(), canvasHost.clientWidth / 2, 0.5)),
    getGridMode: () => st.gridMode, getPlayhead: () => st.playhead, seek: (b) => o.onSeek?.(b),
    invalidate: (l) => lc.invalidate(l), edited,
    onPlayToggle: o.onPlayToggle, onAddMarker: o.onAddMarker, newId: o.newId,
    pickColor: o.onPickColor ? (t, g, b) => { o.onPickColor!(t, g, b); return true; } : undefined,
    openCurve: o.onOpenCurve ? (t, c) => { o.onOpenCurve!(t, c); return true; } : undefined,
    get keymap() { return ro() ? readOnlyMap : baseMap; },
  });
  lc.drawStatic = (c) => drawBody(c, { seq: vs(), layout: st.layout, peaks: peakSource ?? st.peaks, selected: st.selection.sections, selectedTracks: st.selection.tracks, selectedChannels: st.selection.channels, selectedClips: st.selection.clips, selectedMarkers: st.selection.markers, renderSection: o.renderSection, renderAudio: o.renderAudio, renderKey: o.renderKey, resolveSequence: o.resolveSequence, range: st.workRange, gridMode: st.gridMode, metrics: st.metrics });
  lc.drawOverlay = (c) => { drawPlayhead(c, st.playhead); ui.drawOverlay(c); drawChildReadout(c.ctx, vs(), st.layout, c.view, st.playhead, o.resolveSequence, st.metrics, st.theme);
    const hit = hover && colorRowAt(st.layout, hover.y - RULER_HEIGHT + c.view.scrollY);
    if (hover && hit) drawColorReadout(c.ctx, st.theme, vs(), hit, c.view, hover.x, hover.y, c.width);
  };

  const detach: (() => void)[] = [
    attachScrub(canvasHost, () => lc.getView(), {
      get beatsPerBar() { return vs().beatsPerBar; },
      get gridMode() { return st.gridMode; },
      onRange: (r) => { st.workRange = r; lc.invalidate("static"); o.onWorkRange?.(r); },
      providers: [(ctx) => defaultProviders(vs(), () => st.playhead).flatMap((p) => p(ctx))],
    }, (b) => o.onSeek?.(b)),
    attachNavigation(canvasHost, {
      getView: () => lc.getView(), setView,
      getSequenceRange: () => ({ start: 0, end: vs().length }),
      getSelectionRange: () => selectionRange(vs(), st.selection),
      getContentHeight: () => st.layout.totalHeight + RULER_HEIGHT,
    }),
  ];
  detach.push(attachGridChip(canvasHost, { destroyed: () => st.destroyed, get: () => st.gridMode, set: setGridMode, emit: o.onGridMode }));
  const onOutWheel = (e: WheelEvent) => { const v = lc.getView(); setView({ ...v, scrollY: v.scrollY + e.deltaY }); };
  outHost.addEventListener("wheel", onOutWheel, { passive: true });
  const roStyle = document.createElement("style");
  roStyle.textContent = TIMELINE_CSS;
  root.append(roStyle);
  detach.push(attachEditBlock(outHost, ro));
  outHost.classList.toggle("tl-ro", st.readOnly);

  // Clock: push if the host supports it, otherwise poll once per frame.
  let raf = 0;
  const unsub = o.clock.subscribe?.(setPlayhead);
  if (!unsub) { const poll = () => { setPlayhead(o.clock.getTime()); raf = requestAnimationFrame(poll); }; poll(); }

  const setMetrics = (m: RowMetrics) => { st.metrics = m; edited(); setView(lc.getView()); lc.invalidate("overlay"); };
  function setGridMode(m: GridMode) { st.gridMode = m; lc.invalidate("static"); }
  const refresh = () => { edited(); lc.invalidate("overlay"); };
  const api = timelineApi({ o, st, history, lc, root, outHost, canvasHost, ro, edited, refresh, setView, setMetrics, setGridMode, setPlayhead, paintSel, vs, goTo, getCrumbs: () => nav.crumbs(), lazy, getOutliner: () => outliner, renameSelection: () => ui.renameSelection() });
  return {
    ...api,
    get canUndo() { return history.canUndo; },
    get canRedo() { return history.canRedo; },
    get readOnly() { return st.readOnly; },
    destroy() {
      if (st.destroyed) return;
      st.destroyed = true;
      cancelAnimationFrame(raf); unsub?.();
      detach.forEach((d) => d()); ui.detach(); outliner.destroy();
      outHost.removeEventListener("wheel", onOutWheel); canvasHost.removeEventListener("pointermove", onHover); canvasHost.removeEventListener("pointerleave", onLeave); lc.destroy(); root.remove();
    },
  };
}
