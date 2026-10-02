import { describe, expect, it } from "vitest";
import type { ChannelTrack, Sequence } from "../src/core/model";
import { addChannel, removeChannel, removeTrack, findTrack } from "../src/edit/commands";

const ch = (id: string) => ({ id, name: id, keys: [{ beat: 0, value: 1, interp: "linear" as const }] });
const T = (locked = false): ChannelTrack => ({ id: "T", name: "t", kind: "channels", locked, channels: [ch("a"), ch("b")], groups: [{ id: "G", name: "g", channelIds: ["a"] }, { id: "H", name: "h", channelIds: ["a", "b"] }] });
const seq = (t: ChannelTrack): Sequence => ({ version: 1, id: "s", name: "s", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [{ id: "F", name: "f", kind: "folder", children: [t] }, { id: "E", name: "e", kind: "events", events: [] }] });
const tr = (s: Sequence) => findTrack(s.tracks, "T") as ChannelTrack;

describe("addChannel / removeChannel / removeTrack", () => {
  it("adds (index, dup ignored) and removes with group cleanup", () => {
    const s = seq(T());
    const a = addChannel(s, "T", ch("c"), 1);
    expect(tr(a).channels.map((c) => c.id)).toEqual(["a", "c", "b"]);
    expect(addChannel(a, "T", ch("c"))).toBe(a);
    const r = removeChannel(s, "T", "a");
    expect(tr(r).channels.map((c) => c.id)).toEqual(["b"]);
    expect(tr(r).groups).toEqual([{ id: "H", name: "h", channelIds: ["b"] }]);
    expect(tr(removeChannel(r, "T", "b")).groups).toBeUndefined();
    expect(removeChannel(s, "T", "zz")).toBe(s);
  });
  it("locked tracks refuse; removeTrack finds nested tracks", () => {
    const s = seq(T(true));
    expect(addChannel(s, "T", ch("c"))).toBe(s);
    expect(removeChannel(s, "T", "a")).toBe(s);
    expect(removeTrack(s, "T")).toBe(s);
    const u = seq(T());
    expect(findTrack(removeTrack(u, "T").tracks, "T")).toBeUndefined();
    expect(removeTrack(u, "E").tracks).toHaveLength(1);
    expect(removeTrack(u, "nope")).toBe(u);
  });
});
