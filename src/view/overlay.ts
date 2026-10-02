// Drag preview painted on the overlay layer: ghosts, guides and snap indicator. Pure drawing, no state.
import { quantize, type Beats, type Sequence } from "../core/model";
import type { SnapTarget } from "../core/snap";
import { MIN_SECTION_LENGTH } from "../edit/commands";
import { eventId } from "../edit/selection";
import { lanePitch, type Row, type RowLayout } from "../core/rows";
import { drawEventHighlights } from "./eventsLane";
import { drawEnvelope } from "./audioHandles";
import type { DrawContext } from "./layers";
import { RULER_HEIGHT } from "./ruler";
import { beatToX } from "./viewState";
import { lenOf, sectionTrackIds, startOf, type Drag } from "./drag";
import type { InteractionHost } from "./interaction";
import { darkTheme, roundRectPath } from "./theme";

// Row lookup for the key-drag ghosts, built once per layout (a layout is immutable; flatten makes a new one).
// Per-gesture cache of each ref's row (refs are fixed for the whole drag; the layout is immutable).
const ghostCache = new WeakMap<object, { layout: RowLayout; rows: (Row | undefined)[] }>();
function ghostRows(d: { refs: { trackId: string; channelId: string }[] }, layout: RowLayout): (Row | undefined)[] {
  const hit = ghostCache.get(d);
  if (hit && hit.layout === layout) return hit.rows;
  const idx = rowIndex(layout);
  const rows = d.refs.map((r) => idx.get(`${r.trackId}\0${r.channelId}`) ?? idx.get(r.trackId));
  ghostCache.set(d, { layout, rows });
  return rows;
}
const rowIdx = new WeakMap<RowLayout, Map<string, Row>>();
function rowIndex(layout: RowLayout): Map<string, Row> {
  let m = rowIdx.get(layout);
  if (!m) {
    m = new Map();
    for (const r of layout.rows) {
      if (r.kind === "channel") m.set(`${r.track.id}\0${r.channel.id}`, r);
      else if (!m.has(r.track.id)) m.set(r.track.id, r);
    }
    rowIdx.set(layout, m);
  }
  return m;
}

export function drawDragOverlay(c: DrawContext, host: InteractionHost, seq: () => Sequence, drag: Drag | null, guide: SnapTarget | null): void {
    const { ctx, view, width, height } = c;
    const th = c.theme ?? darkTheme, col = th.color;
    const layout = host.getLayout(), sel = host.getSelection();
    const top = (y: number) => RULER_HEIGHT + y - view.scrollY;
    ctx.save(); ctx.beginPath(); ctx.rect(0, RULER_HEIGHT, width, height - RULER_HEIGHT); ctx.clip();
    const ghost = (trackId: string, id: string, start: Beats, length: Beats, dest?: string) => {
      const row = layout.rows.find((r) => r.kind === "track" && r.track.id === (dest ?? trackId));
      const t = row?.track;
      const src = layout.rows.find((r) => r.kind === "track" && r.track.id === trackId)?.track;
      const s = src?.kind === "sections" ? src.sections.find((x) => x.id === id) : undefined;
      if (!row || !t || !s) return;
      const H = lanePitch(t, host.getMetrics?.()), y = top(row.y) + (dest ? 0 : Math.floor(s.row) * H) + 2;
      ctx.fillStyle = col.ghost; ctx.strokeStyle = col.ghostEdge; ctx.setLineDash([5, 3]);
      ctx.beginPath(); roundRectPath(ctx, beatToX(view, start), y, length * view.pxPerBeat, H - 4, th.radius.bar); ctx.fill();
      ctx.beginPath(); roundRectPath(ctx, beatToX(view, start) + 0.5, y + 0.5, length * view.pxPerBeat - 1, H - 5, th.radius.bar); ctx.stroke(); ctx.setLineDash([]);
    };
    const d = drag;
    if (d?.kind === "move") {
      const tracks = sectionTrackIds(seq().tracks);
      for (const id of d.ids) { const t = tracks.get(id); const st = startOf(seq(), id); if (t) ghost(t, id, st + d.dBeat, lenOf(seq(), id), d.toTrack); }
    } else if (d?.kind === "trim") {
      const s0 = startOf(seq(), d.id), l0 = lenOf(seq(), d.id), e0 = s0 + l0;
      const a = d.edge === "start" ? Math.min(d.beat, e0 - MIN_SECTION_LENGTH) : s0, b = d.edge === "end" ? Math.max(d.beat, s0 + MIN_SECTION_LENGTH) : e0;
      ghost(d.trackId, d.id, Math.max(0, a), b - Math.max(0, a));
    } else if (d?.kind === "keys") {
      ctx.fillStyle = col.key; ctx.globalAlpha = 0.75;
      let first = Infinity;
      for (const r of d.refs) if (r.beat < first) first = r.beat;
      const rows = ghostRows(d, layout), c0 = host.curve?.();
      const top0 = top(0), y0 = RULER_HEIGHT, y1 = height;
      for (let i = 0; i < d.refs.length; i++) {
        const row = rows[i];
        if (!row) continue;
        const ry = top0 + row.y;
        if (ry + row.h < y0 || ry > y1) continue; // off-screen rows: no ghost work
        const r = d.refs[i]!;
        const gx = Math.round(beatToX(view, quantize(r.beat + Math.max(d.dBeat, -first))));
        if (gx < -6 || gx > width + 6) continue;
        const k = c0 && row.kind === "channel" ? row.channel.keys.find((q) => q.beat === r.beat) : undefined;
        if (c0 && k) { // value-drag ghost: diamond at the dragged value
          const gy = top0 + c0.valueToY(k.value + d.dValue, r.channelId);
          ctx.beginPath(); ctx.moveTo(gx - 5, gy); ctx.lineTo(gx, gy - 5); ctx.lineTo(gx + 5, gy); ctx.lineTo(gx, gy + 5); ctx.closePath(); ctx.fill();
        } else ctx.fillRect(gx - 1, ry + 2, 2, row.h - 4);
      }
    } else if (d?.kind === "colorStop") {
      const first = Math.min(...d.refs.map((r) => r.beat)), drawn = new Set<string>();
      ctx.fillStyle = col.key; ctx.globalAlpha = 0.75;
      for (const r of d.refs) {
        const row = layout.rows.find((q) => (q.kind === "channel" ? q.track.id === r.trackId && q.channel.id === r.channelId : q.track.id === r.trackId));
        if (!row) continue;
        const gx = Math.round(beatToX(view, quantize(r.beat + Math.max(d.dBeat, -first))));
        const id = `${row.y}\0${gx}`;
        if (drawn.has(id)) continue;
        drawn.add(id);
        ctx.fillRect(gx - 1, top(row.y) + 2, 2, row.h - 4);
      }
    } else if (d?.kind === "clipHandle") {
      const row = layout.rows.find((r) => r.kind === "track" && r.track.id === d.trackId);
      if (row) drawEnvelope(ctx, { fadeIn: d.fadeIn, fadeOut: d.fadeOut, gain: d.gain }, { x: beatToX(view, d.start), y: top(row.y) + 2, w: d.length * view.pxPerBeat, h: row.h - 4 }, view.pxPerBeat, d.handle, th);
    } else if (d?.kind === "tangent" || d?.kind === "ease" || d?.kind === "clip") {
      ctx.fillStyle = col.selection; ctx.strokeStyle = col.selection;
      if (d.kind === "tangent") {
        const c = host.curve?.();
        const row = layout.rows.find((r) => r.kind === "channel" && r.track.id === d.ref.trackId && r.channel.id === d.ref.channelId);
        const k = row?.kind === "channel" ? row.channel.keys.find((q) => q.beat === d.ref.beat) : undefined;
        if (c && k) {
          const x0 = beatToX(view, k.beat), y0 = RULER_HEIGHT - view.scrollY + c.valueToY(k.value, d.ref.channelId);
          const x1 = beatToX(view, k.beat + (d.side === "out" ? Math.max(0, d.dx) : Math.min(0, d.dx))), y1 = RULER_HEIGHT - view.scrollY + c.valueToY(k.value + d.dy, d.ref.channelId);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
          ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fill();
        }
      } else if (d.kind === "ease") {
        const row = layout.rows.find((r) => r.kind === "track" && r.track.id === d.trackId);
        const t = row?.track, s = t?.kind === "sections" ? t.sections.find((x) => x.id === d.id) : undefined;
        if (row && s) {
          const other = (d.side === "in" ? s.easeOut : s.easeIn) ?? 0, dur = Math.min(d.dur, d.length - other);
          const bx = d.side === "in" ? d.start + dur : d.start + d.length - dur;
          ctx.beginPath(); ctx.arc(beatToX(view, bx), top(row.y) + Math.floor(s.row) * lanePitch(t!, host.getMetrics?.()), 4, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        const row = layout.rows.find((r) => r.kind === "track" && r.track.id === d.trackId);
        const m = d.edit.mode, b = d.edit.beat;
        const a = m === "trimStart" || m === "move" ? Math.max(0, b) : d.start;
        const len = m === "trimStart" ? d.start + d.length - a : m === "trimEnd" ? Math.max(MIN_SECTION_LENGTH, b - d.start) : d.length;
        if (row) { ctx.fillStyle = col.ghost; ctx.fillRect(beatToX(view, a), top(row.y) + 2, len * view.pxPerBeat, row.h - 4); ctx.strokeRect(beatToX(view, a) + 0.5, top(row.y) + 2.5, len * view.pxPerBeat - 1, row.h - 5); }
      }
    } else if (d?.kind === "marker") {
      const x = Math.round(beatToX(view, d.beat)) + 0.5;
      ctx.strokeStyle = d.color ?? col.marker; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, RULER_HEIGHT); ctx.lineTo(x, height); ctx.stroke(); ctx.lineWidth = 1;
    } else if (d?.kind === "event") {
      const row = layout.rows.find((r) => r.kind === "track" && r.track.id === d.trackId);
      if (row) { ctx.fillStyle = col.event; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(Math.round(beatToX(view, d.beat)), top(row.y) + row.h / 2, 5, 0, Math.PI * 2); ctx.fill(); }
    } else if (d?.kind === "box") {
      const x = Math.min(d.x0, d.x1), w = Math.abs(d.x1 - d.x0), y = RULER_HEIGHT + Math.min(d.y0, d.y1) - view.scrollY, h = Math.abs(d.y1 - d.y0);
      ctx.fillStyle = col.box; ctx.strokeStyle = col.boxEdge;
      ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
    ctx.globalAlpha = 1;
    for (const row of layout.rows) {
      if (row.kind === "track" && row.track.kind === "events" && sel.events.size) {
        const t = row.track;
        drawEventHighlights(ctx, t.events.filter((ev) => sel.events.has(eventId(t.id, ev.id))), view, top(row.y) + row.h / 2, th);
      }
    }
    ctx.restore();
    if (guide && d && d.kind !== "box") {
      const x = Math.round(beatToX(view, guide.beat)) + 0.5;
      const st = GUIDE_STYLE[guide.kind], gc = col.guide[guide.kind];
      ctx.strokeStyle = gc; ctx.setLineDash(st.dash);
      ctx.beginPath(); ctx.moveTo(x, RULER_HEIGHT); ctx.lineTo(x, height); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = gc; ctx.beginPath(); ctx.moveTo(x - 4, RULER_HEIGHT); ctx.lineTo(x + 4, RULER_HEIGHT); ctx.lineTo(x, RULER_HEIGHT + 6); ctx.fill();
    }
}

/** Snap guide dash per target kind (colors live in `Theme.color.guide`): grid is faint and dotted, content targets dashed or solid. */
const GUIDE_STYLE: Record<SnapTarget["kind"], { dash: number[] }> = {
  grid: { dash: [2, 4] },
  section: { dash: [4, 3] },
  key: { dash: [4, 3] },
  event: { dash: [4, 3] },
  playhead: { dash: [] },
  marker: { dash: [] },
};
