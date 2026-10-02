// Events lane: dots with labels, and their hit zone. Pure draw/hit helpers, no state.
import type { TimelineEvent } from "../core/model";
import { beatToX, xToBeat, type ViewState } from "./viewState";
import { darkTheme, type Theme } from "./theme";

const DOT_R = 5;

/** Draw one dot per visible event at row center `cy`, with the name to its right when there is room. */
export function drawEventsLane(ctx: CanvasRenderingContext2D, events: readonly TimelineEvent[], view: ViewState, width: number, cy: number, muted = false, th: Theme = darkTheme): void {
  const b0 = xToBeat(view, -DOT_R), b1 = xToBeat(view, width + 200);
  ctx.save();
  ctx.globalAlpha = muted ? 0.4 : 1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.beat < b0 || e.beat > b1) continue;
    const x = Math.round(beatToX(view, e.beat));
    ctx.fillStyle = th.color.event; ctx.globalAlpha = muted ? 0.15 : 0.22;
    ctx.beginPath(); ctx.arc(x, cy, DOT_R + 3, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = muted ? 0.4 : 1;
    ctx.beginPath(); ctx.arc(x, cy, DOT_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = th.color.keyStroke; ctx.lineWidth = 1; ctx.stroke();
    const next = events[i + 1];
    const room = next ? beatToX(view, next.beat) - x - DOT_R - 6 : Infinity;
    if (e.name && room > 24) {
      ctx.save();
      if (next) { ctx.beginPath(); ctx.rect(x + DOT_R + 3, cy - 8, room, 16); ctx.clip(); }
      ctx.fillStyle = th.color.text; ctx.textBaseline = "middle"; ctx.fillText(e.name, x + DOT_R + 6, Math.round(cy) + 0.5);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Index of the event nearest x within `tolPx` (horizontal, anywhere in the row), or -1. */
export function hitEvent(events: readonly TimelineEvent[], view: ViewState, x: number, tolPx = DOT_R + 2): number {
  let best = -1, bestD = tolPx;
  for (let i = 0; i < events.length; i++) {
    const d = Math.abs(beatToX(view, events[i]!.beat) - x);
    if (d <= bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Selection ring around the given events' dots (drawn on the overlay layer). */
export function drawEventHighlights(ctx: CanvasRenderingContext2D, events: readonly TimelineEvent[], view: ViewState, cy: number, th: Theme = darkTheme): void {
  ctx.save();
  ctx.strokeStyle = th.color.selection; ctx.lineWidth = 2; ctx.shadowColor = th.color.selectionGlow; ctx.shadowBlur = 8;
  for (const e of events) { ctx.beginPath(); ctx.arc(Math.round(beatToX(view, e.beat)), cy, DOT_R + 3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}
