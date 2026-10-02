// Zoom panel: +/- buttons, slider, presets, px/beat + visible range readouts, row-height fit/reset.
import { frameRange, selectionRange, MIN_PX_PER_BEAT, MAX_PX_PER_BEAT, zoomAt } from "../../../src/view";
import { el, row, btn } from "../dom";
import type { StudioCtx } from "../../studio";

export default function mount(ctx: StudioCtx): void {
  const { side, getSeq } = ctx;
  // The canvas is the widest flex child of #tl once the outliner (fixed width) is taken out.
  const width = () => {
    const c = document.querySelector<HTMLElement>("#tl canvas");
    return c?.parentElement?.clientWidth || c?.clientWidth || 800;
  };
  const frame = (a: number, b: number) => ctx.tl.setView(frameRange(ctx.tl.getView(), a, b, width()));
  const bar = () => getSeq().beatsPerBar || 4;
  const bars = (n: number) => frame(Math.max(0, ctx.tl.getView().startBeat), Math.max(0, ctx.tl.getView().startBeat) + n * bar());
  const factor = (f: number) => ctx.tl.setView(zoomAt(ctx.tl.getView(), width() / 2, f));

  const L = Math.log(MAX_PX_PER_BEAT / MIN_PX_PER_BEAT);
  const slider = el("input", { type: "range", min: "0", max: "1000", id: "zoom-slider" });
  slider.style.cssText = "flex:1;min-width:100px";
  slider.oninput = () => {
    const px = MIN_PX_PER_BEAT * Math.exp((Number(slider.value) / 1000) * L);
    const v = ctx.tl.getView();
    ctx.tl.setView(zoomAt(v, width() / 2, px / v.pxPerBeat));
  };
  const read = el("div", { id: "zoom-readout" });
  read.style.cssText = "font:12px ui-monospace,monospace;line-height:1.5";

  const sec = el("section", {}, el("h4", { textContent: "Zoom" }),
    row(btn("-", () => factor(0.5), "zoom-out"), slider, btn("+", () => factor(2), "zoom-in")),
    row(btn("Fit sequence", () => frame(0, getSeq().length)),
      btn("1 bar", () => bars(1)), btn("4 bars", () => bars(4)), btn("16 bars", () => bars(16)),
      btn("Selection", () => { const r = selectionRange(getSeq(), ctx.tl.getSelection()); if (r) frame(r.start, r.end); })),
    row(btn("Fit rows", () => ctx.tl.fitRowHeight()), btn("Reset rows", () => ctx.tl.resetRowHeight())),
    read);
  side.append(sec);

  // The view can change by wheel/scroll without any ctx event: poll cheaply and only touch the DOM on change.
  let key = "";
  const loop = () => {
    const v = ctx.tl.getView(), w = width();
    const k = `${v.startBeat.toFixed(3)}|${v.pxPerBeat.toFixed(3)}|${w}|${v.scrollY}`;
    if (k !== key) {
      key = k;
      const end = v.startBeat + w / v.pxPerBeat, b = bar();
      read.textContent = `${v.pxPerBeat.toFixed(1)} px/beat\nbeats ${v.startBeat.toFixed(2)} - ${end.toFixed(2)} (${((end - v.startBeat) / b).toFixed(1)} bars)\nscrollY ${Math.round(v.scrollY)}px`;
      read.style.whiteSpace = "pre";
      if (document.activeElement !== slider) slider.value = String(Math.round((Math.log(v.pxPerBeat / MIN_PX_PER_BEAT) / L) * 1000));
    }
    requestAnimationFrame(loop);
  };
  loop();
}
