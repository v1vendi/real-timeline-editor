import { describe, expect, it } from "vitest";
import type { Sequence, Track } from "../src/core/model";
import { eventsBetween } from "../src/core/events";
import { addEvent, deleteEvent, moveEvent, addTrack } from "../src/edit/commands";
import { parseSequence, serializeSequence } from "../src/core/serialize";
import { eventProvider, resolveSnap } from "../src/core/snap";

const base: Sequence = { version: 1, id: "s", name: "s", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], tracks: [], markers: [], library: {} };
const track: Track = { id: "ev", kind: "events", name: "Events", events: [] };
const mk = () => {
  let s = addTrack(base, track);
  for (const [id, beat] of [["a", 0], ["b", 4], ["c", 8], ["d", 16]] as const) s = addEvent(s, "ev", { id, beat, name: id });
  return s;
};
const ids = (s: Sequence, t0: number, t1: number, loop?: { start: number; end: number }) =>
  eventsBetween(s, t0, t1, { loop }).map((h) => `${h.event.id}${h.pass}`);

describe("events", () => {
  it("half-open spans include endpoint events at t0", () => {
    const s = mk();
    expect(ids(s, 0, 4)).toEqual(["a0"]);
    expect(ids(s, 4, 16)).toEqual(["b0", "c0"]);
    expect(ids(s, 4, 4.0001)).toEqual(["b0"]);
    expect(ids(s, 5, 5)).toEqual([]);
  });
  it("loop wrap reports both segments with pass index", () => {
    const s = mk();
    expect(ids(s, 6, 2, { start: 0, end: 16 })).toEqual(["c0", "d0", "a1"]);
    expect(ids(s, 6, 2)).toEqual([]);
  });
  it("skips muted tracks", () => {
    const s = { ...mk(), tracks: [{ ...track, muted: true, events: [{ id: "x", beat: 1, name: "x" }] }] };
    expect(ids(s, 0, 4)).toEqual([]);
  });
  it("commands quantize, sort, ignore dupes, respect locks", () => {
    let s = mk();
    expect(addEvent(s, "ev", { id: "a", beat: 1, name: "dup" })).toBe(s);
    s = moveEvent(s, "ev", "a", 6.00001);
    expect((s.tracks[0] as any).events.map((e: any) => e.id)).toEqual(["b", "a", "c", "d"]);
    expect(moveEvent(s, "ev", "zz", 1)).toBe(s);
    expect((deleteEvent(s, "ev", "a").tracks[0] as any).events).toHaveLength(3);
    const locked = { ...s, tracks: [{ ...s.tracks[0]!, locked: true } as Track] };
    expect(deleteEvent(locked, "ev", "a")).toBe(locked);
  });
  it("round-trips and validates", () => {
    const s = addEvent(mk(), "ev", { id: "p", beat: 2, name: "p", payload: { z: 1, a: 2 } });
    expect(parseSequence(serializeSequence(s))).toEqual(s);
    const bad = JSON.parse(serializeSequence(s));
    bad.tracks[0].events[0].name = 3;
    expect(() => parseSequence(bad)).toThrow(/event a name/);
  });
  it("snap provider", () => {
    const s = mk();
    const ctx = { pxPerBeat: 40, beatsPerBar: 4, beat: 4.1, range: [0, 16] as [number, number] };
    expect(resolveSnap([eventProvider(s)], ctx)).toMatchObject({ beat: 4, kind: "event", id: "b" });
    expect(resolveSnap([eventProvider(s)], { ...ctx, exclude: new Set(["b"]) })).toBeNull();
  });
});
