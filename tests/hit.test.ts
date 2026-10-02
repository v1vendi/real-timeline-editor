import { describe, expect, it } from "vitest";
import { flattenRows } from "../src/core/rows";
import { cursorFor, hitTest, nearestKeyIndex } from "../src/view/hit";
import type { Sequence } from "../src/core/model";

const key = (beat: number) => ({ beat, value: 0, interp: "linear" as const });
const seq = {
  tracks: [
    { id: "s", kind: "sections", name: "s", sections: [
      { id: "a", start: 0, length: 4, row: 0 },
      { id: "b", start: 2, length: 4, row: 1 },
    ] },
    { id: "c", kind: "channels", name: "c", channels: [{ id: "x", name: "x", keys: [key(1), key(1.05), key(5)] }] },
    { id: "u", kind: "audio", name: "u", clips: [{ id: "clip", start: 0, length: 2, offset: 0 }] },
  ],
} as unknown as Sequence;
const view = { startBeat: 0, pxPerBeat: 100, scrollY: 0 };
// rows: s = 56 high (2 lanes), c = 28 (collapsed), u = 28
const collapsed = flattenRows(seq);
const expanded = flattenRows(seq, new Set(["c"]));

describe("hitTest", () => {
  it("none outside rows", () => {
    expect(hitTest(collapsed, view, 10, -1).kind).toBe("none");
    expect(hitTest(collapsed, view, 10, 9999).kind).toBe("none");
  });
  it("section zones and lanes", () => {
    expect(hitTest(collapsed, view, 200, 10)).toMatchObject({ kind: "section", sectionId: "a", zone: "body", lane: 0 });
    expect(hitTest(collapsed, view, 3, 10)).toMatchObject({ zone: "edgeStart" });
    expect(hitTest(collapsed, view, 398, 10)).toMatchObject({ zone: "edgeEnd" });
    expect(hitTest(collapsed, view, 400, 40)).toMatchObject({ sectionId: "b", lane: 1, zone: "body" });
    expect(hitTest(collapsed, view, 100, 40).kind).toBe("row"); // lane 1 empty at beat 1
  });
  it("keys: nearest within px tolerance, expanded and collapsed", () => {
    expect(hitTest(expanded, view, 105, 56 + 28 + 5)).toMatchObject({ kind: "key", keyIndex: 1 });
    expect(hitTest(expanded, view, 500, 56 + 28 + 5)).toMatchObject({ kind: "key", keyIndex: 2 });
    expect(hitTest(expanded, view, 300, 56 + 28 + 5).kind).toBe("row");
    expect(hitTest(collapsed, view, 100, 56 + 5)).toMatchObject({ kind: "key", channelId: "x", keyIndex: 0 });
  });
  it("audio clip", () => {
    expect(hitTest(collapsed, view, 100, 56 + 28 + 5)).toMatchObject({ kind: "clip", zone: "body" });
  });
  it("cursor", () => {
    expect(cursorFor(hitTest(collapsed, view, 200, 10))).toBe("move");
    expect(cursorFor(hitTest(collapsed, view, 3, 10))).toBe("ew-resize");
    expect(cursorFor(hitTest(collapsed, view, 100, 56 + 5))).toBe("pointer");
    expect(cursorFor({ kind: "none" })).toBe("default");
  });
  it("nearestKeyIndex", () => {
    expect(nearestKeyIndex([], 1, 1)).toBe(-1);
    expect(nearestKeyIndex([key(1), key(2)], 1.6, 0.5)).toBe(1);
  });
});

describe("handle hits", () => {
  const bez = (beat: number, value: number) => ({ beat, value, interp: "bezier" as const });
  const hs = {
    tracks: [
      { id: "s", kind: "sections", name: "s", sections: [{ id: "a", start: 1, length: 4, row: 0, easeIn: 1, easeOut: 0.5 }] },
      { id: "c", kind: "channels", name: "c", channels: [{ id: "x", name: "x", keys: [bez(0, 0), bez(3, 0)] }] },
    ],
  } as unknown as Sequence;
  const lay = flattenRows(hs, new Set(["c"]));
  const curve = { valueToY: (v: number) => 56 + 11 - v * 10, isKeySelected: (_c: string, i: number) => i === 0 };
  it("tangent handle of a selected key, in front of the key", () => {
    // key 0 auto handles: out dx = 1 beat (100px), dy 0
    expect(hitTest(lay, view, 100, 67, { curve })).toMatchObject({ kind: "tangent", keyIndex: 0, side: "out" });
    expect(hitTest(lay, view, 300, 67, { curve }).kind).not.toBe("tangent"); // key 1 unselected
    expect(hitTest(lay, view, 100, 67).kind).toBe("row"); // no curve option
  });
  it("ease handles on the lane's top corners", () => {
    expect(hitTest(lay, view, 200, 1)).toMatchObject({ kind: "ease", sectionId: "a", side: "in" });
    expect(hitTest(lay, view, 450, 1)).toMatchObject({ kind: "ease", side: "out" });
    expect(hitTest(lay, view, 200, 20)).toMatchObject({ kind: "section" });
    expect(cursorFor(hitTest(lay, view, 200, 1))).toBe("ew-resize");
  });
});

import { curveTargetOf } from "../src/view/hit";
describe("curveTargetOf (double-click opens the curve editor)", () => {
  it("empty expanded channel row and key hits resolve to the channel; other rows do not", () => {
    expect(curveTargetOf(hitTest(expanded, view, 300, 56 + 28 + 5))).toEqual({ trackId: "c", channelId: "x" });
    expect(curveTargetOf(hitTest(expanded, view, 105, 56 + 28 + 5))).toEqual({ trackId: "c", channelId: "x" });
    expect(curveTargetOf(hitTest(collapsed, view, 200, 10))).toBeUndefined();
    expect(curveTargetOf({ kind: "none" })).toBeUndefined();
  });
});
describe("curveTargetOf collapsed track", () => {
  it("empty spot on a collapsed channels track opens all its channels", () => {
    expect(curveTargetOf(hitTest(collapsed, view, 300, 56 + 5))).toEqual({ trackId: "c" });
  });
});

import { colorPickTargetOf } from "../src/view/hit";
describe("colorPickTargetOf (double-click opens the color picker)", () => {
  const cseq = {
    tracks: [{ id: "col", kind: "channels", name: "col", channels: ["r", "g", "b"].map((id) => ({ id, name: id, keys: [key(2)] })), groups: [{ id: "g1", name: "g", kind: "rgb", channelIds: ["r", "g", "b"] }] },
      { id: "plain", kind: "channels", name: "p", channels: [{ id: "x", name: "x", keys: [] }] }],
  } as unknown as Sequence;
  const col = flattenRows(cseq), colOpen = flattenRows(cseq, new Set(["col"]));
  it("stop mark gives its beat, strip elsewhere the pointer beat, expanded track row too", () => {
    expect(colorPickTargetOf(hitTest(col, view, 203, 10))).toEqual({ trackId: "col", groupId: "g1", beat: 2 });
    expect(colorPickTargetOf(hitTest(col, view, 450, 10))).toEqual({ trackId: "col", groupId: "g1", beat: 4.5 });
    expect(colorPickTargetOf(hitTest(colOpen, view, 450, 10))).toEqual({ trackId: "col", groupId: "g1", beat: 4.5 });
  });
  it("non-color rows and other hits: undefined", () => {
    expect(colorPickTargetOf(hitTest(col, view, 450, 28 + 10))).toBeUndefined();
    expect(colorPickTargetOf(hitTest(colOpen, view, 450, 28 + 5))).toBeUndefined(); // expanded channel row
    expect(colorPickTargetOf({ kind: "none" })).toBeUndefined();
  });
});
