// Timeline handle methods, grouped by concern. Shared mutable state arrives as one explicit
// `st` object plus the few closures they need; nothing here sits on a paint path.
import type { Beats, Sequence } from "../core/model";
import type { GridMode } from "../core/time";
import { expandableIds, flattenRows, type RowMetrics } from "../core/rows";
import { clamp } from "../core/math";
import type { History } from "../edit/history";
import { pruneSelection, type Selection } from "../edit/selection";
import type { LayeredCanvas } from "./layers";
import type { Outliner } from "./outliner";
import type { LazyPeaks } from "../core/peaksLoader";
import type { PeaksMap } from "./lanesExtra";
import { RULER_HEIGHT } from "./ruler";
import { applyThemeVars, resolveTheme, type ThemeInput } from "./theme";
import type { Timeline, TimelineOptions } from "./timelineTypes";
import type { TimelineState } from "./timelineState";
import type { ViewState } from "./viewState";

export interface ApiCtx {
  o: TimelineOptions; st: TimelineState; history: History; lc: LayeredCanvas;
  root: HTMLElement; outHost: HTMLElement; canvasHost: HTMLElement;
  ro: () => boolean; edited: () => void; refresh: () => void;
  setView: (v: ViewState) => void; setMetrics: (m: RowMetrics) => void; setGridMode: (m: GridMode) => void;
  setPlayhead: (b: Beats) => void; paintSel: () => void; vs: () => Sequence; goTo: (i: number) => void; getCrumbs: Timeline["getCrumbs"]; lazy: LazyPeaks | undefined;
  getOutliner: () => Outliner; renameSelection: () => boolean;
}

type Live = <F extends (...a: never[]) => void>(f: F) => F;
type Methods = Omit<Timeline, "canUndo" | "canRedo" | "readOnly" | "destroy">;

export function timelineApi(c: ApiCtx): Methods {
  const live: Live = (f) => ((...a: never[]) => { if (!c.st.destroyed) f(...a); }) as typeof f;
  return { ...historyApi(c, live), ...selectionApi(c, live), ...viewApi(c, live), ...themeApi(c, live), ...peaksApi(c, live) };
}

function historyApi({ history, ro, refresh }: ApiCtx, live: Live) {
  return {
    getSequence: () => history.seq,
    setSequence: live((seq: Sequence) => { history.seq = seq; history.past = []; history.future = []; refresh(); }),
    edit: live((label: string, fn: (seq: Sequence) => Sequence) => { if (!ro()) { history.apply(label, fn); refresh(); } }),
    undo: live(() => { if (!ro()) { history.undo(); refresh(); } }),
    redo: live(() => { if (!ro()) { history.redo(); refresh(); } }),
  };
}

function selectionApi(c: ApiCtx, live: Live) {
  const { st, history, ro, paintSel, outHost, renameSelection } = c;
  return {
    getSelection: () => st.selection,
    renameSelection: () => !st.destroyed && !ro() && renameSelection(),
    setSelection: live((sel: Selection) => { st.selection = pruneSelection(sel, history.seq); paintSel(); }),
    setReadOnly: live((on: boolean) => { st.readOnly = !!on; outHost.classList.toggle("tl-ro", st.readOnly); }),
  };
}

function viewApi(c: ApiCtx, live: Live) {
  const { o, st, lc, outHost, canvasHost, edited, setView, setMetrics, setGridMode, setPlayhead, vs, goTo, getCrumbs } = c;
  return {
    getCrumbs,
    goTo: live(goTo),
    getWorkRange: () => st.workRange,
    setWorkRange: live((r: { start: Beats; end: Beats; loop?: boolean } | null) => { st.workRange = r; lc.invalidate("static"); }),
    foldAll: live((fold = true) => {
      st.expansion = fold ? new Set() : new Set(expandableIds(vs().tracks));
      edited();
      setView(lc.getView());
    }),
    getExpanded: () => [...st.expansion],
    setExpanded: live((ids: Iterable<string>) => { st.expansion = new Set(ids); edited(); setView(lc.getView()); }),
    setOutliner: live((on: boolean) => {
      st.showOutliner = !!on; outHost.style.display = st.showOutliner ? "block" : "none";
      edited(); setView(lc.getView());
    }),
    fitRowHeight: live(() => {
      const base = flattenRows(vs(), st.expansion, st.theme.rows).totalHeight;
      const avail = canvasHost.clientHeight - RULER_HEIGHT;
      if (!(base > 0) || !(avail > 0)) return;
      const k = avail / base;
      setMetrics({ trackH: clamp(Math.round(st.theme.rows.trackH * k), 14, 96), channelH: clamp(Math.round(st.theme.rows.channelH * k), 10, 80) });
    }),
    resetRowHeight: live(() => setMetrics(st.theme.rows)),
    getGridMode: () => st.gridMode,
    setGridMode: live(setGridMode),
    getView: () => lc.getView(),
    setView: live(setView),
    redraw: live(() => { setPlayhead(o.clock.getTime()); lc.invalidate("static"); lc.invalidate("overlay"); }),
  };
}

function themeApi(c: ApiCtx, live: Live) {
  const { st, lc, root, setMetrics, getOutliner } = c;
  return {
    getTheme: () => st.theme,
    setTheme: live((t: ThemeInput) => {
      const was = st.theme;
      st.theme = resolveTheme(t);
      applyThemeVars(root, st.theme); lc.setTheme(st.theme);
      getOutliner().update({ theme: st.theme });
      if (st.metrics === was.rows) setMetrics(st.theme.rows);
    }),
  };
}

function peaksApi({ st, lc, lazy }: ApiCtx, live: Live) {
  return {
    setPeaks: live((p: PeaksMap | undefined) => { st.peaks = p; lc.invalidate("static"); }),
    reloadPeaks: live((id?: string) => { lazy?.reset(id); lc.invalidate("static"); }),
  };
}
