// Nested (subsequence) sections: mini summary of the child's tracks drawn inside the parent
// section rect, plus a minimal enter-child breadcrumb state. Time math from ../nested.
import { childToParent, parentToChild, resolveSequence, type SequenceResolver } from "../core/nested";
import type { Section, Sequence, Track } from "../core/model";
import { lanePitch, type RowLayout, type RowMetrics } from "../core/rows";
import { RULER_HEIGHT } from "./ruler";
import { beatToX, type ViewState } from "./viewState";
import { darkTheme, type Theme } from "./theme";
import { clipRect, fillRound } from "./paint";

const MAX_TRACKS = 6;
const MAX_REPEATS = 64;

function flat(tracks: readonly Track[], out: Track[] = []): Track[] {
  for (const t of tracks) { if (t.kind === "folder") flat(t.children, out); else out.push(t); }
  return out;
}

/** Longest content span of a sequence (its `length`, else the last thing in it). */
function childLength(seq: Sequence): number {
  return seq.length > 0 ? seq.length : 1;
}

/**
 * Draw the mini summary for a section with `ref` inside rect (canvas px). One thin band per child track
 * (first few), marks placed by child time -> parent beat -> px, honouring offset, scale and loop
 * (repeated copies with a divider). Returns false when the ref is missing/dangling (caller may skip).
 */
export function drawNestedSection(
  ctx: CanvasRenderingContext2D, root: Sequence, s: Section,
  rect: { x: number; y: number; w: number; h: number }, pxPerBeat: number, host?: SequenceResolver, th: Theme = darkTheme,
): boolean {
  if (!s.ref) return false;
  const child = resolveSequence(root, s.ref.sequenceId, host);
  if (!child) {
    ctx.fillStyle = th.color.playheadGlow; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    return false;
  }
  const len = childLength(child), k = s.scale ?? 1;
  if (k === 0) return true;
  const tracks = flat(child.tracks).slice(0, MAX_TRACKS);
  if (!tracks.length) return true;
  const { x, y, w, h } = rect;
  clipRect(ctx, x, y, w, h);
  const bandH = Math.max(2, Math.min(8, (h - 14) / tracks.length));
  const y0 = y + h - 2 - bandH * tracks.length;
  // Child time -> px. Beat in parent of child time c, for repeat n.
  const xOf = (c: number, n: number): number | null => {
    const tb = childToParent(s, c + n * len);
    return tb === null ? null : x + (tb - s.start) * pxPerBeat;
  };
  // Repeat range: c in [0,len) repeats; without loop only the trimmed window [offset, offset+span*scale] shows.
  const span = s.length * Math.abs(k);
  const off = s.offset ?? 0;
  const n0 = s.ref.loop ? Math.floor(-off / len) : 0;
  const n1 = s.ref.loop ? Math.min(n0 + MAX_REPEATS, Math.ceil((off + span) / len)) : 0;
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  tracks.forEach((t, i) => {
    const by = y0 + i * bandH;
    ctx.fillStyle = th.color.shade; ctx.globalAlpha = 0.7; ctx.fillRect(x, by, w, bandH - 1); ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    for (let n = n0; n <= n1; n++) {
      const put = (c0: number, c1: number) => {
        const a = xOf(c0, n), b = xOf(c1, n);
        if (a === null || b === null) return;
        const l = Math.min(a, b), r = Math.max(a, b);
        if (r < x || l > x + w) return;
        ctx.fillRect(l, by, Math.max(1.5, r - l), bandH - 1);
      };
      if (t.kind === "sections") for (const c of t.sections) put(c.start, c.start + c.length);
      else if (t.kind === "audio") for (const c of t.clips) put(c.start, c.start + c.length);
      else if (t.kind === "events") for (const e of t.events) put(e.beat, e.beat);
      else if (t.kind === "channels") for (const ch of t.channels) for (const key of ch.keys) put(key.beat, key.beat);
    }
  });
  if (s.ref.loop) { // divider at each wrap
    ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.beginPath();
    for (let n = n0; n <= n1; n++) { const px = xOf(0, n); if (px !== null && px > x + 1 && px < x + w) { ctx.moveTo(Math.round(px) + 0.5, y); ctx.lineTo(Math.round(px) + 0.5, y + h); } }
    ctx.stroke();
  }
  ctx.restore();
  return true;
}

/** Child-space time at parent beat `t` for a nested section (for an optional child-space readout). */
function childTimeAt(root: Sequence, s: Section, t: number, host?: SequenceResolver): number | null {
  const child = s.ref && resolveSequence(root, s.ref.sequenceId, host);
  return child ? parentToChild(s, t, childLength(child)) : null;
}

/** Breadcrumb state: a stack of sequence ids from the root down to the sequence being viewed. */
interface NestedNav {
  /** Ids from root to current. */
  readonly path: readonly string[];
  /** Sequence being viewed (root when empty path). */
  current(): Sequence;
  /** Labels for the breadcrumb bar (root first). */
  crumbs(): { id: string; name: string }[];
  /** Enter the child referenced by `section` (no-op, false, when it has no resolvable ref). */
  enter(section: Section): boolean;
  /** Go up one level (false at root). */
  up(): boolean;
  /** Jump to breadcrumb depth `i` (0 = root). */
  goTo(i: number): void;
}

export function createNestedNav(root: () => Sequence): NestedNav {
  let path: string[] = [];
  const cur = (): Sequence => {
    const r = root();
    let s = r;
    for (const id of path) s = resolveSequence(r, id) ?? s;
    return s;
  };
  return {
    get path() { return [root().id, ...path]; },
    current: cur,
    crumbs() { const r = root(); return [r, ...path.map((id) => resolveSequence(r, id)).filter((x): x is Sequence => !!x)].map((q) => ({ id: q.id, name: q.name })); },
    enter(section) {
      const id = section.ref?.sequenceId;
      if (!id || !resolveSequence(root(), id)) return false;
      path = [...path, id]; return true;
    },
    up() { if (!path.length) return false; path = path.slice(0, -1); return true; },
    goTo(i) { path = path.slice(0, Math.max(0, i)); },
  };
}

/** Overlay readout: for each nested section under the playhead, print the playhead in the child's own time. */
export function drawChildReadout(
  ctx: CanvasRenderingContext2D, root: Sequence, layout: RowLayout, view: ViewState, playhead: number, host?: SequenceResolver, metrics?: RowMetrics, th: Theme = darkTheme,
): void {
  ctx.save(); ctx.font = "10px system-ui, sans-serif"; ctx.textBaseline = "top";
  for (const row of layout.rows) {
    if (row.kind !== "track" || row.track.kind !== "sections") continue;
    const pitch = lanePitch(row.track, metrics);
    for (const s of row.track.sections) {
      if (!s.ref || playhead < s.start || playhead > s.start + s.length) continue;
      const c = childTimeAt(root, s, playhead, host);
      if (c === null) continue;
      const txt = `child ${c.toFixed(2)}`, w = ctx.measureText(txt).width + 8;
      const x = beatToX(view, playhead) + 4;
      const y = RULER_HEIGHT + row.y - view.scrollY + Math.floor(s.row) * pitch + 3;
      fillRound(ctx, th.color.popup, x, y, w, 14, th.radius.chip);
      ctx.strokeStyle = th.color.popupBorder; ctx.stroke();
      ctx.fillStyle = th.color.text; ctx.fillText(txt, x + 4, y + 2);
    }
  }
  ctx.restore();
}
