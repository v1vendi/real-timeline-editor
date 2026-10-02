// Inline rename (behavior.md section 14 `rename`, R or F2): a small DOM input overlay positioned over the
// item. Enter/blur commits ONE history entry, Escape cancels. Targets: rows, sections, events, markers, clips.
import type { Sequence, Track } from "../core/model";
import { renameChannel, renameClip, renameEvent, renameMarker, renameSection, renameTrack } from "../edit/rename";
import { parseEventId, type Selection } from "../edit/selection";
import { lanePitch } from "../core/rows";
import { sectionTrackIds } from "./drag";
import { RULER_HEIGHT } from "./ruler";
import { beatToX } from "./viewState";
import type { InteractionHost } from "./interaction";

export type RenameTarget =
  | { kind: "track"; trackId: string }
  | { kind: "channel"; trackId: string; channelId: string }
  | { kind: "section"; trackId: string; id: string }
  | { kind: "event"; trackId: string; id: string }
  | { kind: "clip"; trackId: string; id: string }
  | { kind: "marker"; id: string };

/** True when the track, or a folder above it, is locked. */
export function isLocked(tracks: Track[], id: string, inherited = false): boolean {
  for (const t of tracks) {
    const lk = inherited || !!t.locked;
    if (t.id === id) return lk;
    if (t.kind === "folder" && find(t.children, id)) return isLocked(t.children, id, lk);
  }
  return false;
}
function find(tracks: Track[], id: string): Track | undefined {
  for (const t of tracks) { if (t.id === id) return t; if (t.kind === "folder") { const r = find(t.children, id); if (r) return r; } }
  return undefined;
}

/** Current name of a target, or undefined when it no longer exists. */
function currentName(seq: Sequence, t: RenameTarget): string | undefined {
  if (t.kind === "marker") return seq.markers.find((m) => m.id === t.id)?.label;
  const tr = find(seq.tracks, t.trackId);
  if (!tr) return undefined;
  if (t.kind === "track") return tr.name;
  if (t.kind === "channel") return tr.kind === "channels" ? tr.channels.find((c) => c.id === t.channelId)?.name : undefined;
  if (t.kind === "section") return tr.kind === "sections" ? tr.sections.find((s) => s.id === t.id)?.label ?? "" : undefined;
  if (t.kind === "event") return tr.kind === "events" ? tr.events.find((e) => e.id === t.id)?.name : undefined;
  return tr.kind === "audio" ? tr.clips.find((c) => c.id === t.id)?.label ?? "" : undefined;
}

export function renameLabel(t: RenameTarget): string {
  return "Rename " + (t.kind === "channel" ? "channel" : t.kind);
}

export function applyRename(seq: Sequence, t: RenameTarget, name: string): Sequence {
  switch (t.kind) {
    case "track": return renameTrack(seq, t.trackId, name);
    case "channel": return renameChannel(seq, t.trackId, t.channelId, name);
    case "section": return renameSection(seq, t.trackId, t.id, name);
    case "event": return renameEvent(seq, t.trackId, t.id, name);
    case "clip": return renameClip(seq, t.trackId, t.id, name);
    case "marker": return renameMarker(seq, t.id, name);
  }
}

/** The single thing R / F2 acts on: selected row, else the one selected section / event / marker / clip. */
export function selectionTarget(seq: Sequence, sel: Selection): RenameTarget | undefined {
  const rows = sel.channels.size + sel.tracks.size;
  if (rows === 1) {
    if (sel.channels.size) {
      const id = [...sel.channels][0]!;
      const walk = (l: Track[]): RenameTarget | undefined => { for (const t of l) { if (t.kind === "channels" && t.channels.some((c) => c.id === id)) return { kind: "channel", trackId: t.id, channelId: id }; if (t.kind === "folder") { const r = walk(t.children); if (r) return r; } } return undefined; };
      return walk(seq.tracks);
    }
    return { kind: "track", trackId: [...sel.tracks][0]! };
  }
  if (rows) return undefined;
  if (sel.sections.size + sel.events.size + sel.markers.size + sel.clips.size !== 1 || sel.keys.size) return undefined;
  if (sel.markers.size) return { kind: "marker", id: [...sel.markers][0]! };
  if (sel.clips.size) { const c = parseEventId([...sel.clips][0]!); return { kind: "clip", trackId: c.trackId, id: c.id }; }
  if (sel.sections.size) { const id = [...sel.sections][0]!, t = sectionTrackIds(seq.tracks).get(id); return t ? { kind: "section", trackId: t, id } : undefined; }
  const e = parseEventId([...sel.events][0]!);
  return { kind: "event", trackId: e.trackId, id: e.id };
}

function shake(el: HTMLElement): void {
  el.animate?.([{ transform: "translateX(0)" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-3px)" }, { transform: "translateX(0)" }], { duration: 220 });
}
export { shake as shakeElement };

/** Themed text input over `host` at a box; resolves via callbacks. Returns a cancel function. */
function openInlineEditor(host: HTMLElement, box: { x: number; y: number; w: number; h: number }, initial: string, done: (name: string | null) => void): HTMLInputElement {
  const x = Math.max(0, Math.min(box.x, host.clientWidth - 60)), w = Math.max(60, Math.min(box.w, host.clientWidth - x - 4));
  box = { ...box, x, w };
  const input = document.createElement("input");
  input.className = "tl-rename";
  input.value = initial;
  input.spellcheck = false;
  input.style.cssText = `position:absolute;z-index:20;box-sizing:border-box;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px;padding:0 6px;font:12px var(--tl-font,system-ui);color:var(--tl-text,#eee);background:var(--tl-popup,#222);border:1px solid var(--tl-accent,#4af);border-radius:var(--tl-radius,3px);outline:none;box-shadow:0 2px 8px rgba(0,0,0,.35)`;
  let finished = false;
  const end = (ok: boolean) => { if (finished) return; finished = true; const v = input.value; input.remove(); done(ok ? v : null); };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); end(true); } else if (e.key === "Escape") { e.preventDefault(); end(false); } };
  for (const t of ["pointerdown", "dblclick", "click", "wheel"]) input.addEventListener(t, (e) => e.stopPropagation());
  input.onblur = () => end(true);
  host.append(input);
  input.focus({ preventScroll: true });
  input.select();
  return input;
}

interface Renamer { start(t: RenameTarget): boolean; startSelection(): boolean }

/** Canvas-side renamer. Rows (outliner) are delegated to `host.renameRow`. */
export function createRenamer(el: HTMLElement, host: InteractionHost, seq: () => Sequence, refresh: () => void): Renamer {
  const box = (t: RenameTarget): { x: number; y: number; w: number; h: number } | undefined => {
    const v = host.getView(), s = seq(), m = host.getMetrics?.();
    if (t.kind === "marker") {
      const mk = s.markers.find((x) => x.id === t.id);
      return mk && { x: beatToX(v, mk.beat), y: 1, w: 120, h: RULER_HEIGHT - 2 };
    }
    const row = host.getLayout().rows.find((r) => r.kind === "track" && r.track.id === t.trackId);
    if (!row || row.kind !== "track") return undefined;
    const top = RULER_HEIGHT + row.y - v.scrollY, tr = row.track;
    if (t.kind === "section" && tr.kind === "sections") {
      const x = tr.sections.find((q) => q.id === t.id);
      if (!x) return undefined;
      const lh = lanePitch(tr, m), x0 = beatToX(v, x.start);
      return { x: x0, y: top + Math.floor(x.row) * lh, w: Math.max(120, beatToX(v, x.start + x.length) - x0), h: lh };
    }
    if (t.kind === "event" && tr.kind === "events") {
      const x = tr.events.find((q) => q.id === t.id);
      return x && { x: beatToX(v, x.beat) - 4, y: top + Math.max(0, (row.h - 24) / 2), w: 130, h: 24 };
    }
    if (t.kind === "clip" && tr.kind === "audio") {
      const x = tr.clips.find((q) => q.id === t.id);
      if (!x) return undefined;
      const x0 = beatToX(v, x.start);
      return { x: x0, y: top, w: Math.max(120, beatToX(v, x.start + x.length) - x0), h: Math.min(row.h, 24) };
    }
    return undefined;
  };

  const start = (t: RenameTarget): boolean => {
    const s = seq(), name = currentName(s, t);
    if (name === undefined) return false;
    const locked = t.kind !== "marker" && isLocked(s.tracks, t.trackId);
    if (host.readOnly?.() || locked) { shake(el); return true; }
    if (t.kind === "track" || t.kind === "channel") return host.renameRow?.(t.trackId, t.kind === "channel" ? t.channelId : undefined) ?? false;
    const b = box(t);
    if (!b) return false;
    openInlineEditor(el, b, name, (v) => {
      if (v !== null) {
        const next = applyRename(seq(), t, v);
        if (next !== seq()) host.history.apply(renameLabel(t), () => next);
      }
      refresh();
      el.focus({ preventScroll: true });
    });
    return true;
  };
  return { start, startSelection: () => { const t = selectionTarget(seq(), host.getSelection()); return t ? start(t) : false; } };
}
