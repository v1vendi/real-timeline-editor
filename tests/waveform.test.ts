import { describe, expect, it } from "vitest";
import { buildPeakMips, buildPeaks, downsamplePeaks, pickMip } from "../src/core/waveform";

describe("waveform peaks", () => {
  it("builds min/max per block incl. partial tail", () => {
    const p = buildPeaks([0, 1, -1, 0.5, 0.25], 4, 2);
    expect(p.peaksPerSecond).toBe(2);
    expect(Array.from(p.min)).toEqual([0, -1, 0.25]);
    expect(Array.from(p.max)).toEqual([1, 0.5, 0.25]);
  });

  it("downsample merges pairs and keeps odd tail", () => {
    const d = downsamplePeaks(buildPeaks([0, 1, -1, 0.5, 0.25], 4, 2));
    expect(d.peaksPerSecond).toBe(1);
    expect(Array.from(d.min)).toEqual([-1, 0.25]);
    expect(Array.from(d.max)).toEqual([1, 0.25]);
  });

  it("pyramid preserves global extremes and halves density", () => {
    const s = Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7));
    s[500] = 2;
    const m = buildPeakMips(s, 1000, { samplesPerPeak: 1, minPeaks: 10 });
    expect(m.levels[0]!.peaksPerSecond).toBe(1000);
    expect(m.levels[1]!.peaksPerSecond).toBe(500);
    const last = m.levels[m.levels.length - 1]!;
    expect(last.min.length).toBeLessThanOrEqual(10);
    expect(Math.max(...last.max)).toBe(2);
  });

  it("pickMip: finest level with one peak >= 1px", () => {
    const m = buildPeakMips(new Float32Array(1000), 1000, { samplesPerPeak: 1, minPeaks: 10 });
    expect(pickMip(m, 2000)).toBe(0);
    expect(pickMip(m, 1000)).toBe(0);
    expect(pickMip(m, 600)).toBe(1);
    expect(pickMip(m, 0.001)).toBe(m.levels.length - 1);
  });
});
