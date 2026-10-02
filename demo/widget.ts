// createTimeline demo: the host owns a fake transport clock; the widget only reads it.
import { createTimeline, type Sequence } from "../src";

const seq: Sequence = { version: 1, id: "w", name: "W", length: 32, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [{ id: "m", beat: 8, label: "Drop" }], library: {}, tracks: [
  { id: "fx", name: "Effects", kind: "sections", sections: [{ id: "s1", start: 2, length: 8, row: 0, label: "Chase" }, { id: "s2", start: 12, length: 10, row: 0, label: "Wash" }] },
  { id: "drv", name: "Dimmers", kind: "channels", channels: [{ id: "dim", name: "dim", keys: [{ beat: 0, value: 10, interp: "linear" }, { beat: 8, value: 90, interp: "linear" }, { beat: 16, value: 30, interp: "linear" }] }] },
] };

let beat = 4, playing = false, last = performance.now();
const subs = new Set<(b: number) => void>();
const log = document.getElementById("log")!;
const tl = createTimeline(document.getElementById("app")!, {
  sequence: seq, expanded: ["drv"],
  clock: { getTime: () => beat, subscribe: (cb) => { subs.add(cb); return () => subs.delete(cb); } },
  onSeek: (b) => { beat = b; subs.forEach((f) => f(b)); },
  onPlayToggle: () => document.getElementById("play")!.click(),
  onChange: (_s, i) => { log.textContent = `${i.kind}: ${i.label}`; },
  // Custom painter: a stripe overlay on "Wash" sections.
  renderSection: (ctx, s, r) => { if (s.label !== "Wash") return false; ctx.fillStyle = "#7a3fa0"; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.fillStyle = "#c79bff"; for (let x = r.x; x < r.x + r.w; x += 8) ctx.fillRect(x, r.y + r.h - 6, 4, 6); ctx.fillStyle = "#fff"; ctx.fillText("fx preview", r.x + 5, r.y + 5); return true; },
});
document.getElementById("play")!.onclick = () => { playing = !playing; last = performance.now(); };
document.getElementById("undo")!.onclick = () => tl.undo();
document.getElementById("redo")!.onclick = () => tl.redo();
const tick = (t: number) => { if (playing) { beat += ((t - last) / 1000) * 2; subs.forEach((f) => f(beat)); } last = t; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
(window as unknown as { tl: typeof tl }).tl = tl;
