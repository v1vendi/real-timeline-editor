import { describe, expect, it } from "vitest";
import { beatToSeconds, gridStep, secondsToBeat, tickSteps, type TempoPoint } from "../src";

const tempo: TempoPoint[] = [{ beat: 0, bpm: 120 }, { beat: 8, bpm: 60 }, { beat: 12, bpm: 240 }];

describe("secondsToBeat", () => {
  it("inverts beatToSeconds across tempo changes", () => {
    for (const b of [0, 1, 7.5, 8, 10, 12, 20.25]) {
      expect(secondsToBeat(tempo, beatToSeconds(tempo, b))).toBeCloseTo(b, 9);
    }
  });
  it("clamps negatives to 0 and extends the last tempo", () => {
    expect(secondsToBeat(tempo, -3)).toBe(0);
    expect(secondsToBeat([{ beat: 0, bpm: 60 }], 5)).toBe(5);
  });
});

describe("tickSteps", () => {
  it("uses beats when zoomed in enough and subdivides further", () => {
    expect(tickSteps(100, 4)).toEqual({ major: 1, minor: 0.125 });
    expect(tickSteps(400, 4)).toEqual({ major: 0.25, minor: 1 / 32 });
  });
  it("thins to bars then multi-bar steps when zoomed out", () => {
    expect(tickSteps(20, 4).major).toBe(4);
    expect(tickSteps(1, 4).major).toBe(64);
    expect(tickSteps(1, 4).minor).toBe(8);
  });
  it("minor never coarser than major and divides it", () => {
    for (const px of [0.1, 1, 5, 20, 60, 300, 2000]) {
      const { major, minor } = tickSteps(px, 4);
      expect(minor).toBeLessThanOrEqual(major);
      expect(major / minor).toBeCloseTo(Math.round(major / minor), 9);
    }
  });
  it("gridStep picks the finest step with enough spacing", () => {
    expect(gridStep(100, 4)).toBe(0.125);
    expect(gridStep(3, 4)).toBe(4);
  });
});

describe("grid modes", () => {
  it("straight is the default", () => {
    expect(gridStep(100, 4, 12, "straight")).toBe(gridStep(100, 4));
  });
  it("triplet and dotted scale beat subdivisions", () => {
    expect(gridStep(100, 4, 12, "straight")).toBe(1 / 8);
    expect(gridStep(100, 4, 12, "triplet")).toBeCloseTo(1 / 6);
    expect(gridStep(100, 4, 12, "dotted")).toBeCloseTo(3 / 16);
  });
  it("keeps bar levels when zoomed out", () => {
    expect(gridStep(2, 4, 12, "triplet")).toBe(gridStep(2, 4));
    expect(tickSteps(100, 4, 60, 8, "triplet").minor).toBeCloseTo(1 / 18 * 1.5);
  });
});
