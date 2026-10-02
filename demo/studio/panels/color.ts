// Color timeline panel: edit a whole color group across the sequence. Gradient bar (colorStops), one marker per stop
// (click selects, drag moves, click on the bar adds), embedded picker (native input + alpha slider + hex field) that edits
// the selected stop through setGroupColor. Opened/selected by double-click on a color row (onPickColor -> "studio-pick-color").
// Every edit is one ctx.edit (one undo step); native picker, alpha and hex commit on `change`, a marker drag on release.
import { addColorStop, colorAt, colorStops, findTrack, moveColorStop, parseKeyId, quantize, removeColorStop, setGroupColor, toHex } from "../../../src";
import type { ChannelGroup, Rgba, Sequence } from "../../../src";
import { el, row } from "../dom";
import type { StudioCtx } from "../../studio";

const COLOR_KINDS = ["rgb", "rgba", "hsv", "hue"];
interface Target { trackId: string; group: ChannelGroup }

const stopBeats = (seq: Sequence, t: Target): number[] => {
  const tr = findTrack(seq.tracks, t.trackId);
  if (!tr || tr.kind !== "channels") return [];
  const set = new Set<number>();
  for (const c of tr.channels) if (t.group.channelIds.includes(c.id)) for (const k of c.keys) set.add(k.beat);
  return [...set].sort((a, b) => a - b);
};
const parseHex = (s: string): { r: number; g: number; b: number; a?: number } | undefined => {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, ...(m[2] ? { a: parseInt(m[2], 16) } : {}) };
};

export default function mount(ctx: StudioCtx): void {
  const CHECKER = "conic-gradient(#888 25%,#ccc 0 50%,#888 0 75%,#ccc 0) 0 0/8px 8px";

  let target: Target | undefined;
  let selBeat: number | null = null;

  const groupOfTrack = (seq: Sequence, trackId: string, groupId?: string): Target | undefined => {
    const t = findTrack(seq.tracks, trackId);
    if (!t || t.kind !== "channels") return undefined;
    const group = t.groups?.find((g) => COLOR_KINDS.includes(g.kind ?? "") && (!groupId || g.id === groupId));
    return group && { trackId, group };
  };
  /** Fallback target when nothing was picked: group of the first selected key, else of the first selected track. */
  const fromSelection = (): Target | undefined => {
    const seq = ctx.getSeq(), sel = ctx.tl.getSelection();
    for (const id of sel.keys) { const r = parseKeyId(id), t = findTrack(seq.tracks, r.trackId); const g = t?.kind === "channels" ? t.groups?.find((x) => COLOR_KINDS.includes(x.kind ?? "") && x.channelIds.includes(r.channelId)) : undefined; if (g) return { trackId: r.trackId, group: g }; }
    for (const tid of sel.tracks) { const x = groupOfTrack(seq, tid); if (x) return x; }
    return undefined;
  };

  /** Timeline -> panel: when the key selection changes and contains a key of a color group, select that stop (switching target if needed). */
  let lastSel = "";
  const syncFromTimeline = (): void => {
    const keys = [...ctx.tl.getSelection().keys], sig = keys.join("|");
    if (sig === lastSel) return;
    lastSel = sig;
    const seq = ctx.getSeq();
    const pick = (keys.map((id) => parseKeyId(id)).filter((r) => target && r.trackId === target.trackId && target.group.channelIds.includes(r.channelId))[0]);
    if (pick && target) { selBeat = pick.beat; return; }
    const first = keys[0] ? parseKeyId(keys[0]) : undefined;
    const t = first && findTrack(seq.tracks, first.trackId);
    const g = t && t.kind === "channels" ? t.groups?.find((x) => COLOR_KINDS.includes(x.kind ?? "") && x.channelIds.includes(first.channelId)) : undefined;
    if (first && g) { target = { trackId: first.trackId, group: g }; selBeat = first.beat; }
  };

  // --- UI
  const info = el("div", { id: "color-info" }); info.style.cssText = "font-size:12px;margin:4px 0";
  const bar = el("div", { id: "color-bar" });
  bar.style.cssText = `position:relative;height:30px;margin:14px 6px 18px;border:1px solid var(--border-hi);border-radius:4px;background:${CHECKER};touch-action:none;cursor:copy`;
  const fill = el("div"); fill.style.cssText = "position:absolute;inset:0;border-radius:3px";
  const head = el("div"); head.style.cssText = "position:absolute;top:-4px;bottom:-4px;width:1px;background:var(--accent);pointer-events:none";
  const marks = el("div"); marks.style.cssText = "position:absolute;inset:0;pointer-events:none";
  bar.append(fill, head, marks);

  const picker = el("input", { type: "color", id: "color-picker" });
  const hex = el("input", { type: "text", id: "color-hex", size: 9, placeholder: "#rrggbbaa" });
  hex.style.cssText = "font:12px ui-monospace,monospace;width:92px";
  const alpha = el("input", { type: "range", id: "color-alpha", min: 0, max: 255, step: 1, value: 255 });
  alpha.style.cssText = "width:90px";
  const alphaLbl = el("span", { textContent: "alpha" }); alphaLbl.style.cssText = "font-size:12px";
  const swatch = el("span", { id: "color-swatch" });
  swatch.style.cssText = `display:inline-block;width:28px;height:20px;border:1px solid #888;border-radius:3px;background:${CHECKER};position:relative`;
  const swatchFill = el("span"); swatchFill.style.cssText = "position:absolute;inset:0";
  swatch.append(swatchFill);
  const readout = el("span", { id: "color-readout" }); readout.style.cssText = "font:12px ui-monospace,monospace";

  const edit = (label: string, fn: (s: Sequence) => Sequence) => ctx.edit(label, fn);
  const refFor = (t: Target) => ({ trackId: t.trackId, groupId: t.group.id });

  const current = (): Rgba | undefined => target && selBeat !== null ? colorAt(ctx.getSeq(), target.trackId, target.group.id, selBeat) : undefined;
  const setSelected = (c: Rgba) => {
    if (!target || selBeat === null) return;
    const t = target, b = selBeat;
    edit("Set color", (s) => setGroupColor(s, refFor(t), b, c));
  };
  const apply = (hexStr: string) => {
    const p = parseHex(hexStr), cur = current();
    if (p && cur) setSelected({ r: p.r, g: p.g, b: p.b, a: p.a ?? cur.a });
  };
  // Live preview: the first `input` of a picker session opens ONE undo entry, later inputs replace it (public API only:
  // tl.undo() then tl.edit()), `change` applies the final value into the same entry. So a whole drag is one undo step.
  let session: { alpha: number; opened: boolean } | null = null;
  const live = () => {
    const p = parseHex(picker.value), cur = current();
    if (!p || !cur || !target || selBeat === null) return;
    const t = target, b = selBeat;
    session ??= { alpha: cur.a, opened: false };
    const a = session.alpha;
    if (session.opened) ctx.tl.undo();
    const before = ctx.getSeq();
    edit("Set color", (s) => setGroupColor(s, refFor(t), b, { r: p.r, g: p.g, b: p.b, a }));
    session.opened = ctx.getSeq() !== before || session.opened;
  };
  picker.oninput = live;
  picker.onchange = () => { live(); session = null; refresh(); };
  hex.onchange = () => apply(hex.value);
  alpha.onchange = () => { const cur = current(); if (cur) setSelected({ ...cur, a: Number(alpha.value) }); };

  const addAt = (beat: number) => {
    if (!target) return;
    const t = target, b = quantize(Math.max(0, Math.min(ctx.getSeq().length, beat)));
    edit("Add color stop", (s) => addColorStop(s, refFor(t), b));
    selBeat = b; refresh();
  };
  const addBtn = el("button", { id: "color-add", textContent: "Add stop at playhead", onclick: () => addAt(ctx.getBeat()) });
  const delBtn = el("button", { id: "color-delete", textContent: "Delete stop", onclick: () => {
    if (!target || selBeat === null) return;
    const t = target, b = selBeat;
    edit("Delete color stop", (s) => removeColorStop(s, { ...refFor(t), beat: b }));
    selBeat = null; refresh();
  } });

  // bar: click on empty bar adds a stop there; markers select / drag
  const barBeat = (clientX: number) => { const r = bar.getBoundingClientRect(); return ((clientX - r.left) / r.width) * ctx.getSeq().length; };
  bar.onclick = (e) => { if (e.target === bar || e.target === fill) addAt(barBeat(e.clientX)); };
  const addMark = (b: number, len: number, selected: boolean, css: string) => {
    const m = el("div", { className: "color-stop" });
    m.dataset.beat = String(b);
    m.style.cssText = `position:absolute;left:${(b / len) * 100}%;bottom:-13px;width:12px;height:12px;margin-left:-6px;box-sizing:border-box;border:2px solid ${selected ? "var(--accent)" : "var(--text)"};border-radius:2px 2px 50% 50%;background:${css};pointer-events:auto;cursor:ew-resize;box-shadow:0 0 0 1px var(--bg);z-index:${selected ? 2 : 1}`;
    m.onpointerdown = (e) => {
      e.stopPropagation(); e.preventDefault();
      if (!target) return;
      selBeat = b; refresh();
      const t = target, x0 = e.clientX, w = bar.getBoundingClientRect().width;
      const live = marks.querySelector<HTMLElement>(`[data-beat="${b}"]`) ?? m;
      live.setPointerCapture(e.pointerId);
      let d = 0;
      live.onpointermove = (ev) => { d = ((ev.clientX - x0) / w) * len; live.style.left = `${((Math.max(0, b + d)) / len) * 100}%`; };
      live.onpointerup = () => {
        live.onpointermove = live.onpointerup = null;
        if (Math.abs(d) * (w / len) < 3) { refresh(); return; }
        const before = new Set(stopBeats(ctx.getSeq(), t));
        edit("Move color stop", (s) => moveColorStop(s, { ...refFor(t), beat: b }, d));
        const nb = stopBeats(ctx.getSeq(), t).find((x) => !before.has(x));
        if (nb !== undefined) selBeat = nb;
        refresh();
      };
    };
    return m;
  };

  ctx.side.append(el("section", {}, el("h4", { textContent: "Color" }), info, bar,
    row(picker, hex, alphaLbl, alpha), row(addBtn, delBtn), row(swatch, readout)));
  const section = bar.closest("section")!;

  // double-click on a color row (onPickColor): open the panel, select or add the stop
  document.addEventListener("studio-pick-color", (e) => {
    const { trackId, groupId, beat } = (e as CustomEvent<{ trackId: string; groupId: string; beat: number | null }>).detail;
    const t = groupOfTrack(ctx.getSeq(), trackId, groupId);
    if (!t) return;
    target = t; selBeat = null;
    section.classList.remove("collapsed");
    section.scrollIntoView({ block: "nearest" });
    if (beat !== null) {
      const b = quantize(beat);
      if (stopBeats(ctx.getSeq(), t).includes(b)) { selBeat = b; refresh(); }
      else addAt(b);
    } else refresh();
  });

  function refresh(): void {
    const seq = ctx.getSeq();
    syncFromTimeline();
    if (!target || !groupOfTrack(seq, target.trackId, target.group.id)) target = undefined;
    const t = target ?? fromSelection();
    if (t && t !== target && (!target || target.group.id !== t.group.id || target.trackId !== t.trackId)) { target = t; selBeat = null; }
    const beats = target ? stopBeats(seq, target) : [];
    if (selBeat !== null && !beats.includes(selBeat)) selBeat = null;
    marks.textContent = "";
    const can = !!target, hasSel = selBeat !== null, len = Math.max(seq.length, 1e-6);
    picker.disabled = hex.disabled = !hasSel;
    alpha.disabled = !hasSel || !target || target.group.channelIds.length < 4;
    addBtn.disabled = !can; delBtn.disabled = !hasSel;
    if (!target) {
      info.textContent = "Double-click a color row (or select one) to edit its timeline.";
      fill.style.background = "transparent"; readout.textContent = "-"; swatchFill.style.background = "transparent"; head.style.display = "none";
      return;
    }
    const g = target.group, tr = findTrack(seq.tracks, target.trackId);
    info.textContent = `${tr?.name ?? target.trackId} / ${g.name} (${g.kind}): ${beats.length} stop${beats.length === 1 ? "" : "s"}` + (hasSel ? `, stop @ beat ${selBeat}` : ", click the bar to add one");
    const stops = colorStops(seq, target.trackId, g.id, 0, seq.length);
    fill.style.background = `linear-gradient(to right, ${stops.map((s) => `${s.css} ${(s.beat / len) * 100}%`).join(",")})`;
    head.style.display = ""; head.style.left = `${Math.min(1, ctx.getBeat() / len) * 100}%`;
    for (const b of beats) marks.append(addMark(b, len, b === selBeat, toHexOrCss(colorAt(seq, target.trackId, g.id, b))));
    const c = current();
    if (c) {
      const h = toHex({ ...c, a: 255 });
      if (!session) picker.value = h;
      if (document.activeElement !== hex) hex.value = toHex(c);
      alpha.value = String(Math.round(c.a));
      swatchFill.style.background = toHexOrCss(c); readout.textContent = toHex(c);
    } else { readout.textContent = "-"; swatchFill.style.background = "transparent"; }
  }
  const toHexOrCss = (c: Rgba | undefined) => (c ? toHex(c) : "transparent");
  ctx.onUpdate(refresh);
  refresh();
}
