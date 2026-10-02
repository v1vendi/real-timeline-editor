import { describe, expect, it } from "vitest";
import type { Section, Sequence } from "../src/core/model";
import { childToParent, danglingRefs, findCycle, parentToChild, wouldCreateCycle } from "../src/core/nested";

const sec = (ref?: string, extra: Partial<Section> = {}): Section =>
  ({ id: "s", start: 4, length: 8, row: 0, ...(ref ? { ref: { sequenceId: ref } } : {}), ...extra });
const seq = (id: string, refs: string[] = [], library: Record<string, Sequence> = {}): Sequence => ({
  version: 1, id, name: id, length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library,
  tracks: [{ id: "t", name: "t", kind: "sections", sections: refs.map((r) => sec(r)) }],
});

describe("time transform", () => {
  it("applies offset and scale", () => {
    expect(parentToChild(sec(undefined, { offset: 2, scale: 2 }), 5, 16)).toBe(4);
  });
  it("wraps when looping, including negatives", () => {
    const s = sec("c", { offset: 0 });
    s.ref!.loop = true;
    expect(parentToChild(s, 4 + 18, 16)).toBe(2);
    expect(parentToChild(s, 3, 16)).toBe(15);
  });
  it("does not wrap without loop", () => {
    expect(parentToChild(sec("c"), 4 + 18, 16)).toBe(18);
  });
  it("inverts", () => {
    const s = sec(undefined, { offset: 2, scale: 2 });
    expect(childToParent(s, parentToChild(s, 7, 16))).toBe(7);
    expect(childToParent(sec(undefined, { scale: 0 }), 1)).toBeNull();
  });
});

describe("cycles", () => {
  const lib = { a: seq("a", ["b"]), b: seq("b") };
  const root = seq("root", ["a"], lib);
  it("accepts DAGs and detects cycles", () => {
    expect(findCycle(root)).toBeNull();
    lib.b = seq("b", ["a"]);
    expect(findCycle(root)).toEqual(["a", "b", "a"]);
  });
  it("wouldCreateCycle", () => {
    const r = seq("root", ["a"], { a: seq("a", ["b"]), b: seq("b") });
    expect(wouldCreateCycle(r, "b", "a")).toBe(true);
    expect(wouldCreateCycle(r, "a", "a")).toBe(true);
    expect(wouldCreateCycle(r, "b", "root")).toBe(true);
    expect(wouldCreateCycle(r, "a", "b")).toBe(false);
  });
  it("reports dangling refs", () => {
    expect(danglingRefs(seq("root", ["x"]))).toEqual(["x"]);
  });
});
