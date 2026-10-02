import { describe, expect, it } from "vitest";
import type { ChannelTrack, Sequence } from "../src/core/model";
import { groupSummary, moveGroupKeys, setGroup } from "../src/edit/groups";
import { parseSequence, serializeSequence, validateSequence } from "../src/core/serialize";

const k = (beat: number, value = 0) => ({ beat, value, interp: "linear" as const });
const track: ChannelTrack = { id: "T", name: "t", kind: "channels", channels: [
  { id: "r", name: "r", keys: [k(0), k(2, 1)] }, { id: "g", name: "g", keys: [k(2, 5)] }, { id: "x", name: "x", keys: [k(2, 9)] },
] };
const base: Sequence = { version: 1, id: "s", name: "s", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {}, tracks: [track] };
const grp = { id: "G", name: "rgb", kind: "color", channelIds: ["r", "g", "nope"] };
const chans = (s: Sequence) => (s.tracks[0] as ChannelTrack).channels;

describe("channel groups", () => {
  const s = setGroup(base, "T", grp);
  it("setGroup drops unknown channels and replaces by id", () => {
    expect((s.tracks[0] as ChannelTrack).groups![0]!.channelIds).toEqual(["r", "g"]);
    expect((setGroup(s, "T", { ...grp, name: "n" }).tracks[0] as ChannelTrack).groups).toHaveLength(1);
  });
  it("summary is the union of beats", () => {
    const t = s.tracks[0] as ChannelTrack;
    expect(groupSummary(t, t.groups![0]!)).toEqual([
      { beat: 0, channelIds: ["r"], full: false }, { beat: 2, channelIds: ["r", "g"], full: true }]);
  });
  it("moves only member channels' keys at that beat together", () => {
    const m = moveGroupKeys(s, "T", "G", 2, 1, 10);
    expect(chans(m).map((c) => c.keys.map((x) => [x.beat, x.value]))).toEqual([[[0, 0], [3, 11]], [[3, 15]], [[2, 9]]]);
    expect(moveGroupKeys(s, "T", "G", 7, 1)).toBe(s);
    expect(moveGroupKeys(s, "T", "nope", 2, 1)).toBe(s);
  });
  it("round-trips and validates", () => {
    expect(validateSequence(s)).toEqual([]);
    const bad = setGroup(base, "T", grp);
    (bad.tracks[0] as ChannelTrack).groups![0]!.channelIds.push("zzz");
    expect(validateSequence(bad).length).toBeGreaterThan(0);
    expect(parseSequence(serializeSequence(s))).toEqual(s);
  });
});
