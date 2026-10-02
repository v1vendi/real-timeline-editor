import { describe, expect, it } from "vitest";
import { fitValues, keysInBox, lockAxis, panValue, setTangentMode, sampleChannel, valueRange, valueTicks, valueToY, yToValue, zoomValueAt } from "../src/view/curveMath";
import type { Sequence } from "../src/core/model";
const k = (beat: number, value: number, interp: "constant" | "linear" | "bezier" = "linear") => ({ beat, value, interp });

describe("value axis", () => {
  it("round-trips and keeps the anchor fixed on zoom", () => {
    const a = { top: 10, pxPerUnit: 20 };
    expect(yToValue(a, valueToY(a, 3.5))).toBeCloseTo(3.5);
    const z = zoomValueAt(a, 50, 2);
    expect(yToValue(z, 50)).toBeCloseTo(yToValue(a, 50));
    expect(z.pxPerUnit).toBe(40);
  });
  it("pans and fits", () => {
    expect(valueToY(panValue({ top: 0, pxPerUnit: 10 }, 20), 0)).toBeCloseTo(20);
    const f = fitValues(0, 100, 224, 12);
    expect(valueToY(f, 100)).toBeCloseTo(12);
    expect(valueToY(f, 0)).toBeCloseTo(212);
  });
  it("ticks use 1/2/5 steps", () => {
    expect(valueTicks(0, 10, 20, 40)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(valueTicks(0, 1, 500, 40)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });
});

describe("curve sampling", () => {
  it("range includes handle tips; empty is undefined", () => {
    expect(valueRange([{ keys: [] }])).toBeUndefined();
    const keys = [{ ...k(0, 0, "bezier"), tan: { mode: "free" as const, inDx: 0, inDy: 0, outDx: 1, outDy: 5 } }, k(4, 2)];
    expect(valueRange([{ keys }])).toEqual([0, 5]);
  });
  it("steps constant, lines linear, samples bezier", () => {
    expect(sampleChannel({ keys: [k(0, 1, "constant"), k(2, 5)] }, 0, 2, 50)).toEqual([0, 1, 2, 1, 2, 5]);
    expect(sampleChannel({ keys: [k(0, 0), k(2, 4)] }, -1, 3, 50)).toEqual([-1, 0, 0, 0, 2, 4, 3, 4]);
    const p = sampleChannel({ keys: [k(0, 0, "bezier"), k(2, 4)] }, 0, 2, 60);
    expect(p.length).toBeGreaterThan(20);
    expect(p[p.length - 1]).toBe(4);
  });
});

describe("drag helpers", () => {
  it("locks to the dominant axis and selects keys in a box", () => {
    expect(lockAxis(5, -2)).toEqual([5, 0]);
    expect(lockAxis(1, -4)).toEqual([0, -4]);
    const ch = [{ id: "a", keys: [k(0, 0), k(2, 5), k(4, 9)] }];
    expect(keysInBox(ch, 3, -1, 6, -1)).toEqual([{ channelId: "a", beat: 0 }, { channelId: "a", beat: 2 }]);
  });
});

describe("setTangentMode", () => {
  const mk = (locked = false): Sequence => ({ version: 1, id: "s", name: "s", length: 8, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {}, tracks: [
    { id: "t", name: "t", kind: "channels", locked, channels: [{ id: "c", name: "c", keys: [k(0, 0, "bezier"), k(3, 6, "bezier"), k(6, 0, "bezier")] }] }] });
  const ref = { trackId: "t", channelId: "c", beat: 3 };
  const keys = (s: Sequence) => (s.tracks[0] as { channels: { keys: { tan?: { mode: string; inDx: number; inDy: number; outDx: number; outDy: number } }[] }[] }).channels[0]!.keys;
  it("freezes handles as free/aligned and returns to auto", () => {
    const s = mk(), free = setTangentMode(s, [ref], "free");
    expect(keys(free)[1]!.tan).toMatchObject({ mode: "free", outDx: 1, outDy: 0 });
    expect(setTangentMode(free, [ref], "free")).toBe(free);
    expect(keys(setTangentMode(free, [ref], "aligned"))[1]!.tan?.mode).toBe("aligned");
    expect(keys(setTangentMode(free, [ref], "auto"))[1]!.tan).toBeUndefined();
  });
  it("skips locked tracks", () => {
    const s = mk(true);
    expect(setTangentMode(s, [ref], "free")).toBe(s);
  });
});
