// Per-gesture pointer updaters: mutate the active Drag from the pointer, snapping through the host's providers.
import type { Beats, Sequence } from "../core/model";
import { yToGain } from "./audioHandles";
import type { Hit } from "./hit";
import type { InteractionHost } from "./interaction";
import { xToBeat } from "./viewState";
import { startOf, type Drag } from "./drag";

interface UpdateCtx {
  host: InteractionHost;
  seq(): Sequence;
  contentY(py: number): number;
  hitAt(x: number, cy: number): Hit;
  snap(beat: Beats, e: { altKey: boolean }, exclude: Set<string>, excludeKey?: (ch: string, b: Beats) => boolean): Beats;
  /** Snap guide of the last `snap` call, and a way to override it. */
  guide(): unknown;
  setGuide(g: any): void;
}

export function createDragUpdater({ host, seq, contentY, hitAt, snap, guide: getGuide, setGuide }: UpdateCtx) {
  type P = { x: number; y: number };
  type Ex = { altKey: boolean };
  const dx = (p: P, o: P) => xToBeat(host.getView(), p.x) - xToBeat(host.getView(), o.x);

  // One updater per gesture: mutate the drag from the pointer (p) relative to the press (o).
  const moveBox = (d: Extract<Drag, { kind: "box" }>, p: P) => { d.x1 = p.x; d.y1 = contentY(p.y); };
  const moveBeat = (d: Extract<Drag, { kind: "marker" | "event" }>, p: P, o: P, ex: Ex) => { d.beat = Math.max(0, snap(d.start + dx(p, o), ex, new Set([d.id]))); };
  const moveSections = (d: Extract<Drag, { kind: "move" }>, p: P, o: P, ex: Ex) => {
    const ids = new Set(d.ids);
    const raw = dx(p, o);
    const a = snap(d.start + raw, ex, ids), ga = getGuide();
    const b = snap(d.end + raw, ex, ids), gb = getGuide();
    // Use whichever edge (start or end) snapped with the smaller adjustment.
    const da = ga ? a - d.start : raw, db = gb ? b - d.end : raw;
    const useA = ga && (!gb || Math.abs(da - raw) <= Math.abs(db - raw));
    setGuide(useA ? ga : gb);
    d.dBeat = useA ? da : gb ? db : raw;
    d.dBeat = Math.max(d.dBeat, -Math.min(...d.ids.map((id) => startOf(seq(), id))));
    // A single section can also be dropped onto another (unlocked) section track.
    const under = d.ids.length === 1 ? hitAt(p.x, contentY(p.y)) : null;
    const rt = under && under.kind !== "none" ? under.row.track : null;
    d.toTrack = rt && rt.kind === "sections" && !rt.locked && rt.id !== d.fromTrack ? rt.id : undefined;
  };
  const moveTrim = (d: Extract<Drag, { kind: "trim" }>, p: P, ex: Ex) => { d.beat = snap(xToBeat(host.getView(), p.x), ex, new Set([d.id])); };
  const selKeysOf = new WeakMap<object, Set<string>>(); // per-gesture: refs never change while dragging
  const moveKeysDrag = (d: Extract<Drag, { kind: "keys" }>, p: P, o: P, ex: Ex) => {
    const raw = dx(p, o);
    const sel = (selKeysOf.get(d) ?? selKeysOf.set(d, new Set(d.refs.map((r) => `${r.channelId}\0${r.beat}`))).get(d))!;
    const t = snap(d.primary.beat + raw, ex, new Set(), (ch, b) => sel.has(`${ch}\0${b}`));
    d.dBeat = getGuide() ? t - d.primary.beat : raw;
    const c = host.curve?.();
    if (c) d.dValue = c.yToValue(contentY(p.y), d.primary.channelId) - c.yToValue(contentY(o.y), d.primary.channelId);
  };
  const moveColorStopDrag = (d: Extract<Drag, { kind: "colorStop" }>, p: P, o: P, ex: Ex) => {
    const raw = dx(p, o);
    const sel = (selKeysOf.get(d) ?? selKeysOf.set(d, new Set(d.refs.map((r) => `${r.channelId}\0${r.beat}`))).get(d))!;
    const t = snap(d.ref.beat + raw, ex, new Set(), (ch, b) => sel.has(`${ch}\0${b}`));
    d.dBeat = getGuide() ? t - d.ref.beat : raw;
  };
  const moveTangent = (d: Extract<Drag, { kind: "tangent" }>, p: P) => {
    const c = host.curve?.();
    d.dx = xToBeat(host.getView(), p.x) - d.ref.beat;
    if (c) d.dy = c.yToValue(contentY(p.y), d.ref.channelId) - d.value;
  };
  const moveEase = (d: Extract<Drag, { kind: "ease" }>, p: P, ex: Ex) => {
    const b = snap(xToBeat(host.getView(), p.x), ex, new Set([d.id]));
    d.dur = Math.max(0, d.side === "in" ? b - d.start : d.start + d.length - b);
  };
  const moveClipHandle = (d: Extract<Drag, { kind: "clipHandle" }>, p: P, ex: Ex) => {
    if (d.handle === "gain") {
      const row = host.getLayout().rows.find((r) => r.kind === "track" && r.track.id === d.trackId);
      if (row) d.gain = Math.round(yToGain(contentY(p.y), { x: 0, y: row.y + 2, w: 0, h: row.h - 4 }) * 100) / 100;
      return;
    }
    const b = snap(xToBeat(host.getView(), p.x), ex, new Set());
    if (d.handle === "fadeIn") d.fadeIn = Math.min(Math.max(0, b - d.start), d.length - d.fadeOut);
    else d.fadeOut = Math.min(Math.max(0, d.start + d.length - b), d.length - d.fadeIn);
  };
  const moveClip = (d: Extract<Drag, { kind: "clip" }>, p: P, ex: Ex) => {
    const dl = xToBeat(host.getView(), p.x) - d.grab;
    const m = d.edit.mode;
    d.edit = { mode: m, beat: m === "slip" ? d.from - dl : snap(d.from + dl, ex, new Set()) };
  };

  const updateDrag = (d: Drag, p: P, o: P, ex: Ex) => {
    switch (d.kind) {
      case "box": return moveBox(d, p);
      case "marker": case "event": return moveBeat(d, p, o, ex);
      case "move": return moveSections(d, p, o, ex);
      case "trim": return moveTrim(d, p, ex);
      case "keys": return moveKeysDrag(d, p, o, ex);
      case "colorStop": return moveColorStopDrag(d, p, o, ex);
      case "tangent": return moveTangent(d, p);
      case "ease": return moveEase(d, p, ex);
      case "clipHandle": return moveClipHandle(d, p, ex);
      case "clip": return moveClip(d, p, ex);
    }
  };
  return updateDrag;
}
