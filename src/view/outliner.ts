// DOM outliner: track tree aligned row-for-row with the canvas (same flattenRows layout, same scrollY).
// Virtualised (only visible rows exist in the DOM). Edits go out as new Sequences via onChange.
import type { Sequence, Track } from "../core/model";
import { nestTrack } from "../edit/commands";
import { applyRename, isLocked, renameLabel, shakeElement, type RenameTarget } from "./rename";
import { applyThemeVars, darkTheme, type Theme } from "./theme";
import { colorGroupOf } from "./colorLane";
import { colorAt, toCss } from "../core/color";
import { flattenRows, toggleExpanded, visibleRowRange, type ExpansionState, type Row, type RowLayout, type RowMetrics } from "../core/rows";

interface OutlinerState { seq: Sequence; expansion: ExpansionState; scrollY: number; metrics?: RowMetrics; selTracks?: ReadonlySet<string>; selChannels?: ReadonlySet<string>; theme?: Theme }
interface OutlinerOptions {
  /** Height of the header strip matching the canvas ruler (RULER_HEIGHT). */
  headerHeight: number;
  /** `label` names the undo entry (e.g. "Rename track"). */
  onChange(seq: Sequence, label?: string): void;
  onExpansion(expansion: ExpansionState): void;
  /** When true the name editor never opens (the row shakes). */
  readOnly?(): boolean;
  /** The name editor closed (committed or canceled): give focus back to the canvas. */
  onEditorClose?(): void;
  /** Row clicked (not a button / toggle): select that track or channel. */
  onSelectRow?(trackId: string, channelId?: string): void;
}
export interface Outliner { /** Recolor the color-group swatches for this playhead beat (no row repaint). */ setPlayhead(beat: number): void; update(s: Partial<OutlinerState>): void; /** Open the inline name editor on a track or channel row; false when the row is not visible. */ rename(trackId: string, channelId?: string): boolean; layout(): RowLayout; destroy(): void }

const SVG = (inner: string) => `<svg class="tl-ic" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICONS: Record<string, string> = {
  sections: SVG('<rect x="1.5" y="3" width="11" height="3.2" rx="1" fill="currentColor" stroke="none"/><rect x="4" y="8" width="8.5" height="3.2" rx="1" fill="currentColor" stroke="none" opacity=".6"/>'),
  channels: SVG('<path d="M1.5 10.5C4 10.5 4.5 3.5 7 3.5s3 7 5.5 7"/><circle cx="7" cy="3.5" r="1.3" fill="currentColor" stroke="none"/>'),
  events: SVG('<circle cx="7" cy="7" r="3.2" fill="currentColor" stroke="none"/><circle cx="7" cy="7" r="5.4" opacity=".4"/>'),
  audio: SVG('<path d="M2 7v0M4.5 4.5v5M7 2.5v9M9.5 4v6M12 6v2"/>'),
  folder: SVG('<path d="M1.5 4.2c0-.7.5-1.2 1.2-1.2h2.6l1.3 1.5h4.7c.7 0 1.2.5 1.2 1.2v4.6c0 .7-.5 1.2-1.2 1.2H2.7c-.7 0-1.2-.5-1.2-1.2z" fill="currentColor" fill-opacity=".25"/>'),
  channel: SVG('<path d="M7 3.2 10.8 7 7 10.8 3.2 7z" fill="currentColor" stroke="none"/>'),
};
const CHEVRON = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 1 5.5 4 2.5 7"/></svg>';

type Flag = "muted" | "solo" | "locked";

/** Set a track flag/name by id. Unlike the lock-honouring edit commands this always applies (needed to unlock). */
function setTrackProps(seq: Sequence, id: string, patch: Partial<Pick<Track, Flag | "name">>): Sequence {
  const go = (list: Track[]): Track[] | null => {
    for (let i = 0; i < list.length; i++) {
      const t = list[i]!;
      const next = t.id === id ? ({ ...t, ...patch } as Track) : t.kind === "folder" && (() => { const c = go(t.children); return c ? { ...t, children: c } : null; })();
      if (next && next !== t) return list.map((x, j) => (j === i ? next : x));
    }
    return null;
  };
  const tracks = go(seq.tracks);
  return tracks ? { ...seq, tracks } : seq;
}

type Drop = { parentId: string | null; index: number; line: "before" | "after" | "into"; targetId: string };

/** Where dragging `dragId` over `row` at fraction `f` (0..1 of row height) would land; null when invalid. */
function dropTarget(seq: Sequence, row: Row, f: number, dragId: string): Drop | null {
  if (row.kind !== "track" || row.id === dragId) return null;
  if (row.track.kind === "folder" && f > 0.25 && f < 0.75) return { parentId: row.id, index: row.track.children.filter((c) => c.id !== dragId).length, line: "into", targetId: row.id };
  const find = (list: Track[], parent: string | null): Drop | null => {
    const i = list.findIndex((t) => t.id === row.id);
    if (i >= 0) {
      const rest = list.filter((t) => t.id !== dragId);
      const at = rest.findIndex((t) => t.id === row.id);
      return { parentId: parent, index: f <= 0.5 ? at : at + 1, line: f <= 0.5 ? "before" : "after", targetId: row.id };
    }
    for (const t of list) if (t.kind === "folder") { const r = find(t.children, t.id); if (r) return r; }
    return null;
  };
  return find(seq.tracks, null);
}

export function mountOutliner(host: HTMLElement, opts: OutlinerOptions, initial: OutlinerState): Outliner {
  let st = initial;
  let layout = flattenRows(st.seq, st.expansion, st.metrics);
  let ph = 0;
  let swatches: { el: HTMLElement; trackId: string; groupId: string }[] = [];
  const tint = (s: { el: HTMLElement; trackId: string; groupId: string }) => {
    const c = colorAt(st.seq, s.trackId, s.groupId, ph), css = c ? toCss(c) : "transparent";
    s.el.style.backgroundImage = `linear-gradient(${css},${css}),conic-gradient(#888 25%,#ccc 0 50%,#888 0 75%,#ccc 0)`;
  };
  let dragId: string | null = null;
  let drop: Drop | null = null;

  host.classList.add("tl-outliner");
  host.style.cssText += ";position:relative;overflow:hidden;user-select:none;font:var(--tl-font-size) var(--tl-font);color:var(--tl-text);background:var(--tl-panel);border-right:1px solid var(--tl-panel-line)";
  applyThemeVars(host, st.theme ?? darkTheme);
  const style = document.createElement("style");
  style.textContent = `.tl-outliner .tl-row{position:absolute;left:0;right:0;display:flex;align-items:center;gap:5px;box-sizing:border-box;border-bottom:1px solid var(--tl-panel-line);padding-right:6px;white-space:nowrap;transition:background .08s}
.tl-outliner .tl-row.a{background:var(--tl-row-a)}.tl-outliner .tl-row.b{background:var(--tl-row-b)}
.tl-outliner .tl-row:hover{background:var(--tl-hover)}
.tl-outliner .tl-row.ch{color:var(--tl-dim)}.tl-outliner .tl-row.muted .tl-name,.tl-outliner .tl-row.muted .tl-ic-w{opacity:.4}
.tl-outliner .tl-name{flex:1;overflow:hidden;text-overflow:ellipsis;font-weight:500}.tl-outliner .tl-row.ch .tl-name{font-weight:400}
.tl-outliner input{flex:1;min-width:0;font:inherit;background:var(--tl-bg);color:inherit;border:1px solid var(--tl-accent);border-radius:3px;padding:1px 4px;outline:none}
.tl-outliner .tl-tw{flex:none;width:14px;height:14px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--tl-dim);border-radius:3px}
.tl-outliner .tl-tw:hover{background:var(--tl-btn);color:var(--tl-text)}
.tl-outliner .tl-tw svg{transition:transform .1s}.tl-outliner .tl-tw.open svg{transform:rotate(90deg)}
.tl-outliner .tl-sw{flex:none;width:12px;height:12px;border-radius:3px;border:1px solid var(--tl-btn-border);background-size:auto,6px 6px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.18)}
.tl-outliner .tl-ic{flex:none;width:14px;height:14px;display:block}
.tl-outliner .tl-bs{display:flex;gap:2px;flex:none;opacity:.55;transition:opacity .1s}.tl-outliner .tl-row:hover .tl-bs,.tl-outliner .tl-row.sel .tl-bs,.tl-outliner .tl-bs.any{opacity:1}
.tl-outliner .tl-b{width:17px;height:17px;padding:0;font:700 9.5px var(--tl-font);border:1px solid var(--tl-btn-border);border-radius:var(--tl-radius);background:var(--tl-btn);color:var(--tl-dim);cursor:pointer;line-height:1}
.tl-outliner .tl-b:hover{color:var(--tl-text);border-color:var(--tl-dim)}
.tl-outliner .tl-b.on{color:#fff;border-color:transparent;box-shadow:inset 0 1px 0 rgba(255,255,255,.22)}
.tl-outliner .tl-b.m.on{background:var(--tl-mute)}.tl-outliner .tl-b.s.on{background:var(--tl-solo)}.tl-outliner .tl-b.l.on{background:var(--tl-lock)}
.tl-outliner .tl-row.sel{background:var(--tl-sel);box-shadow:inset 3px 0 var(--tl-accent);color:var(--tl-text)}
.tl-outliner .tl-row.into{background:var(--tl-sel);outline:1px dashed var(--tl-accent);outline-offset:-2px}.tl-outliner .tl-row.before{box-shadow:inset 0 2px var(--tl-accent)}.tl-outliner .tl-row.after{box-shadow:inset 0 -2px var(--tl-accent)}
.tl-outliner .tl-head{display:flex;align-items:flex-end;padding:0 10px 7px;font:600 10px var(--tl-font);letter-spacing:.09em;text-transform:uppercase;color:var(--tl-ruler-text);background:var(--tl-ruler);border-bottom:1px solid var(--tl-ruler-line)}`;
  const head = document.createElement("div");
  head.className = "tl-head";
  head.style.cssText = `height:${opts.headerHeight}px;box-sizing:border-box`;
  head.textContent = "Tracks";
  const body = document.createElement("div");
  body.style.cssText = `position:absolute;left:0;right:0;top:${opts.headerHeight}px;bottom:0;overflow:hidden`;
  const inner = document.createElement("div");
  inner.style.cssText = "position:absolute;left:0;right:0;top:0;will-change:transform";
  body.append(inner);
  host.append(style, head, body);

  const flag = (r: Row, f: Flag, ch: string, cls: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = `tl-b ${cls}${r.track[f] ? " on" : ""}`;
    b.textContent = ch;
    b.title = f === "muted" ? "Mute" : f === "solo" ? "Solo" : "Lock";
    b.onclick = (e) => { e.stopPropagation(); opts.onChange(setTrackProps(st.seq, r.track.id, { [f]: !r.track[f] })); };
    return b;
  };

  const rename = (r: Row, span: HTMLElement): void => {
    const t: RenameTarget = r.kind === "channel" ? { kind: "channel", trackId: r.track.id, channelId: r.channel.id } : { kind: "track", trackId: r.track.id };
    if (opts.readOnly?.() || isLocked(st.seq.tracks, r.track.id)) { shakeElement(span); return; }
    const input = document.createElement("input");
    input.value = r.kind === "channel" ? r.channel.name : r.track.name;
    let done = false;
    const end = (ok: boolean) => { if (done) return; done = true; const next = ok ? applyRename(st.seq, t, input.value) : st.seq; if (next !== st.seq) opts.onChange(next, renameLabel(t)); paint(); opts.onEditorClose?.(); };
    input.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") end(true); else if (e.key === "Escape") end(false); };
    input.onblur = () => end(true);
    span.replaceWith(input);
    input.focus();
    input.select();
  };

  let lastClick: { id: string; t: number } | null = null;

  function paint(): void {
    inner.style.transform = `translateY(${-st.scrollY}px)`;
    inner.replaceChildren();
    swatches = [];
    const [a, b] = visibleRowRange(layout, st.scrollY, st.scrollY + body.clientHeight);
    for (let i = a; i < b; i++) {
      const r = layout.rows[i]!;
      const el = document.createElement("div");
      el.className = "tl-row " + (i % 2 ? "b" : "a") + (r.kind === "channel" ? " ch" : "") + (r.track.muted ? " muted" : "") + (drop?.targetId === r.id ? ` ${drop.line}` : "") + ((r.kind === "channel" ? st.selChannels?.has(r.channel.id) : st.selTracks?.has(r.track.id)) ? " sel" : "");
      el.onclick = (e) => {
        if ((e.target as Element).closest(".tl-b,.tl-tw,input")) return;
        // Selecting repaints the rows, which swallows the browser's dblclick: detect the second click on the name here.
        const prev = lastClick, cid = r.kind === "channel" ? r.channel.id : undefined;
        const twice = !!prev && prev.id === r.id && e.timeStamp - prev.t < 450 && !!(e.target as Element).closest(".tl-name");
        lastClick = twice ? null : { id: r.id, t: e.timeStamp };
        opts.onSelectRow?.(r.track.id, cid);
        if (twice) api.rename(r.track.id, cid);
      };
      el.style.cssText = `top:${r.y}px;height:${r.h}px;padding-left:${6 + r.depth * 14}px`;
      const tw = document.createElement("span");
      tw.className = "tl-tw" + (r.expanded ? " open" : "");
      if (r.expandable) tw.innerHTML = CHEVRON;
      if (r.expandable) tw.onclick = () => opts.onExpansion(toggleExpanded(st.expansion, r.id));
      const name = document.createElement("span");
      name.className = "tl-name";
      name.textContent = r.kind === "channel" ? r.channel.name : r.track.name;
      const icon = document.createElement("span");
      const kind = r.kind === "channel" ? "channel" : r.track.kind;
      icon.innerHTML = ICONS[kind] ?? "";
      icon.style.cssText = `display:flex;color:var(--tl-k-${r.kind === "channel" ? "channels" : r.track.kind},var(--tl-dim))`;
      if (r.kind === "channel") icon.style.opacity = ".75";
      icon.className = "tl-ic-w";
      el.append(tw, icon, name);
      const cg = r.kind === "track" ? colorGroupOf(r.track) : undefined;
      if (cg) {
        const sw = document.createElement("span");
        sw.className = "tl-sw"; sw.title = `${cg.name} at playhead`;
        const s = { el: sw, trackId: r.track.id, groupId: cg.id };
        swatches.push(s); tint(s); el.append(sw);
      }
      if (r.kind === "track") {
        const bs = document.createElement("span");
        bs.className = "tl-bs" + (r.track.muted || r.track.solo || r.track.locked ? " any" : "");
        bs.append(flag(r, "muted", "M", "m"), flag(r, "solo", "S", "s"), flag(r, "locked", "L", "l"));
        el.append(bs);
        el.draggable = !r.track.locked;
        el.ondragstart = (e) => { dragId = r.id; e.dataTransfer?.setData("text/plain", r.id); };
        el.ondragend = () => { dragId = null; drop = null; paint(); };
        el.ondragover = (e) => {
          if (!dragId) return;
          const box = el.getBoundingClientRect();
          const d = dropTarget(st.seq, r, (e.clientY - box.top) / box.height, dragId);
          if (d) e.preventDefault();
          if (d?.targetId !== drop?.targetId || d?.line !== drop?.line) { drop = d; paint(); }
        };
        el.ondrop = (e) => {
          e.preventDefault();
          const d = drop;
          const id = dragId;
          dragId = null; drop = null;
          if (d && id) opts.onChange(nestTrack(st.seq, id, d.parentId, d.index));
          else paint();
        };
      }
      inner.append(el);
    }
  }

  paint();

  const api: Outliner = {
    setPlayhead(beat) { if (beat === ph) return; ph = beat; for (const s of swatches) tint(s); },
    update(s) {
      st = { ...st, ...s };
      if (s.theme) applyThemeVars(host, s.theme);
      if (s.seq || s.expansion || s.metrics) layout = flattenRows(st.seq, st.expansion, st.metrics);
      if (!document.activeElement || !host.contains(document.activeElement) || document.activeElement.tagName !== "INPUT") paint();
    },
    layout: () => layout,
    rename(trackId, channelId) {
      const i = layout.rows.findIndex((r) => (channelId ? r.kind === "channel" && r.channel.id === channelId : r.kind === "track" && r.track.id === trackId));
      if (i < 0) return false;
      paint();
      const span = inner.children[i - visibleRowRange(layout, st.scrollY, st.scrollY + body.clientHeight)[0]]?.querySelector<HTMLElement>(".tl-name");
      if (!span) return false;
      rename(layout.rows[i]!, span);
      return true;
    },
    destroy() { host.replaceChildren(); },
  };
  return api;
}
