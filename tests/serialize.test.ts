import { describe, expect, it } from "vitest";
import type { Sequence } from "../src/core/model";
import { parseSequence, serializeSequence, SequenceFormatError, validateSequence } from "../src/core/serialize";

const empty = (id: string): Sequence => ({
  version: 1, id, name: id, length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], tracks: [], markers: [], library: {},
});
const sample = (): Sequence => {
  const s = empty("root");
  s.markers.push({ id: "m1", beat: 4, label: "drop" });
  s.tracks.push(
    { id: "t1", kind: "channels", name: "dim", channels: [{ id: "c1", name: "a", keys: [{ beat: 0, value: 0, interp: "linear" }, { beat: 2, value: 1, interp: "bezier", tan: { mode: "auto", inDx: 0, inDy: 0, outDx: 0, outDy: 0 } }] }] },
    { id: "f", kind: "folder", name: "f", children: [{ id: "t2", kind: "sections", name: "s", sections: [{ id: "s1", start: 0, length: 4, row: 0, ref: { sequenceId: "child" }, data: { b: 1, a: 2 } }] }] },
    { id: "t3", kind: "audio", name: "au", clips: [{ id: "a1", start: 0, length: 8, offset: 0 }] },
  );
  s.library.child = empty("child");
  return s;
};

describe("serialize", () => {
  it("round-trips with stable output", () => {
    const seq = sample();
    const text = serializeSequence(seq);
    expect(parseSequence(text)).toEqual(seq);
    expect(serializeSequence(parseSequence(text))).toBe(text);
  });

  it("orders keys deterministically regardless of input order", () => {
    const seq = sample();
    const shuffled = JSON.parse(JSON.stringify(seq), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(serializeSequence(shuffled)).toBe(serializeSequence(seq));
    expect(serializeSequence(seq).startsWith('{"version":1,"id":"root"')).toBe(true);
  });

  it("rejects bad documents", () => {
    const fail = (mut: (s: Sequence) => void, re: RegExp) => {
      const s = sample();
      mut(s);
      expect(validateSequence(s).join("\n")).toMatch(re);
      expect(() => parseSequence(JSON.stringify(s))).toThrow(SequenceFormatError);
    };
    fail((s) => { s.markers.push({ id: "t1", beat: 0, label: "" }); }, /duplicate id "t1"/);
    fail((s) => { s.length = 0.1234; }, /not quantized/);
    fail((s) => { (s.tracks[0] as { channels: { keys: { beat: number }[] }[] }).channels[0]!.keys[1]!.beat = 0; }, /sorted and unique/);
    fail((s) => { s.library.child!.tracks.push({ id: "x", kind: "sections", name: "", sections: [{ id: "sx", start: 0, length: 1, row: 0, ref: { sequenceId: "root" } }] }); }, /cycle/);
    fail((s) => { delete s.library.child; }, /dangling/);
    fail((s) => { s.library.child!.id = "other"; }, /does not match/);
  });

  it("rejects bad JSON and versions", () => {
    expect(() => parseSequence("{")).toThrow(/not valid JSON/);
    expect(() => parseSequence({ ...sample(), version: 2 })).toThrow(/newer/);
    expect(() => parseSequence({ ...sample(), version: 0 })).toThrow(/no migration/);
  });
});
