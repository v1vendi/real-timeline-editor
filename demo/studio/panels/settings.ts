// Settings panel: undo/redo, grid, read-only, outliner, fold/fit, zoom, fake transport, tempo/length, JSON io.
import { parseSequence, serializeSequence } from "../../../src";
import { frameRange, selectionRange } from "../../../src/view";
import type { GridMode } from "../../../src";
import { el, row, btn } from "../dom";
import type { StudioCtx } from "../../studio";

export default function mount(ctx: StudioCtx): void {
  const { toolbar, side, getSeq, edit, setSeq, getBeat, seek, onUpdate } = ctx;
  const num = (value: number, min: number, step: number, onchange: (v: number) => void) => {
    const i = el("input", { type: "number", value: String(value), min: String(min), step: String(step) });
    i.style.width = "64px"; i.onchange = () => { const v = Number(i.value); if (v >= min) onchange(v); };
    return i;
  };

  // Toolbar: history + transport
  const undo = btn("Undo", () => ctx.tl.undo()), redo = btn("Redo", () => ctx.tl.redo());
  let playing = false, last = 0, raf = 0;
  const bpm = () => getSeq().tempo[0]?.bpm ?? 120;
  const tick = (t: number) => {
    if (!playing) return;
    const end = getSeq().length;
    const next = getBeat() + ((t - last) / 1000) * (bpm() / 60);
    last = t;
    seek(next >= end ? 0 : next);
    raf = requestAnimationFrame(tick);
  };
  const play = btn("Play", () => {
    playing = !playing; play.textContent = playing ? "Pause" : "Play";
    if (playing) { last = performance.now(); raf = requestAnimationFrame(tick); } else cancelAnimationFrame(raf);
  }, "studio-play");
  const clock = el("span"); clock.style.cssText = "font:12px ui-monospace,monospace;min-width:150px";
  toolbar.append(undo, redo, play, clock);

  // Segmented control: one button per option, `.on` marks the current one.
  const seg = <T extends string>(opts: readonly T[], onpick: (v: T) => void) => {
    const box = el("div", { className: "seg" });
    const set = (v: string) => box.childNodes.forEach((n) => (n as HTMLElement).classList.toggle("on", (n as HTMLElement).dataset.v === v));
    for (const o of opts) { const b = el("button", { textContent: o, onclick: () => { set(o); onpick(o); } }); b.dataset.v = o; box.append(b); }
    return { box, set };
  };

  // Side: settings
  const gridSeg = seg(["straight", "triplet", "dotted"] as GridMode[], (m) => ctx.tl.setGridMode(m));
  gridSeg.set("straight");
  const applyTheme = (t: "dark" | "light") => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("tl-theme", t); } catch { /* storage unavailable */ }
    ctx.tl.setTheme({ base: t });
  };
  const themeSeg = seg(["dark", "light"] as const, applyTheme);
  themeSeg.set(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const ro = el("input", { type: "checkbox", onchange: () => ctx.tl.setReadOnly(ro.checked) });
  const outl = el("input", { type: "checkbox", checked: true });
  outl.onchange = () => ctx.tl.setOutliner(outl.checked);
  const tempo = num(bpm(), 1, 1, (v) => edit("Set tempo", (s) => ({ ...s, tempo: [{ ...(s.tempo[0] ?? { beat: 0 }), beat: 0, bpm: v }, ...s.tempo.slice(1)] })));
  const length = num(getSeq().length, 1, 1, (v) => edit("Set length", (s) => ({ ...s, length: v })));
  const json = el("textarea", { rows: 8, spellcheck: false }); json.style.cssText = "width:100%;box-sizing:border-box;font:11px ui-monospace,monospace";
  const err = el("div"); err.style.cssText = "color:var(--err);white-space:pre-wrap";
  const width = () => document.getElementById("tl")!.clientWidth - (outl.checked ? 180 : 0);
  const zoom = (a: number, b: number) => ctx.tl.setView(frameRange(ctx.tl.getView(), a, b, width()));

  side.append(el("section", {},
    el("h4", { textContent: "Settings" }),
    row(el("label", {}, "Theme"), themeSeg.box, el("label", {}, "Grid"), gridSeg.box),
    row(el("label", {}, ro, " read-only"), el("label", {}, outl, " outliner")),
    row(btn("Fold all", () => ctx.tl.foldAll(true)), btn("Unfold", () => ctx.tl.foldAll(false)), btn("Fit rows", () => ctx.tl.fitRowHeight()), btn("Reset rows", () => ctx.tl.resetRowHeight())),
    row(btn("Zoom to selection", () => { const r = selectionRange(getSeq(), ctx.tl.getSelection()); if (r) zoom(r.start, r.end); }), btn("Fit sequence", () => zoom(0, getSeq().length))),
    row(el("label", {}, "Tempo ", tempo, " bpm"), el("label", {}, "Length ", length, " beats")),
    row(btn("Export JSON", () => { json.value = serializeSequence(getSeq(), 2); err.textContent = ""; }),
      btn("Import JSON", () => { try { setSeq(parseSequence(json.value)); err.textContent = ""; } catch (e) { err.textContent = String(e instanceof Error ? e.message : e); } })),
    json, err,
  ));

  ctx.onRebind(() => { ctx.tl.setOutliner(outl.checked); ro.checked = ctx.tl.readOnly; gridSeg.set(ctx.tl.getGridMode()); });

  onUpdate(() => {
    undo.disabled = !ctx.tl.canUndo; redo.disabled = !ctx.tl.canRedo;
    tempo.value = String(bpm()); length.value = String(getSeq().length);
    clock.textContent = `beat ${getBeat().toFixed(2)} / ${getSeq().length}`;
  });
  undo.disabled = redo.disabled = true; clock.textContent = `beat ${getBeat().toFixed(2)} / ${getSeq().length}`;
}
