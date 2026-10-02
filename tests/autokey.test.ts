import { describe, expect, it } from "vitest";
import type { Sequence } from "../src/core/model";
import { History } from "../src/edit/history";
import { applyValueAtTime, setValueAtTime } from "../src/edit/autokey";

const base: Sequence = {
  version: 1, id: "s", name: "s", length: 64, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [
    { id: "C", name: "c", kind: "channels", channels: [{ id: "ch", name: "ch", keys: [{ beat: 0, value: 0, interp: "constant" }] }] },
    { id: "L", name: "l", kind: "channels", locked: true, channels: [{ id: "ch", name: "ch", keys: [] }] },
  ],
};
const ref = { trackId: "C", channelId: "ch" };
const keys = (s: Sequence) => (s.tracks[0] as { channels: { keys: unknown[] }[] }).channels[0]!.keys;

describe("setValueAtTime", () => {
  it("creates with previous interp, updates in place, respects autoKey/locked", () => {
    let s = setValueAtTime(base, ref, 2, 5);
    expect(keys(s)).toEqual([{ beat: 0, value: 0, interp: "constant" }, { beat: 2, value: 5, interp: "constant" }]);
    s = setValueAtTime(s, ref, 2, 7, { interp: "bezier" });
    expect(keys(s)[1]).toEqual({ beat: 2, value: 7, interp: "constant" });
    expect(setValueAtTime(s, ref, 2, 7)).toBe(s);
    expect(setValueAtTime(base, ref, 3, 1, { autoKey: false })).toBe(base);
    expect(setValueAtTime(base, { trackId: "L", channelId: "ch" }, 1, 1)).toBe(base);
    expect(keys(setValueAtTime(base, ref, 1, 1, { interp: "linear" }))[1]).toMatchObject({ interp: "linear" });
  });
  it("coalesces repeated drags into one history entry", () => {
    let t = 0;
    const h = new History(base, { now: () => (t += 10) });
    for (const v of [1, 2, 3]) applyValueAtTime(h, ref, 4, v);
    expect(h.past.length).toBe(1);
    expect(keys(h.seq)[1]).toMatchObject({ value: 3 });
    h.undo();
    expect(h.seq).toBe(base);
  });
});
