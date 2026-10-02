import { describe, expect, it } from "vitest";
import { colorAt, hsvToRgb, rgbToHsv, toHex } from "../src/core/color";
import { addColorStop, colorStopsDelta, moveColorStop, moveColorStops, splitColorStops, removeColorStop, setGroupColor } from "../src/edit";
import type { Sequence } from "../src/core/model";

const mk = (kind: string, n: number, range?: number, locked = false): Sequence => ({
  version: 1, id: "s", name: "s", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [{
    id: "t", kind: "channels", name: "t", ...(locked ? { locked } : {}),
    channels: Array.from({ length: n }, (_, i) => ({ id: "c" + i, name: "c" + i, keys: i === 0 ? [{ beat: 0, value: 0, interp: "constant" as const }] : [] })),
    groups: [{ id: "g", name: "g", kind, channelIds: Array.from({ length: n }, (_, i) => "c" + i), ...(range ? { range } : {}) }],
  }],
});
const ref = { trackId: "t", groupId: "g" };
const keys = (s: Sequence, id: string) => (s.tracks[0]!.kind === "channels" ? s.tracks[0]!.channels.find((c) => c.id === id)!.keys.map((k) => k.beat) : []);

describe("color stops", () => {
  it("rgbToHsv round trips hsvToRgb", () => {
    for (const [r, g, b] of [[255, 0, 0], [12, 200, 99], [0, 0, 0], [255, 255, 255], [10, 10, 250]] as const) {
      const { h, s, v } = rgbToHsv(r, g, b), o = hsvToRgb(h, s, v);
      expect([o.r, o.g, o.b].map(Math.round)).toEqual([r, g, b]);
    }
  });
  it("setGroupColor rgb writes all channels, creating keys, inheriting interp", () => {
    const s = setGroupColor(mk("rgb", 3), ref, 4, { r: 255, g: 128, b: 0, a: 255 });
    expect(keys(s, "c0")).toEqual([0, 4]); expect(keys(s, "c1")).toEqual([4]); expect(keys(s, "c2")).toEqual([4]);
    expect(toHex(colorAt(s, "t", "g", 4)!)).toBe("#ff8000");
    expect(s.tracks[0]!.kind === "channels" && s.tracks[0]!.channels[1]!.keys[0]!.interp).toBe("linear");
  });
  it("setGroupColor rgba alpha, range, hsv, hue", () => {
    const c = { r: 0, g: 255, b: 0, a: 127.5 };
    expect(colorAt(setGroupColor(mk("rgba", 4), ref, 0, c), "t", "g", 0)).toEqual(c);
    expect(toHex(colorAt(setGroupColor(mk("rgb", 3, 1), ref, 0, { r: 255, g: 0, b: 0, a: 255 }), "t", "g", 0)!)).toBe("#ff0000");
    const hsv = setGroupColor(mk("hsv", 4), ref, 0, { r: 0, g: 0, b: 255, a: 255 });
    expect(colorAt(hsv, "t", "g", 0)).toEqual({ r: 0, g: 0, b: 255, a: 255 });
    expect(toHex(colorAt(setGroupColor(mk("hue", 1), ref, 0, { r: 0, g: 255, b: 0, a: 255 }), "t", "g", 0)!)).toBe("#00ff00");
  });
  it("no-ops: locked track, bad group", () => {
    const l = mk("rgb", 3, undefined, true);
    expect(setGroupColor(l, ref, 1, { r: 1, g: 2, b: 3, a: 255 })).toBe(l);
    expect(setGroupColor(mk("rgb", 3), { trackId: "t", groupId: "x" }, 1, { r: 1, g: 2, b: 3, a: 255 })).toEqual(mk("rgb", 3));
  });
  it("addColorStop keeps the gradient value", () => {
    const base = setGroupColor(setGroupColor(mk("rgb", 3), ref, 0, { r: 0, g: 0, b: 0, a: 255 }), ref, 8, { r: 200, g: 100, b: 0, a: 255 });
    const before = colorAt(base, "t", "g", 4)!, s = addColorStop(base, ref, 4);
    expect(keys(s, "c1")).toEqual([0, 4, 8]);
    expect(toHex(colorAt(s, "t", "g", 4)!)).toBe(toHex(before));
  });
  it("moveColorStop moves all channels together, clamped between neighbors", () => {
    let s = mk("rgb", 3);
    for (const b of [0, 4, 8]) s = setGroupColor(s, ref, b, { r: b * 10, g: 0, b: 0, a: 255 });
    const m = moveColorStop(s, { ...ref, beat: 4 }, 2);
    for (const id of ["c0", "c1", "c2"]) expect(keys(m, id)).toEqual([0, 6, 8]);
    const hi = moveColorStop(s, { ...ref, beat: 4 }, 100), lo = moveColorStop(s, { ...ref, beat: 4 }, -100);
    expect(keys(hi, "c1")[1]).toBeLessThan(8); expect(keys(hi, "c1")[1]).toBeGreaterThan(7.99);
    expect(keys(lo, "c1")[0]).toBe(0); expect(keys(lo, "c1")).toHaveLength(3);
    expect(moveColorStop(s, { ...ref, beat: 5 }, 1)).toBe(s);
  });
  it("moveColorStops moves several stops rigidly, clamped by the non-moving neighbors", () => {
    let s = mk("rgb", 3);
    for (const b of [0, 2, 4, 6, 10]) s = setGroupColor(s, ref, b, { r: b, g: 0, b: 0, a: 255 });
    const st = [2, 4].map((beat) => ({ ...ref, beat }));
    const m = moveColorStops(s, st, 1);
    for (const id of ["c0", "c1", "c2"]) expect(keys(m, id)).toEqual([0, 3, 5, 6, 10]);
    expect(colorStopsDelta(s, st, 100)).toBeLessThan(2);
    expect(colorStopsDelta(s, st, 100)).toBeGreaterThan(1.99);
    const lo = moveColorStops(s, st, -100);
    expect(keys(lo, "c1")).toHaveLength(5);
    expect(keys(lo, "c1")[0]).toBe(0);
    expect(keys(lo, "c1")[1]).toBeGreaterThan(0);
    expect(keys(lo, "c1")[2]! - keys(lo, "c1")[1]!).toBeCloseTo(2, 5);
    expect(moveColorStops(s, [{ ...ref, beat: 5 }], 1)).toBe(s);
    expect(moveColorStops(s, [], 1)).toBe(s);
  });
  it("splitColorStops dedupes channel keys into stops and leaves other keys", () => {
    const s = setGroupColor(mk("rgb", 3), ref, 4, { r: 1, g: 2, b: 3, a: 255 });
    const r = (channelId: string, beat: number) => ({ trackId: "t", channelId, beat });
    const { stops, keys: rest } = splitColorStops(s, [r("c0", 4), r("c1", 4), r("c2", 4)]);
    expect(stops).toEqual([{ ...ref, beat: 4 }]);
    expect(rest).toEqual([]);
    expect(splitColorStops(s, [{ trackId: "x", channelId: "c0", beat: 1 }]).keys).toHaveLength(1);
  });
  it("removeColorStop deletes all channel keys at the beat", () => {
    const s = setGroupColor(setGroupColor(mk("rgb", 3), ref, 0, { r: 0, g: 0, b: 0, a: 255 }), ref, 4, { r: 9, g: 9, b: 9, a: 255 });
    const r = removeColorStop(s, { ...ref, beat: 4 });
    for (const id of ["c0", "c1", "c2"]) expect(keys(r, id)).toEqual([0]);
    expect(removeColorStop(r, { ...ref, beat: 4 })).toBe(r);
  });
});
