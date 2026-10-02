/** Horizontal/vertical view transform. Pure math, no DOM. */
export interface ViewState {
  startBeat: number; // beat at x = 0
  pxPerBeat: number;
  scrollY: number; // px scrolled down
}

export const MIN_PX_PER_BEAT = 0.5;
export const MAX_PX_PER_BEAT = 2000;

export const defaultViewState = (): ViewState => ({ startBeat: 0, pxPerBeat: 60, scrollY: 0 });
export const beatToX = (v: ViewState, beat: number): number => (beat - v.startBeat) * v.pxPerBeat;
export const xToBeat = (v: ViewState, x: number): number => v.startBeat + x / v.pxPerBeat;

/** Zoom keeping the beat under `anchorX` fixed. */
export function zoomAt(v: ViewState, anchorX: number, factor: number): ViewState {
  const pxPerBeat = Math.min(MAX_PX_PER_BEAT, Math.max(MIN_PX_PER_BEAT, v.pxPerBeat * factor));
  const anchorBeat = xToBeat(v, anchorX);
  return { ...v, pxPerBeat, startBeat: anchorBeat - anchorX / pxPerBeat };
}
