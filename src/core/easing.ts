// Named easing shapes for section ease-in/out handles. Pure; the host interprets the result as a blend weight.

export const EASE_SHAPES = ["linear", "sine", "quad", "cubic", "quart", "expo", "circ"] as const;
export type EaseShape = (typeof EASE_SHAPES)[number];

export const isEaseShape = (v: unknown): v is EaseShape => EASE_SHAPES.includes(v as EaseShape);

/** Ease-in curve (slow start) per shape, on t in [0,1]. */
const IN: Record<EaseShape, (t: number) => number> = {
  linear: (t) => t,
  sine: (t) => 1 - Math.cos((t * Math.PI) / 2),
  quad: (t) => t * t,
  cubic: (t) => t * t * t,
  quart: (t) => t * t * t * t,
  expo: (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  circ: (t) => 1 - Math.sqrt(1 - t * t),
};

/**
 * Ramp-up weight for progress `t` (clamped to 0..1): 0 at 0, 1 at 1, monotonic.
 * For ease-out, pass the remaining fraction of the span (1 at the handle start, 0 at the section end).
 */
export function easeValue(shape: EaseShape, t: number): number {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return IN[shape](t);
}

/** Weight at beat `t` inside a section from its ease handles (1 in the middle). Durations in beats. */
export function easeWeight(
  t: number,
  start: number,
  length: number,
  easeIn = 0,
  easeOut = 0,
  inShape: EaseShape = "linear",
  outShape: EaseShape = "linear",
): number {
  if (t < start || t > start + length) return 0;
  let w = 1;
  if (easeIn > 0 && t < start + easeIn) w = Math.min(w, easeValue(inShape, (t - start) / easeIn));
  if (easeOut > 0 && t > start + length - easeOut) w = Math.min(w, easeValue(outShape, (start + length - t) / easeOut));
  return w;
}
