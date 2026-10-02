// Curve dialog: modal <dialog> hosting mountCurveEditor for the selected channel(s), plus interp/tangent buttons
// and a numeric key inspector. Open: toolbar button, Enter on the timeline, double-click on a channel row, collapsed channels track or key.
import { keyId, parseKeyId, setInterp, setKeys } from "../../../src";
import type { Interp, KeyRef, Sequence, Tangent, Track } from "../../../src";
import { mountCurveEditor, type CurveEditor } from "../../../src/view";
import { el, btn } from "../dom";
import type { StudioCtx } from "../../studio";

export default function mount(ctx: StudioCtx): void {
  const { toolbar, getSeq, edit, getBeat, onUpdate } = ctx;

  const dlg = el("dialog");
  dlg.style.cssText = "width:min(900px,92vw);height:min(600px,86vh);padding:0;border:1px solid var(--border-hi);border-radius:10px;background:var(--panel);color:var(--text);font:13px var(--font)";
  const bar = el("div"); bar.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--border)";
  const host = el("div"); host.style.cssText = "flex:1;min-height:0";
  const insp = el("div"); insp.style.cssText = "display:flex;gap:10px;align-items:center;padding:6px 8px;border-top:1px solid var(--border)";
  const wrap = el("div"); wrap.style.cssText = "display:flex;flex-direction:column;height:100%";
  wrap.append(bar, host, insp);
  dlg.append(wrap);
  document.body.append(dlg);

  let ed: CurveEditor | null = null, sel: KeyRef[] = [], off: (() => void) | null = null;
  const chan = (seq: Sequence, r: KeyRef) => {
    const walk = (ts: readonly Track[]): Track | undefined => { for (const t of ts) { if (t.id === r.trackId) return t; if (t.kind === "folder") { const f = walk(t.children); if (f) return f; } } };
    const t = walk(seq.tracks);
    return t?.kind === "channels" ? t.channels.find((c) => c.id === r.channelId)?.keys.find((k) => Math.abs(k.beat - r.beat) < 1e-6) : undefined;
  };

  const findTrack = (ts: readonly Track[], id: string): Track | undefined => { for (const t of ts) { if (t.id === id) return t; if (t.kind === "folder") { const f = findTrack(t.children, id); if (f) return f; } } };
  const vIn = el("input", { type: "number", step: "0.05" }), bIn = el("input", { type: "number", step: "0.25", min: "0" });
  for (const i of [vIn, bIn]) i.style.width = "80px";
  const info = el("span"); info.style.color = "var(--muted)";
  insp.append(el("label", {}, "Value ", vIn), el("label", {}, "Beat ", bIn), info);
  const refresh = () => {
    const keys = sel.map((r) => chan(getSeq(), r)).filter((k) => !!k);
    const same = (f: (k: NonNullable<typeof keys[number]>) => number) => keys.length && keys.every((k) => f(k!) === f(keys[0]!)) ? String(+f(keys[0]!).toFixed(4)) : "";
    if (document.activeElement !== vIn) vIn.value = same((k) => k.value);
    if (document.activeElement !== bIn) bIn.value = same((k) => k.beat);
    vIn.disabled = bIn.disabled = !keys.length;
    info.textContent = keys.length ? `${keys.length} key${keys.length > 1 ? "s" : ""} selected` : "select keys to edit numerically";
  };
  const apply = (spec: { value?: number; beat?: number }) => {
    if (!sel.length || Number.isNaN(spec.value ?? spec.beat ?? NaN)) return;
    let refs = sel;
    edit("Set keys", (s) => { const r = setKeys(s, sel, spec); refs = r.refs; return r.seq; });
    sel = refs; ed?.update({ seq: getSeq(), selection: refs }); refresh();
  };
  vIn.onchange = () => { if (vIn.value !== "") apply({ value: Number(vIn.value) }); };
  bIn.onchange = () => { if (bIn.value !== "") apply({ beat: Number(bIn.value) }); };

  const interp = (i: Interp) => { if (sel.length) { edit(`Interp ${i}`, (s) => setInterp(s, sel, i)); ed?.update({ seq: getSeq() }); } };
  const tan = (m: Tangent["mode"]) => { ed?.setTangentMode(m); };
  bar.append(el("b", { textContent: "Curves" }), btn("Constant", () => interp("constant")), btn("Linear", () => interp("linear")), btn("Bezier", () => interp("bezier")),
    el("span", { textContent: "|" }), btn("Auto", () => tan("auto")), btn("Aligned", () => tan("aligned")), btn("Free", () => tan("free")),
    btn("Frame", () => ed?.frame(false)), btn("Undo", () => ctx.tl.undo()), btn("Redo", () => ctx.tl.redo()));
  const close = btn("Close", () => dlg.close()); close.style.marginLeft = "auto"; bar.append(close);

  // Channels to show: selected keys' channels, else selected channels, else the channels of selected tracks, else all.
  function pick(): { ids: string[]; keys: KeyRef[] } {
    const s = ctx.tl.getSelection(), seq = getSeq();
    const keys = [...s.keys].map(parseKeyId);
    const ids = new Set(keys.map((k) => k.channelId));
    for (const c of s.channels) ids.add(c);
    const all = (ts: readonly Track[], only?: ReadonlySet<string>, out: string[] = []) => { for (const t of ts) { if (t.kind === "folder") all(t.children, only, out); else if (t.kind === "channels" && (!only || only.has(t.id))) out.push(...t.channels.map((c) => c.id)); } return out; };
    if (!ids.size) for (const c of all(seq.tracks, s.tracks.size ? s.tracks : undefined)) ids.add(c);
    return { ids: [...ids], keys };
  }

  function open(target?: { trackId: string; channelId?: string }) {
    if (dlg.open) return;
    const { ids: picked, keys } = pick();
    let ids = picked;
    if (target) {
      // The double-clicked row wins over the "all channels" fallback; selected keys' channels stay.
      const t = findTrack(getSeq().tracks, target.trackId);
      const add = target.channelId ? [target.channelId] : t?.kind === "channels" ? t.channels.map((c) => c.id) : [];
      ids = [...new Set([...(keys.length ? keys.map((k) => k.channelId) : []), ...add])];
    }
    if (!ids.length) return;
    dlg.showModal();
    sel = keys;
    ed = mountCurveEditor(host, {
      theme: () => ctx.tl.getTheme(),
      onChange: (seq) => edit("Curve edit", () => seq),
      onSelect: (refs) => { sel = refs; refresh(); },
    }, { seq: getSeq(), channelIds: ids, playhead: getBeat(), selection: keys });
    requestAnimationFrame(() => { ed?.frame(false); refresh(); });
    off = onUpdate(() => { ed?.update({ seq: getSeq(), playhead: getBeat() }); refresh(); });
  }
  dlg.addEventListener("close", () => {
    off?.(); off = null;
    const keys = ed?.selection() ?? [];
    ed?.destroy(); ed = null; host.replaceChildren();
    ctx.tl.setSelection({ ...ctx.tl.getSelection(), keys: new Set(keys.map(keyId)) });
    ctx.seek(getBeat());
  });
  // Ctrl+Z inside the dialog drives the shared history, not the editor's private one.
  dlg.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) ctx.tl.redo(); else ctx.tl.undo(); }
  }, true);

  toolbar.append(btn("Curves...", () => open()));
  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && !dlg.open && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName) && !t.isContentEditable && !e.repeat) { e.preventDefault(); open(); }
  });
  // Double-click on a channel row or key (library hook onOpenCurve, relayed by studio.ts); works with no key selected.
  document.addEventListener("studio-open-curve", (e) => open((e as CustomEvent<{ trackId: string; channelId?: string }>).detail));
}
