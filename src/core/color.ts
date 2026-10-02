/** Color semantics for channel groups (kind 'rgb' | 'rgba' | 'hsv' | 'hue'). Pure core, no DOM. */
import { evaluate, findKey } from "./curve";
import { findTrack } from "../edit/commands";
import { clamp, lastAtOrBefore } from "./math";
import type { Beats, Channel, ChannelGroup, Sequence } from "./model";

export interface Rgba { r: number; g: number; b: number; a: number }
export interface ColorStop { beat: Beats; css: string }


/** h in degrees (wraps), s/v in 0..1 -> r,g,b in 0..255. */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const hh = ((((h % 360) + 360) % 360) / 60), c = v * clamp(s, 0, 1), i = Math.floor(hh), f = hh - i;
  const p = v - c, q = v - c * f, t = v - c * (1 - f);
  const [r = 0, g = 0, b = 0] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]!;
  return { r: r * 255, g: g * 255, b: b * 255 };
}

/** r,g,b in 0..255 -> h in degrees [0,360), s/v in 0..1. Inverse of `hsvToRgb`. */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  const h = d === 0 ? 0 : mx === r ? (((g - b) / d) % 6) * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h: ((h % 360) + 360) % 360, s: mx === 0 ? 0 : d / mx, v: mx / 255 };
}

const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
/** "#rrggbb", or "#rrggbbaa" when alpha < 1 (a in 0..255 like the other channels). */
export function toHex(c: Rgba): string { return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 255 ? hex2(c.a) : ""}`; }
export function toCss(c: Rgba): string {
  const r = (n: number) => Math.round(clamp(n, 0, 255));
  return c.a < 255 ? `rgba(${r(c.r)},${r(c.g)},${r(c.b)},${Math.round((clamp(c.a, 0, 255) / 255) * 1000) / 1000})` : `rgb(${r(c.r)},${r(c.g)},${r(c.b)})`;
}

const isColorKind = (k: string | undefined) => k === "rgb" || k === "rgba" || k === "hsv" || k === "hue";

/** @internal shared with edit/colorCommands. */
export function resolve(seq: Sequence, trackId: string, groupId: string): { g: ChannelGroup; ch: (Channel | undefined)[] } | undefined {
  const t = findTrack(seq.tracks, trackId);
  if (!t || t.kind !== "channels") return undefined;
  const g = t.groups?.find((x) => x.id === groupId);
  if (!g || !isColorKind(g.kind)) return undefined;
  return { g, ch: g.channelIds.map((id) => t.channels.find((c) => c.id === id)) };
}

/** Hue (degrees) at `beat`: linear segments take the short way around 360; constant and bezier evaluate as usual. */
function hueEval(c: Channel, beat: Beats): number | undefined {
  const keys = c.keys, i = findKey(keys, beat), a = keys[i], b = keys[i + 1];
  if (!a || !b || a.interp !== "linear" || beat === a.beat) return evaluate(c, beat);
  const d = ((((b.value - a.value) % 360) + 540) % 360) - 180; // shortest signed delta in [-180, 180)
  return a.value + (d * (beat - a.beat)) / (b.beat - a.beat);
}

function colorFrom(g: ChannelGroup, ch: (Channel | undefined)[], beat: Beats): Rgba {
  const v = (i: number, dflt: number) => { const c = ch[i]; return c ? ((i === 0 && g.kind !== "rgb" && g.kind !== "rgba" ? hueEval(c, beat) : evaluate(c, beat)) ?? dflt) : dflt; };
  if (g.kind === "hue") return { ...hsvToRgb(v(0, 0), 1, 1), a: 255 };
  const max = g.range && g.range > 0 ? g.range : g.kind === "hsv" ? 1 : 255;
  const n = (i: number, dflt: number) => clamp(v(i, dflt) / max, 0, 1);
  const a = ch.length > 3 ? n(3, max) * 255 : 255;
  if (g.kind === "hsv") return { ...hsvToRgb(v(0, 0), n(1, 0), n(2, 0)), a };
  return { r: n(0, 0) * 255, g: n(1, 0) * 255, b: n(2, 0) * 255, a };
}

/** Color of a color-kind group at `beat` (0..255 per component); undefined if not a color group. Constant keys step. */
export function colorAt(seq: Sequence, trackId: string, groupId: string, beat: Beats): Rgba | undefined {
  const r = resolve(seq, trackId, groupId);
  return r && colorFrom(r.g, r.ch, beat);
}

const SEG_SAMPLES = 8;

/**
 * Gradient stops over [t0, t1]: one per key beat, hard steps as two stops at the same beat, and extra
 * samples inside bezier segments (and linear ones for hsv/hue, which are not linear in rgb). At most `maxStops`
 * stops (min 2). Returns [] if not a color group.
 */
export function colorStops(seq: Sequence, trackId: string, groupId: string, t0: Beats, t1: Beats, maxStops = 64): ColorStop[] {
  const r = resolve(seq, trackId, groupId);
  if (!r || t1 < t0) return [];
  const { g, ch } = r, chs = ch.filter((c): c is Channel => !!c);
  const at = (b: Beats) => toCss(colorFrom(g, ch, b));
  const pts = new Set<number>([t0, t1]);
  for (const c of chs) for (const k of c.keys) if (k.beat > t0 && k.beat < t1) pts.add(k.beat);
  const beats = [...pts].sort((a, b) => a - b);
  const nonRgb = g.kind === "hsv" || g.kind === "hue";
  // Per span: 0 = hold, else interior sample count wanted.
  const want = (a: Beats): number => {
    let n = 0;
    for (const c of chs) {
      const i = lastAtOrBefore(c.keys, a);
      const k = c.keys[i], nx = c.keys[i + 1];
      if (!k || !nx || k.interp === "constant") continue;
      n = Math.max(n, k.interp === "bezier" || nonRgb ? SEG_SAMPLES : 0);
      if (n === 0) n = -1; // smooth but rgb-linear: endpoints suffice
    }
    return n;
  };
  const spans = beats.slice(0, -1).map((a, i) => ({ a, b: beats[i + 1]!, n: want(a) }));
  const cost = (n: number) => spans.reduce((s, sp) => s + (sp.n === 0 ? 2 : 1 + (sp.n > 0 ? n : 0)), 1);
  let n = SEG_SAMPLES;
  while (n > 0 && cost(n) > maxStops) n = Math.floor(n / 2);
  const out: ColorStop[] = [];
  if (spans.length === 0) return [{ beat: t0, css: at(t0) }];
  for (const sp of spans) {
    out.push({ beat: sp.a, css: at(sp.a) });
    if (sp.n === 0) out.push({ beat: sp.b, css: at(sp.a) });
    else for (let j = 1; j <= (sp.n > 0 ? n : 0); j++) { const b = sp.a + ((sp.b - sp.a) * j) / (n + 1); out.push({ beat: b, css: at(b) }); }
  }
  const last = spans[spans.length - 1]!;
  if (last.n !== 0) out.push({ beat: t1, css: at(t1) });
  else out[out.length - 1] = { beat: t1, css: at(last.a) };
  return out.length > maxStops ? thin(out, Math.max(2, maxStops)) : out;
}

function thin(a: ColorStop[], max: number): ColorStop[] {
  const out: ColorStop[] = [];
  for (let i = 0; i < max; i++) out.push(a[Math.round((i * (a.length - 1)) / (max - 1))]!);
  return out;
}
