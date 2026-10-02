import { describe, expect, it } from "vitest";
import { colorAt, colorStops, hsvToRgb, toCss, toHex } from "../src/core/color";
import type { Interp, Sequence } from "../src/core/model";
import { parseSequence, serializeSequence, SequenceFormatError } from "../src/core/serialize";

const ch = (id: string, keys: [number, number][], interp: Interp) => ({ id, name: id, keys: keys.map(([beat, value]) => ({ beat, value, interp })) });
const mk = (interp: Interp, kind = "rgb", range?: number, vals: [number, number][][] = [[[0, 0], [4, 255]], [[0, 0]], [[0, 100]]]): Sequence => ({
  version: 1, id: "s", name: "s", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [{ id: "t", kind: "channels", name: "t", channels: vals.map((k, i) => ch("c" + i, k, interp)), groups: [{ id: "g", name: "g", kind, channelIds: vals.map((_, i) => "c" + i), ...(range ? { range } : {}) }] }],
});

describe("color", () => {
  it("linear rgb", () => {
    expect(colorAt(mk("linear"), "t", "g", 2)).toEqual({ r: 127.5, g: 0, b: 100, a: 255 });
  });
  it("constant steps hard, with paired stops", () => {
    const s = mk("constant");
    expect(toHex(colorAt(s, "t", "g", 3.9)!)).toBe("#000064");
    expect(toHex(colorAt(s, "t", "g", 4)!)).toBe("#ff0064");
    expect(colorStops(s, "t", "g", 0, 4)).toEqual([{ beat: 0, css: "rgb(0,0,100)" }, { beat: 4, css: "rgb(0,0,100)" }]);
  });
  it("linear rgb needs only endpoints; bezier adds samples, capped", () => {
    expect(colorStops(mk("linear"), "t", "g", 0, 4)).toHaveLength(2);
    const bz = mk("bezier");
    expect(colorStops(bz, "t", "g", 0, 4).length).toBeGreaterThan(5);
    expect(colorStops(bz, "t", "g", 0, 4, 2)).toHaveLength(2);
    expect(colorStops(bz, "t", "g", 0, 4, 5).length).toBeLessThanOrEqual(5);
  });
  it("hsv, hue, range, clamp", () => {
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    const hue = mk("linear", "hue", undefined, [[[0, 0], [4, 120]]]);
    expect(toHex(colorAt(hue, "t", "g", 2)!)).toBe("#ffff00");
    expect(colorStops(hue, "t", "g", 0, 4).length).toBeGreaterThan(2);
    expect(toHex(colorAt(mk("linear", "rgb", 1, [[[0, 1]], [[0, 0]], [[0, 0]]]), "t", "g", 0)!)).toBe("#ff0000");
    expect(toHex(colorAt(mk("linear", "rgb", undefined, [[[0, 999]], [[0, -5]], [[0, 0]]]), "t", "g", 0)!)).toBe("#ff0000");
    const a = colorAt(mk("linear", "rgba", undefined, [[[0, 0]], [[0, 0]], [[0, 0]], [[0, 127.5]]]), "t", "g", 0)!;
    expect(toCss(a)).toBe("rgba(0,0,0,0.5)");
    expect(colorAt(mk("linear", "xyz"), "t", "g", 0)).toBeUndefined();
  });
  it("serialize round-trips range and rejects wrong arity", () => {
    const s = mk("linear", "rgb", 1);
    expect(parseSequence(serializeSequence(s))).toEqual(s);
    expect(() => parseSequence(serializeSequence(mk("linear", "rgba")))).toThrow(SequenceFormatError);
  });
  it("hue wraps the short way on linear segments", () => {
    const hue = (a: number, b: number, kind = "hue") => mk("linear", kind, undefined, kind === "hue" ? [[[0, a], [4, b]]] : [[[0, a], [4, b]], [[0, 1]], [[0, 1]]]);
    // 350 -> 10 passes through 0 (red) at the midpoint, not through cyan.
    expect(toHex(colorAt(hue(350, 10), "t", "g", 2)!)).toBe("#ff0000");
    expect(toHex(colorAt(hue(350, 10, "hsv"), "t", "g", 2)!)).toBe("#ff0000");
    expect(toHex(colorAt(hue(350, 10), "t", "g", 1)!)).toBe(toHex(hsvToRgb(355, 1, 1) as never));
    expect(toHex(colorAt(hue(10, 350), "t", "g", 3)!)).toBe(toHex(hsvToRgb(355, 1, 1) as never));
    // the long way stays linear when it is the short one; exact endpoints
    expect(colorAt(hue(0, 120), "t", "g", 2)).toEqual({ ...hsvToRgb(60, 1, 1), a: 255 });
    expect(colorAt(hue(350, 10), "t", "g", 4)).toEqual({ ...hsvToRgb(10, 1, 1), a: 255 });
    // bezier and constant are unchanged
    expect(colorAt(mk("constant", "hue", undefined, [[[0, 350], [4, 10]]]), "t", "g", 3)).toEqual({ ...hsvToRgb(350, 1, 1), a: 255 });
    expect(toHex(colorAt(mk("bezier", "hue", undefined, [[[0, 350], [4, 10]]]), "t", "g", 2)!)).toBe(toHex(hsvToRgb(180, 1, 1) as never));
    // stops sample the wrapped segment
    const st = colorStops(hue(350, 10), "t", "g", 0, 4);
    expect(st.length).toBeGreaterThan(2);
    for (const x of st) expect(x.css.startsWith("rgb(255,")).toBe(true); // always near red
  });
});
