import { describe, expect, it } from "vitest";
import type { Track } from "../src/core/model";
import { expandableIds, flattenRows, laneAtY, rowAtY, toggleExpanded, visibleRowRange } from "../src/core/rows";

const sec = (id: string, row: number) => ({ id, start: 0, length: 1, row });
const tracks: Track[] = [
  { id: "f", name: "F", kind: "folder", children: [
    { id: "c", name: "C", kind: "channels", channels: [{ id: "a", name: "a", keys: [] }, { id: "b", name: "b", keys: [] }] },
  ] },
  { id: "s", name: "S", kind: "sections", sections: [sec("x", 0), sec("y", 2)] },
  { id: "e", name: "E", kind: "folder", children: [] },
];
const m = { trackH: 10, channelH: 4 };

describe("flattenRows", () => {
  it("collapsed: top-level only, section track grows to max lane", () => {
    const l = flattenRows({ tracks }, new Set(), m);
    expect(l.rows.map((r) => [r.id, r.y, r.h])).toEqual([["f", 0, 10], ["s", 10, 30], ["e", 40, 10]]);
    expect(l.totalHeight).toBe(50);
    expect(l.rows[2]!.expandable).toBe(false);
  });

  it("expanded: folder children then channel rows, with depth", () => {
    let ex = toggleExpanded(new Set(), "f");
    ex = toggleExpanded(ex, "c");
    const l = flattenRows({ tracks }, ex, m);
    expect(l.rows.map((r) => [r.id, r.depth, r.y])).toEqual([
      ["f", 0, 0], ["c", 1, 10], ["c/a", 2, 20], ["c/b", 2, 24], ["s", 0, 28], ["e", 0, 58],
    ]);
    expect([...l.ys]).toEqual([0, 10, 20, 24, 28, 58, 68]);
    expect(expandableIds(tracks)).toEqual(["f", "c"]);
  });

  it("toggleExpanded is immutable", () => {
    const a = new Set<string>();
    expect(toggleExpanded(a, "f").has("f")).toBe(true);
    expect(a.size).toBe(0);
    expect(toggleExpanded(new Set(["f"]), "f").has("f")).toBe(false);
  });
});

describe("rowAtY", () => {
  const l = flattenRows({ tracks }, new Set(["f", "c"]), m);
  it("hits boundaries", () => {
    expect(rowAtY(l, 0)?.id).toBe("f");
    expect(rowAtY(l, 9.9)?.id).toBe("f");
    expect(rowAtY(l, 10)?.id).toBe("c");
    expect(rowAtY(l, 25)?.id).toBe("c/b");
    expect(rowAtY(l, 67.9)?.id).toBe("e");
  });
  it("misses outside", () => {
    expect(rowAtY(l, -1)).toBeUndefined();
    expect(rowAtY(l, 68)).toBeUndefined();
    expect(rowAtY(flattenRows({ tracks: [] }), 0)).toBeUndefined();
  });
  it("visibleRowRange and laneAtY", () => {
    expect(visibleRowRange(l, 12, 26)).toEqual([1, 4]);
    expect(visibleRowRange(l, -50, 1000)).toEqual([0, 6]);
    expect(visibleRowRange(l, 100, 200)).toEqual([0, 0]);
    const s = rowAtY(l, 35)!;
    expect(laneAtY(s, 35, m)).toBe(0);
    expect(laneAtY(s, 50, m)).toBe(2);
    expect(laneAtY(s, 57, m)).toBe(2);
  });
});
