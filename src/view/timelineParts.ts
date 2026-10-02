// Self-contained pieces of createTimeline (no shared mutable state; everything arrives as arguments).
import type { GridMode } from "../core/time";
import { GRID_CHIP_W, RULER_HEIGHT } from "./ruler";
import type { PeaksMap } from "./lanesExtra";

/** A read-only PeaksMap view that falls back to `lazy` for ids the host has not supplied. */
export function makePeakSource(peaks: () => PeaksMap | undefined, lazyGet: (id: string) => ReturnType<PeaksMap["get"]>): PeaksMap {
  const get = (id: string) => peaks()?.get(id) ?? lazyGet(id);
  return { get, has: (id) => !!get(id), size: 0, forEach() {}, keys: () => [][Symbol.iterator](), values: () => [][Symbol.iterator](), entries: () => [][Symbol.iterator](), [Symbol.iterator]: () => [][Symbol.iterator]() };
}

/** Grid readout chip (right end of the ruler): click cycles straight -> triplet -> dotted. Returns detach. */
export function attachGridChip(host: HTMLElement, a: { destroyed: () => boolean; get: () => GridMode; set: (m: GridMode) => void; emit?: (m: GridMode) => void }): () => void {
  const onChip = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.button !== 0 || y > RULER_HEIGHT || x < r.width - GRID_CHIP_W - 4 || x > r.width - 4) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (a.destroyed()) return;
    const m = a.get();
    a.set(m === "straight" ? "triplet" : m === "triplet" ? "dotted" : "straight");
    a.emit?.(a.get());
  };
  host.addEventListener("pointerdown", onChip, true);
  return () => host.removeEventListener("pointerdown", onChip, true);
}

/** Read-only outliner: swallow rename (dblclick), M/S/L buttons and row drags before they reach the rows. Returns detach. */
export function attachEditBlock(outHost: HTMLElement, ro: () => boolean): () => void {
  const blockEdit = (e: Event) => {
    if (!ro()) return;
    if (e.type === "click" && !(e.target as Element).closest?.(".tl-b")) return;
    e.stopPropagation(); e.preventDefault();
  };
  const blocked = ["click", "dblclick", "dragstart"] as const;
  blocked.forEach((t) => outHost.addEventListener(t, blockEdit, true));
  return () => blocked.forEach((t) => outHost.removeEventListener(t, blockEdit, true));
}
