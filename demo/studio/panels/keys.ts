// Keys panel: live cheat-sheet of every command and its chords (DEFAULT_BINDINGS) plus mouse gestures.
// Rows flash when their chord is pressed. Click a row, press a chord to rebind (ctx.rebind recreates the timeline);
// Esc cancels, Backspace unbinds, Reset restores defaults. Conflicts come from onKeymapWarning.
import { COMMAND_IDS, DEFAULT_BINDINGS, buildKeymap, eventChord } from "../../../src";
import type { KeymapOverrides } from "../../../src";
import type { StudioCtx } from "../../studio";

const DESC: Record<string, string> = {
  delete: "Delete selection", duplicate: "Duplicate", copy: "Copy", cut: "Cut", paste: "Paste at playhead", selectAll: "Select all",
  playToggle: "Play / pause", stepBack: "Step back (grid)", stepForward: "Step forward (grid)", jumpStart: "Jump to start", jumpEnd: "Jump to end",
  split: "Split at playhead", marker: "Add marker", undo: "Undo", redo: "Redo", clear: "Clear selection", addEvent: "Add event key",
  prevMarker: "Previous marker", nextMarker: "Next marker", zoomSelection: "Zoom to selection / all", zoomOut: "Zoom out",
  nudgeLeft: "Nudge left", nudgeRight: "Nudge right", quantize: "Quantize selection", rowPrev: "Select previous row", rowNext: "Select next row", rename: "Rename selected row / section / event / marker / clip (R or F2)", goUp: "Leave child sequence (Esc too, when nothing is selected)",
};
const MOUSE: [string, string][] = [
  ["Wheel", "Scroll rows"], ["Shift+Wheel", "Pan time"], ["Space/middle drag", "Pan"], ["Ctrl+Wheel", "Zoom at cursor"],
  ["Ruler drag", "Scrub playhead"], ["Shift+drag ruler", "Set work range"], ["Shift+click ruler", "Clear work range"],
  ["Drag empty", "Box select"], ["Double-click section / event / marker / name", "Rename (nested section: Alt+dbl-click; plain enters child)"], ["Double-click channel row or key", "Open the curve editor for that channel"], ["Crumb / Up button", "Leave child sequence"],
];

export default function mount({ side, rebind }: StudioCtx): void {
  const mac = /Mac/i.test(navigator.platform);
  const show = (c: string) => c.replace("Mod", mac ? "Cmd" : "Ctrl");
  let overrides: KeymapOverrides = {};
  let km = buildKeymap().map;
  let learning: string | null = null;
  const status = document.createElement("div");
  status.style.cssText = "font-size:11px;margin-top:6px;min-height:14px";
  const refresh = () => {
    for (const [id, r] of rows) {
      const chords = r.lastElementChild as HTMLElement;
      const cur = overrides[id as keyof KeymapOverrides];
      const list = cur === undefined ? DEFAULT_BINDINGS[id as keyof typeof DEFAULT_BINDINGS] : cur === null ? [] : Array.isArray(cur) ? cur : [cur];
      chords.replaceChildren(...list.map(kbd));
      if (!list.length) chords.textContent = "(unbound)";
      r.style.outline = learning === id ? "1px solid var(--warn)" : cur !== undefined ? "1px dashed var(--accent)" : "";
      r.style.cursor = "pointer";
    }
  };
  const apply = () => {
    let msg = "";
    rebind(overrides, (w) => {
      msg = [...w.conflicts.map((c) => `Conflict: ${show(c.chord)} -> ${c.actions.join(", ")}`), ...w.invalid.map((i) => `Invalid: ${i}`)].join("; ");
    });
    km = buildKeymap(overrides).map;
    status.style.color = msg ? "var(--warn)" : "var(--ok)";
    status.textContent = msg || "Applied.";
    refresh();
  };
  const rows = new Map<string, HTMLElement>();
  const kbd = (t: string) => { const k = document.createElement("kbd"); k.textContent = show(t); k.style.marginRight = "3px"; return k; };
  const table = document.createElement("div");
  table.style.cssText = "font-size:12px;max-height:260px;overflow:auto";
  for (const id of COMMAND_IDS) {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:1px 3px;transition:background .4s";
    const chords = document.createElement("span");
    chords.append(...DEFAULT_BINDINGS[id].map(kbd));
    r.append(Object.assign(document.createElement("span"), { textContent: DESC[id] ?? id }), chords);
    r.dataset.cmd = id;
    r.onclick = () => { learning = learning === id ? null : id; status.style.color = ""; status.textContent = learning ? `Press a chord for "${DESC[id] ?? id}" (Esc cancel, Backspace unbind)` : ""; refresh(); };
    rows.set(id, r);
    table.append(r);
  }
  const head = Object.assign(document.createElement("div"), { textContent: "Mouse" });
  head.style.cssText = "font-weight:600;margin-top:8px;font-size:12px";
  const mouse = document.createElement("div");
  mouse.style.cssText = "font-size:12px";
  for (const [g, d] of MOUSE) {
    const r = document.createElement("div");
    r.style.cssText = "display:flex;justify-content:space-between;gap:8px;padding:1px 3px";
    r.append(Object.assign(document.createElement("span"), { textContent: d }), kbd(g));
    mouse.append(r);
  }
  const reset = Object.assign(document.createElement("button"), { textContent: "Reset keys", id: "keys-reset", onclick: () => { overrides = {}; learning = null; apply(); } });
  reset.style.marginTop = "6px";
  const note = document.createElement("div");
  note.append(reset, status);
  const h = Object.assign(document.createElement("h4"), { textContent: "Keys" });
  const sec = document.createElement("section");
  sec.append(h, table, head, mouse, note);
  side.append(sec);

  refresh();
  addEventListener("keydown", (e) => {
    if (learning) {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const id = learning as keyof KeymapOverrides;
      learning = null;
      if (e.key === "Escape") { status.textContent = ""; refresh(); return; }
      overrides = { ...overrides, [id]: e.key === "Backspace" && !e.ctrlKey && !e.metaKey ? null : eventChord(e) };
      apply();
      return;
    }
    const id = km[eventChord(e)];
    const r = id && rows.get(id);
    if (!r) return;
    r.style.background = "rgba(255,200,0,.55)";
    setTimeout(() => { r.style.background = ""; }, 350);
  }, true);
}
