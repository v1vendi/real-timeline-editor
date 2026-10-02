import { describe, expect, it } from "vitest";
import { nudgeSelection, quantizeSelection } from "../src/edit/quantize";
import type { ChannelTrack, Sequence, SectionTrack } from "../src/core/model";

const key = (beat: number) => ({ beat, value: beat, interp: "linear" as const });
const mk = (locked = false): Sequence => ({
  version: 1, id: "r", name: "r", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [
    { id: "ch", kind: "channels", name: "ch", locked, channels: [{ id: "c", name: "c", keys: [key(0.25), key(1.1), key(2)] }] },
    { id: "sc", kind: "sections", name: "sc", locked, sections: [{ id: "s", start: 1.2, length: 2, row: 0 }] },
  ],
});
const beats = (s: Sequence) => (s.tracks[0] as ChannelTrack).channels[0]!.keys.map((k) => k.beat);
const start = (s: Sequence) => (s.tracks[1] as SectionTrack).sections[0]!.start;
const refs = (...b: number[]) => b.map((beat) => ({ trackId: "ch", channelId: "c", beat }));
const sec = [{ trackId: "sc", id: "s" }];

describe("nudge", () => {
  it("shifts keys and sections by grid steps and returns the moved refs", () => {
    const r = nudgeSelection(mk(), { keys: refs(1.1, 2), sections: sec }, 2, 0.25);
    expect(beats(r.seq)).toEqual([0.25, 1.6, 2.5]);
    expect(start(r.seq)).toBe(1.7);
    expect(r.keys.map((k) => k.beat)).toEqual([1.6, 2.5]);
  });
  it("clamps at 0 keeping key spacing; quantizes to 1/960", () => {
    const r = nudgeSelection(mk(), { keys: refs(0.25, 1.1) }, -10, 0.25);
    expect(beats(r.seq)).toEqual([0, 0.85, 2]);
    expect(beats(nudgeSelection(mk(), { keys: refs(2) }, 1, 1 / 3).seq)[2]).toBe(Math.round((2 + 1 / 3) * 960) / 960);
  });
  it("is a no-op (same seq) for zero steps or locked tracks", () => {
    const s = mk(), l = mk(true);
    expect(nudgeSelection(s, { keys: refs(2) }, 0, 0.25).seq).toBe(s);
    expect(nudgeSelection(l, { keys: refs(2), sections: sec }, 1, 0.25).seq).toBe(l);
  });
});

describe("quantize", () => {
  it("snaps fully at strength 1 and partially below", () => {
    const r = quantizeSelection(mk(), { keys: refs(1.1), sections: sec }, 0.5);
    expect(beats(r.seq)).toEqual([0.25, 1, 2]);
    expect(start(r.seq)).toBe(1);
    expect(r.keys[0]!.beat).toBe(1);
    const h = quantizeSelection(mk(), { keys: refs(1.1), sections: sec }, 0.5, 0.5);
    expect(beats(h.seq)[1]).toBe(1.05);
    expect(start(h.seq)).toBe(1.1);
  });
  it("is a no-op for strength 0, already-on-grid keys and locked tracks", () => {
    const s = mk(), l = mk(true);
    expect(quantizeSelection(s, { keys: refs(1.1) }, 0.5, 0).seq).toBe(s);
    expect(quantizeSelection(s, { keys: refs(2) }, 0.5).seq).toBe(s);
    expect(quantizeSelection(l, { keys: refs(1.1), sections: sec }, 0.5).seq).toBe(l);
  });
});
