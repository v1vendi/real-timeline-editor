import { History, buildPeakMips, defaultProviders, emptySelection, flattenRows, pruneSelection, type Channel, type ExpansionState, type Selection, type Sequence, type Track } from "../src";
import { hitTest, LayeredCanvas, RULER_HEIGHT, attachNavigation, attachScrub, drawBody, drawPlayhead } from "../src/view";
import { clampScrollY } from "../src/view/navigation";
import { mountOutliner } from "../src/view/outliner";
import { attachInteraction } from "../src/view/interaction";
import { createNestedNav } from "../src/view/nestedLane";

// Sample data: a few tracks plus a 200 x 2000 stress fixture (?stress).
const stress = location.search.includes("stress");
const mkChannel = (id: string, n: number, len: number, seed: number): Channel => ({
  id, name: id,
  keys: Array.from({ length: n }, (_, i) => ({ beat: (i / n) * len, value: Math.sin(i * 0.3 + seed) * 50 + 50, interp: i % 3 === 0 ? "linear" : "bezier" as const })),
});
const tracks: Track[] = [
  { id: "fx", name: "Effects", kind: "sections", sections: [
    { id: "s1", start: 2, length: 10, row: 0, label: "Chase", color: "#4a7fd4" },
    { id: "s2", start: 6, length: 12, row: 1, label: "Overlap (lane 1)", color: "#b463c9" },
    { id: "s3", start: 20, length: 16, row: 0, label: "Wash" },
    { id: "n1", start: 38, length: 20, row: 0, label: "Sub (loop x2, 2x speed)", color: "#3c8f6b", offset: 1, scale: 2, ref: { sequenceId: "sub", loop: true } },
    { id: "n2", start: 38, length: 8, row: 1, label: "Sub (trim)", color: "#8f6b3c", offset: 4, ref: { sequenceId: "sub" } },
  ] },
  { id: "drv", name: "Dimmers", kind: "channels", channels: [mkChannel("dim", 40, 60, 0), mkChannel("hue", 24, 60, 2)] },
  { id: "ev", name: "Cues", kind: "events", events: [{ id: "e1", beat: 4, name: "Lights up" }, { id: "e2", beat: 12, name: "Strobe" }, { id: "e3", beat: 20, name: "Fog" }] },
  { id: "aud", name: "Audio", kind: "audio", clips: [{ id: "a1", start: 0, length: 48, offset: 0, peaksId: "song" }] },
];
if (stress) for (let i = 0; i < 200; i++) tracks.push({ id: `t${i}`, name: `T${i}`, kind: "channels", channels: [mkChannel("v", 2000, 60, i)] });
const seq: Sequence = { version: 1, id: "demo", name: "Demo", length: 64, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], tracks, markers: [{ id: "m1", beat: 0, label: "Intro" }, { id: "m2", beat: 16, label: "Verse", color: "#6fd3a0" }, { id: "m3", beat: 32, label: "Chorus", color: "#ff7ab0" }], library: { sub: { version: 1, id: "sub", name: "Sub", length: 8, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {}, tracks: [{ id: "q1", name: "A", kind: "sections", sections: [{ id: "x", start: 0, length: 3, row: 0 }, { id: "y", start: 4, length: 3, row: 0 }] }, { id: "q2", name: "B", kind: "channels", channels: [mkChannel("c", 12, 8, 1)] }, { id: "q3", name: "C", kind: "events", events: [{ id: "ee", beat: 2, name: "e" }] }] } } };

const pcm = Float32Array.from({ length: 44100 * 24 }, (_, i) => Math.sin(i * 0.05) * Math.abs(Math.sin(i / 44100 * Math.PI * 2)) * (0.3 + 0.7 * Math.abs(Math.sin(i / 44100 * 0.9))) * (Math.random() * 0.4 + 0.6));
const peaks = new Map([["song", buildPeakMips(pcm, 44100)]]);
let expansion: ExpansionState = new Set(["drv", ...(stress ? tracks.slice(3, 12).map((t) => t.id) : [])]);
const history = new History(seq, { onChange: () => sync() });
let layout = flattenRows(history.seq, expansion);
let selection: Selection = emptySelection;
const root = document.getElementById("app")!;
root.style.display = "flex";
const side = document.createElement("div");
side.style.cssText = "width:220px;flex:none;height:100%;border-right:1px solid var(--border)";
const app = document.createElement("div");
app.style.cssText = "flex:1;min-width:0;height:100%";
root.append(side, app);
const lc = new LayeredCanvas(app);
let playhead = 4;
const fps = document.createElement("div");
fps.style.cssText = "position:absolute;right:8px;bottom:8px;color:var(--muted);font:11px var(--mono);pointer-events:none";
app.appendChild(fps);

const outliner = mountOutliner(side, {
  headerHeight: RULER_HEIGHT,
  onChange: (next) => { history.apply("Edit track", () => next); },
  onExpansion: (e) => { expansion = e; layout = flattenRows(history.seq, expansion); outliner.update({ expansion }); lc.invalidate("static"); },
}, { seq: history.seq, expansion, scrollY: 0 });

function sync(): void {
  selection = pruneSelection(selection, history.seq);
  layout = flattenRows(history.seq, expansion);
  outliner.update({ seq: history.seq, expansion });
  lc.invalidate("static"); lc.invalidate("overlay");
}
side.addEventListener("wheel", (e) => {
  e.preventDefault();
  const v = lc.getView();
  setView({ ...v, scrollY: clampScrollY(v.scrollY + e.deltaY, layout.totalHeight, 100) });
}, { passive: false });
const setView = (v: ReturnType<typeof lc.getView>) => { lc.setView(v); outliner.update({ scrollY: v.scrollY }); };

// Per-channel value axis matching render.ts drawChannel (auto range of the keys, 5px pad inside the row).
const chanAxis = (channelId?: string) => {
  const row = layout.rows.find((r) => r.kind === "channel" && r.channel.id === channelId);
  if (!row || row.kind !== "channel") return undefined;
  let lo = Infinity, hi = -Infinity;
  for (const k of row.channel.keys) { lo = Math.min(lo, k.value); hi = Math.max(hi, k.value); }
  if (lo === Infinity) { lo = 0; hi = 1; } else if (lo === hi) { lo -= 1; hi += 1; }
  const pad = 5, plotH = row.h - pad * 2;
  return { valueToY: (v: number) => row.y + pad + (1 - (v - lo) / (hi - lo)) * plotH, yToValue: (y: number) => lo + (1 - (y - row.y - pad) / plotH) * (hi - lo) };
};
const ui = attachInteraction(app, {
  curve: () => ({ valueToY: (v, ch) => chanAxis(ch)?.valueToY(v) ?? NaN, yToValue: (y, ch) => chanAxis(ch)?.yToValue(y) ?? NaN }),
  history,
  getLayout: () => layout,
  getView: () => lc.getView(),
  getSelection: () => selection,
  setSelection: (s) => { selection = s; lc.invalidate("overlay"); lc.invalidate("static"); },
  getPlayhead: () => playhead,
  seek: (b) => { playhead = b; lc.invalidate("overlay"); },
  invalidate: (l) => lc.invalidate(l),
  edited: () => { selection = pruneSelection(selection, history.seq); layout = flattenRows(history.seq, expansion); lc.invalidate("static"); },
});
// Nested enter/exit: double-click a subsequence section; breadcrumb bar on top (child view is read-only).
const nav = createNestedNav(() => history.seq);
const crumbs = document.createElement("div");
crumbs.style.cssText = "position:absolute;left:8px;bottom:8px;color:var(--text);background:var(--panel);border:1px solid var(--border-hi);border-radius:5px;padding:3px 8px;display:none;cursor:pointer";
app.appendChild(crumbs);
const childLayout = () => flattenRows(nav.current(), new Set());
const refresh = () => { lc.setView({ ...lc.getView(), startBeat: 0 }); crumbs.style.display = nav.path.length > 1 ? "" : "none"; crumbs.textContent = nav.crumbs().map((c) => c.name).join(" > ") + "  (click: up)"; lc.invalidate("static"); };
crumbs.onclick = () => { nav.up(); refresh(); };
app.addEventListener("dblclick", (e) => {
  const r = app.getBoundingClientRect(), h = hitTest(nav.path.length > 1 ? childLayout() : layout, lc.getView(), e.clientX - r.left, e.clientY - r.top);
  if (h.kind === "section" && h.row.track.kind === "sections") { const sec = h.row.track.sections.find((x: { id: string }) => x.id === h.sectionId); if (sec && nav.enter(sec)) refresh(); }
});
for (const t of ["pointerdown", "keydown"]) app.addEventListener(t, (e) => { if (nav.path.length > 1) e.stopPropagation(); }, true);
lc.drawStatic = (c) => { if (nav.path.length > 1) { drawBody(c, { seq: nav.current(), layout: childLayout() }); return; } drawBody(c, { seq: history.seq, layout, peaks, selected: selection.sections, selectedKeys: selection.keys }); };
lc.drawOverlay = (c) => { drawPlayhead(c, playhead); ui.drawOverlay(c); };

attachScrub(app, () => lc.getView(), { beatsPerBar: 4, providers: [(ctx) => defaultProviders(history.seq, () => playhead).flatMap((p) => p(ctx))] }, (beat) => { playhead = beat; lc.invalidate("overlay"); });
attachNavigation(app, {
  getView: () => lc.getView(),
  setView: (v) => setView({ ...v, startBeat: Math.max(0, v.startBeat) }),
  getSequenceRange: () => ({ start: 0, end: history.seq.length }),
  getSelectionRange: () => null,
  getContentHeight: () => layout.totalHeight + RULER_HEIGHT,
});
(window as unknown as { lc: LayeredCanvas }).lc = lc;
Object.assign(window, { hist: history, getRows: () => layout, getSel: () => selection });

// ?bench: pan+scroll 120 frames, report mean/max paint ms in the readout.
if (location.search.includes("bench")) {
  const ms: number[] = [];
  let i = 0;
  const step = () => {
    lc.setView({ startBeat: i * 0.2, pxPerBeat: 14, scrollY: i * 20 });
    requestAnimationFrame(() => {
      ms.push(lc.lastFrameMs);
      if (++i < 120) step();
      else fps.textContent = `bench mean ${(ms.reduce((a, b) => a + b) / ms.length).toFixed(2)} ms max ${Math.max(...ms).toFixed(2)} ms`;
    });
  };
  step();
}
