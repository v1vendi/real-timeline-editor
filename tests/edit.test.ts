import { describe, expect, it } from "vitest";
import type { Sequence } from "../src/core/model";
import { History } from "../src/edit/history";
import { addKey, addSection, deleteKeys, deleteSection, moveKeys, moveSection, trimSection } from "../src/edit/commands";
import { emptySelection, keyId, pruneSelection, select } from "../src/edit/selection";

const base: Sequence = {
  version: 1, id: "s", name: "s", length: 64, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [
    { id: "T", name: "t", kind: "sections", sections: [] },
    { id: "L", name: "l", kind: "sections", locked: true, sections: [] },
    { id: "C", name: "c", kind: "channels", channels: [{ id: "ch", name: "ch", keys: [] }] },
  ],
};
const sec = { id: "a", start: 1, length: 4 };
const key = (beat: number) => ({ beat, value: beat, interp: "linear" as const });

describe("edit commands", () => {
  it("adds, moves (clamped, quantized) and trims with offset shift", () => {
    let s = addSection(base, "T", sec);
    s = moveSection(s, "T", "a", -3);
    expect(s.tracks[0]).toMatchObject({ sections: [{ start: 0 }] });
    s = trimSection(s, "T", "a", "start", 1);
    expect(s.tracks[0]).toMatchObject({ sections: [{ start: 1, length: 3, offset: 1 }] });
    expect(trimSection(s, "T", "a", "end", 0.99).tracks[0]).toMatchObject({ sections: [{ length: 1 / 16 }] });
  });
  it("rejects locked tracks and shares structure", () => {
    expect(addSection(base, "L", sec)).toBe(base);
    const s = addSection(base, "T", sec);
    expect(s.tracks[2]).toBe(base.tracks[2]);
  });
  it("keys stay sorted; moves collide by replacing", () => {
    let s = [key(1), key(2), key(3)].reduce((q, k) => addKey(q, "C", "ch", k), base);
    s = moveKeys(s, [{ trackId: "C", channelId: "ch", beat: 1 }], 1);
    expect((s.tracks[2] as any).channels[0].keys.map((k: any) => k.beat)).toEqual([2, 3]);
    s = deleteKeys(s, [{ trackId: "C", channelId: "ch", beat: 2 }]);
    expect((s.tracks[2] as any).channels[0].keys).toHaveLength(1);
  });
});

describe("history", () => {
  it("round-trips undo/redo and a drag is one entry", () => {
    const h = new History(addSection(base, "T", sec));
    h.begin("move");
    for (const b of [2, 3, 4]) h.preview((s) => moveSection(s, "T", "a", b));
    h.commit();
    expect(h.past).toHaveLength(1);
    expect((h.seq.tracks[0] as any).sections[0].start).toBe(4);
    h.undo();
    expect((h.seq.tracks[0] as any).sections[0].start).toBe(1);
    h.redo();
    expect((h.seq.tracks[0] as any).sections[0].start).toBe(4);
  });
  it("cancel restores; nudges merge inside the window", () => {
    let t = 0;
    const h = new History(addSection(base, "T", sec), { now: () => t });
    h.begin("x"); h.preview((s) => moveSection(s, "T", "a", 9)); h.cancel();
    expect((h.seq.tracks[0] as any).sections[0].start).toBe(1);
    h.apply("nudge", (s) => moveSection(s, "T", "a", 2), "nudge");
    t = 100; h.apply("nudge", (s) => moveSection(s, "T", "a", 3), "nudge");
    t = 900; h.apply("nudge", (s) => moveSection(s, "T", "a", 4), "nudge");
    expect(h.past).toHaveLength(2);
  });
});

describe("selection", () => {
  it("replaces/toggles and prunes dangling ids", () => {
    let sel = select(emptySelection, "sections", ["a", "b"]);
    sel = select(sel, "sections", ["b"], "toggle");
    expect([...sel.sections]).toEqual(["a"]);
    const dead = select(sel, "keys", [keyId({ trackId: "C", channelId: "ch", beat: 1 })]);
    const p = pruneSelection(dead, base);
    expect(p.sections.size).toBe(0);
    expect(p.keys.size).toBe(0);
  });
});

import { nestTrack, setHandle } from "../src/edit/commands";
import type { Track } from "../src/core/model";

describe("edit wiring", () => {
  const rows = (s: Sequence) => (s.tracks[0] as any).sections.map((x: any) => [x.id, x.row]);
  it("lanes: add fills first free lane; move/trim/delete re-lane", () => {
    let s = addSection(base, "T", { id: "a", start: 0, length: 4 });
    s = addSection(s, "T", { id: "b", start: 2, length: 4 });
    expect(rows(s)).toEqual([["a", 0], ["b", 1]]);
    expect(rows(moveSection(s, "T", "b", 4))).toEqual([["a", 0], ["b", 0]]);
    expect(rows(trimSection(s, "T", "b", "start", 4))).toEqual([["a", 0], ["b", 0]]);
    s = addSection(s, "T", { id: "c", start: 3, length: 1 });
    expect(rows(deleteSection(s, "T", "a"))).toEqual([["b", 0], ["c", 1]]);
  });
  it("rejects ref cycles", () => {
    const child: Sequence = { ...base, id: "kid", tracks: [{ id: "T", name: "t", kind: "sections", sections: [
      { id: "x", start: 0, length: 1, row: 0, ref: { sequenceId: "s" } }] }] };
    const root = { ...base, library: { kid: child } };
    expect(addSection(root, "T", { id: "r", start: 0, length: 1, ref: { sequenceId: "s" } })).toBe(root);
    expect(addSection(root, "T", { id: "r", start: 0, length: 1, ref: { sequenceId: "kid" } })).toBe(root);
    expect(addSection({ ...base, library: { kid: { ...child, tracks: [] } } }, "T", { id: "r", start: 0, length: 1, ref: { sequenceId: "kid" } }).tracks[0])
      .toMatchObject({ sections: [{ id: "r" }] });
  });
  it("nests and reparents tracks", () => {
    const f: Track = { id: "F", name: "f", kind: "folder", children: [] };
    let s = { ...base, tracks: [...base.tracks, f] };
    s = nestTrack(s, "C", "F");
    expect(s.tracks.map((t) => t.id)).toEqual(["T", "L", "F"]);
    expect((s.tracks[2] as any).children.map((t: Track) => t.id)).toEqual(["C"]);
    expect(nestTrack(s, "F", "F")).toBe(s);
    expect(nestTrack(s, "C", "T")).toBe(s); // not a folder
    expect(nestTrack(s, "L", "F")).toBe(s); // locked
    expect(nestTrack(s, "C", null, 0).tracks.map((t) => t.id)).toEqual(["C", "T", "L", "F"]);
    const deep = nestTrack({ ...s, tracks: [{ id: "G", name: "g", kind: "folder", children: [s.tracks[2]!] }] }, "G", "F");
    expect(deep.tracks[0]!.id).toBe("G"); // folder into own descendant
  });
  it("aligned handles stay collinear", () => {
    const tan = { mode: "aligned" as const, inDx: -1, inDy: -1, outDx: 2, outDy: 2 };
    let s = addKey(base, "C", "ch", { beat: 1, value: 0, interp: "bezier", tan });
    s = setHandle(s, { trackId: "C", channelId: "ch", beat: 1 }, "out", 1, 3);
    let t = (s.tracks[2] as any).channels[0].keys[0].tan;
    expect(t).toMatchObject({ outDx: 1, outDy: 3 });
    expect(t.inDx * 3 - t.inDy * 1).toBeCloseTo(0);
    expect(Math.hypot(t.inDx, t.inDy)).toBeCloseTo(Math.SQRT2);
    s = setHandle(s, { trackId: "C", channelId: "ch", beat: 1 }, "in", -2, 0);
    t = (s.tracks[2] as any).channels[0].keys[0].tan;
    expect(t.outDy).toBeCloseTo(0);
    const m = moveKeys(s, [{ trackId: "C", channelId: "ch", beat: 1 }], 2, 5);
    expect((m.tracks[2] as any).channels[0].keys[0].tan.outDy).toBeCloseTo(0);
  });
});

describe("event selection", () => {
  it("prunes dead event ids and keeps live ones", async () => {
    const { eventId } = await import("../src/edit/selection");
    const seq = { version: 1, length: 8, beatsPerBar: 4, bpm: 120, tracks: [{ id: "e", name: "E", kind: "events", events: [{ id: "a", beat: 1, name: "a" }] }] } as unknown as Parameters<typeof pruneSelection>[1];
    const sel = select(select(emptySelection, "events", [eventId("e", "a")], "add"), "events", [eventId("e", "gone")], "add");
    const p = pruneSelection(sel, seq);
    expect([...p.events]).toEqual([eventId("e", "a")]);
    expect(pruneSelection(p, seq)).toBe(p);
  });
});

import { moveMarker, moveSectionToTrack } from "../src/edit/commands";
describe("marker and event commands", () => {
  const mk = (over: Partial<Sequence> = {}): Sequence => ({ version: 1, id: "r", name: "r", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [{ id: "m", beat: 2, label: "" }], library: {}, tracks: [
    { id: "a", name: "A", kind: "sections", sections: [{ id: "s", start: 1, length: 2, row: 0 }] },
    { id: "b", name: "B", kind: "sections", sections: [{ id: "t", start: 0, length: 4, row: 0 }] },
    { id: "c", name: "C", kind: "sections", locked: true, sections: [] }, { id: "e", name: "E", kind: "events", events: [] },
  ], ...over });
  it("moveMarker clamps and no-ops", () => {
    expect(moveMarker(mk(), "m", -3).markers[0]!.beat).toBe(0);
    const s = mk(); expect(moveMarker(s, "m", 2)).toBe(s); expect(moveMarker(s, "zz", 5)).toBe(s);
  });
  it("moveSectionToTrack moves, lanes on overlap, rejects locked/non-section targets", () => {
    const r = moveSectionToTrack(mk(), "a", "s", "b", 1);
    const [a, b] = r.tracks as unknown as [{ sections: { id: string; row: number }[] }, { sections: { id: string; row: number }[] }];
    expect(a.sections).toHaveLength(0); expect(b.sections.map((x) => `${x.id}${x.row}`).sort()).toEqual(["s1", "t0"]);
    const s = mk(); expect(moveSectionToTrack(s, "a", "s", "c", 1)).toBe(s); expect(moveSectionToTrack(s, "a", "s", "e", 1)).toBe(s);
  });
});

describe("pruneSelection keys", () => {
  it("keeps live keys by exact beat, drops moved/removed ones, same ref when nothing changed", () => {
    const seq = { ...base, tracks: [{ id: "C", name: "c", kind: "channels", channels: [{ id: "ch", name: "ch", keys: [key(1), key(2.5)] }] }] } as Sequence;
    const id = (beat: number, channelId = "ch") => keyId({ trackId: "C", channelId, beat });
    const live = select(emptySelection, "keys", [id(1), id(2.5)], "add");
    expect(pruneSelection(live, seq)).toBe(live);
    const mixed = select(live, "keys", [id(2), id(1, "nope")], "add");
    expect([...pruneSelection(mixed, seq).keys]).toEqual([id(1), id(2.5)]);
  });
});
