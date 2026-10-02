import { describe, expect, it } from "vitest";
import { EASE_SHAPES, easeValue, easeWeight, isEaseShape } from "../src/core/easing";
import { parseSequence, serializeSequence, SequenceFormatError } from "../src/core/serialize";
import type { Sequence } from "../src/core/model";

describe("easeValue", () => {
  it("hits 0 and 1 and is monotonic for every shape", () => {
    for (const s of EASE_SHAPES) {
      expect(easeValue(s, 0)).toBe(0);
      expect(easeValue(s, 1)).toBe(1);
      expect(easeValue(s, -3)).toBe(0);
      expect(easeValue(s, 7)).toBe(1);
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const v = easeValue(s, i / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });
  it("known values", () => {
    expect(easeValue("linear", 0.3)).toBeCloseTo(0.3);
    expect(easeValue("quad", 0.5)).toBeCloseTo(0.25);
    expect(easeValue("cubic", 0.5)).toBeCloseTo(0.125);
    expect(easeValue("sine", 0.5)).toBeCloseTo(1 - Math.SQRT1_2);
    expect(easeValue("linear", NaN)).toBe(0);
    expect(isEaseShape("expo")).toBe(true);
    expect(isEaseShape("bounce")).toBe(false);
  });
});

describe("easeWeight", () => {
  it("ramps in and out, 1 in the middle, 0 outside", () => {
    expect(easeWeight(0, 0, 8, 2, 2)).toBe(0);
    expect(easeWeight(1, 0, 8, 2, 2)).toBeCloseTo(0.5);
    expect(easeWeight(4, 0, 8, 2, 2)).toBe(1);
    expect(easeWeight(7, 0, 8, 2, 2, "linear", "quad")).toBeCloseTo(0.25);
    expect(easeWeight(9, 0, 8, 2, 2)).toBe(0);
  });
});

describe("serialize easing shapes", () => {
  const seq = (shape: unknown): Sequence => ({
    version: 1, id: "r", name: "r", length: 8, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
    tracks: [{ id: "t", kind: "sections", name: "s", sections: [{ id: "s1", start: 0, length: 4, row: 0, easeIn: 1, easeInShape: shape as "sine", easeOutShape: "expo" }] }],
  });
  it("round-trips and rejects unknown shapes", () => {
    const s = seq("sine");
    expect(parseSequence(serializeSequence(s))).toEqual(s);
    expect(() => parseSequence(JSON.stringify(seq("bounce")))).toThrow(SequenceFormatError);
  });
});
