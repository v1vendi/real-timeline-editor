import { describe, expect, it } from "vitest";
import type { Sequence } from "../src/core/model";
import { setKeys } from "../src/edit/batch";
import { History } from "../src/edit/history";

const k = (beat: number, value: number, tan?: any) => ({ beat, value, interp: "linear" as const, ...(tan ? { tan } : {}) });
const base: Sequence = {
  version: 1, id: "s", name: "s", length: 64, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [
    { id: "C", name: "c", kind: "channels", channels: [
      { id: "a", name: "a", keys: [k(1, 1), k(2, 2), k(5, 5, { mode: "aligned", inDx: -1, inDy: 0, outDx: 1, outDy: 0 })] },
      { id: "b", name: "b", keys: [k(1, 10)] }] },
    { id: "L", name: "l", kind: "channels", locked: true, channels: [{ id: "a", name: "a", keys: [k(1, 1)] }] },
  ],
};
const ch = (s: Sequence, id: string) => (s.tracks[0] as any).channels.find((c: any) => c.id === id).keys;
const refs = [{ trackId: "C", channelId: "a", beat: 1 }, { trackId: "C", channelId: "b", beat: 1 }, { trackId: "L", channelId: "a", beat: 1 }];

describe("setKeys", () => {
  it("sets absolute value, skips locked, no-op returns same seq", () => {
    const { seq } = setKeys(base, refs, { value: 7 });
    expect(ch(seq, "a")[0].value).toBe(7);
    expect(ch(seq, "b")[0].value).toBe(7);
    expect(seq.tracks[1]).toBe(base.tracks[1]);
    expect(setKeys(base, refs, {}).seq).toBe(base);
  });
  it("relative value and beat, returns moved refs", () => {
    const r = setKeys(base, refs.slice(0, 2), { dValue: 1, dBeat: 0.5 });
    expect(ch(r.seq, "b")[0]).toMatchObject({ beat: 1.5, value: 11 });
    expect(r.refs.map((x) => x.beat)).toEqual([1.5, 1.5]);
  });
  it("absolute beat, clamped at 0, and tangents stay collinear", () => {
    const r = setKeys(base, [{ trackId: "C", channelId: "a", beat: 5 }], { beat: 3, dValue: 0, value: 4 });
    const key = ch(r.seq, "a").find((x: any) => x.beat === 3);
    expect(key.value).toBe(4);
    expect(key.tan.inDy).toBeCloseTo(-key.tan.outDy);
    expect(setKeys(base, refs.slice(1, 2), { dBeat: -9 }).seq.tracks[0]).toMatchObject({ channels: [{}, { keys: [{ beat: 0 }] }] });
  });
  it("is one undo entry", () => {
    const h = new History(base);
    h.apply("set", (s) => setKeys(s, refs, { value: 3, dBeat: 1 }).seq);
    expect(h.undo()).toBe(true);
    expect(h.canUndo).toBe(false);
    expect(h.seq).toBe(base);
  });
});
