import { describe, expect, it } from "vitest";
import type { Sequence } from "../src/core/model";
import { History } from "../src/edit/history";
import { applyBindSelected, applyRetarget, brokenTrackIds, retargetBinding, setTrackBinding } from "../src/edit/binding";
import { parseSequence as parse, serializeSequence as serialize } from "../src/core/serialize";

const base: Sequence = {
  version: 1, id: "s", name: "s", length: 64, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [
    { id: "A", name: "a", kind: "channels", binding: { targetId: "x" }, channels: [] },
    { id: "F", name: "f", kind: "folder", children: [{ id: "B", name: "b", kind: "events", binding: { targetId: "x" }, events: [] }] },
    { id: "C", name: "c", kind: "events", events: [] },
  ],
};

describe("binding", () => {
  it("sets, clears, no-ops", () => {
    const s = setTrackBinding(base, "C", "y");
    expect(s.tracks[2]!.binding).toEqual({ targetId: "y" });
    expect(setTrackBinding(s, "C", "y")).toBe(s);
    expect(setTrackBinding(s, "C", null).tracks[2]!.binding).toBeUndefined();
    expect(setTrackBinding(base, "C", null)).toBe(base);
    expect(setTrackBinding(base, "nope", "y")).toBe(base);
    expect(setTrackBinding(base, "B", "z")).not.toBe(base);
  });
  it("retargets nested tracks and reports broken", () => {
    const s = retargetBinding(base, "x", "y");
    expect(brokenTrackIds(s, (id) => id === "y").size).toBe(0);
    expect([...brokenTrackIds(base, (id) => id === "y")].sort()).toEqual(["A", "B"]);
    expect(retargetBinding(base, "q", "y")).toBe(base);
  });
  it("history commands undo", () => {
    const h = new History(base);
    applyRetarget(h, "x", "y");
    applyBindSelected(h, ["C"], "y");
    expect(brokenTrackIds(h.seq, (id) => id === "y").size).toBe(0);
    h.undo(); h.undo();
    expect(h.seq).toBe(base);
  });
  it("round-trips and validates", () => {
    expect(parse(serialize(base))).toEqual(base);
    const bad = JSON.parse(serialize(base));
    bad.tracks[0].binding = { targetId: 3 };
    expect(() => parse(JSON.stringify(bad))).toThrow();
  });
});
