import { describe, expect, it } from "vitest";
import { beatToFrames, fitLength, formatBeat } from "../src/core/timefmt";
import type { Sequence } from "../src/core/model";

const t120 = [{ beat: 0, bpm: 120 }];
const seq = (tracks: Sequence["tracks"]): Sequence =>
  ({ version: 1, id: "s", name: "s", length: 4, beatsPerBar: 4, tempo: t120, tracks, markers: [], library: {} });

describe("formatBeat", () => {
  it("formats seconds, frames and timecode", () => {
    expect(formatBeat(t120, 2.5, "seconds")).toBe("1.250");
    expect(formatBeat(t120, 2.5, "frames", 24)).toBe("30");
    expect(formatBeat(t120, 2.5, "timecode", 24)).toBe("00:01:06");
    expect(beatToFrames(t120, 1, 30)).toBe(15);
  });
  it("rolls into minutes/hours and clamps negatives", () => {
    expect(formatBeat(t120, 120, "timecode", 30)).toBe("01:00:00");
    expect(formatBeat(t120, 7200, "timecode", 30)).toBe("01:00:00:00");
    expect(formatBeat(t120, -3, "timecode", 30)).toBe("00:00:00");
  });
});

describe("fitLength", () => {
  it("is 0 when empty", () => expect(fitLength(seq([]))).toBe(0));
  it("takes the max of keys, section ends, clip ends, through folders", () => {
    const k = (beat: number) => ({ beat, value: 0, interp: "linear" as const });
    const s = seq([
      { kind: "channels", id: "a", name: "a", channels: [{ id: "c", name: "c", keys: [k(1), k(5)] }] },
      { kind: "folder", id: "f", name: "f", children: [
        { kind: "sections", id: "b", name: "b", sections: [{ id: "x", start: 4, length: 3.5, row: 0 }] },
        { kind: "audio", id: "d", name: "d", clips: [{ id: "y", start: 1, length: 2, offset: 0 }] },
      ] },
    ]);
    expect(fitLength(s)).toBe(7.5);
  });
});
