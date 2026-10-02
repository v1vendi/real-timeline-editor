import { describe, expect, it } from "vitest";
import { gridProvider, markerProvider, playheadProvider, resolveSnap, sectionEdgeProvider, type SnapContext } from "../src/core/snap";
import type { Sequence } from "../src/core/model";

const ctx = (beat: number, pxPerBeat = 100, exclude?: Set<string>): SnapContext =>
  ({ beat, pxPerBeat, beatsPerBar: 4, range: [0, 100], exclude });
const seq = {
  markers: [{ id: "m", beat: 2.05, label: "" }],
  tracks: [{ id: "t", name: "", kind: "sections", sections: [{ id: "s", start: 2, length: 1, row: 0 }] }],
} as unknown as Sequence;

describe("snap", () => {
  it("snaps within threshold, not beyond", () => {
    expect(resolveSnap([gridProvider], ctx(1.05))?.beat).toBe(1);
    expect(resolveSnap([playheadProvider(() => 1)], ctx(1.09))).toBeNull();
  });
  it("threshold is pixels: wider in beats when zoomed out", () => {
    const p = [playheadProvider(() => 10)];
    expect(resolveSnap(p, ctx(10.5, 10))?.kind).toBe("playhead");
    expect(resolveSnap(p, ctx(10.5, 100))).toBeNull();
  });
  it("disabled (Alt) returns null", () => {
    expect(resolveSnap([gridProvider], ctx(1.01), { disabled: true })).toBeNull();
  });
  it("nearest wins, equal distance goes to priority", () => {
    const ps = [gridProvider, markerProvider(seq), sectionEdgeProvider(seq)];
    expect(resolveSnap(ps, ctx(2.04))?.kind).toBe("marker");
    const tie = [gridProvider, playheadProvider(() => 3)];
    expect(resolveSnap(tie, ctx(3))?.kind).toBe("playhead");
  });
  it("excludes dragged ids", () => {
    const ps = [sectionEdgeProvider(seq), markerProvider(seq)];
    expect(resolveSnap(ps, ctx(3.02), { })?.id).toBe("s");
    expect(resolveSnap(ps, ctx(3.02, 100, new Set(["s"])))).toBeNull();
  });
});

describe("grid provider modes", () => {
  it("snaps to triplet steps", () => {
    const t = gridProvider({ ...ctx(0.3), gridMode: "triplet" })[0]!;
    expect(t.beat).toBeCloseTo(1 / 3);
  });
});

describe("keyProvider range", () => {
  it("returns only keys inside the range, in order, honouring excludeKey", async () => {
    const { keyProvider } = await import("../src/core/snap");
    const keys = Array.from({ length: 100 }, (_, i) => ({ beat: i, value: 0, interp: "linear" as const }));
    const s = { tracks: [{ id: "t", name: "", kind: "channels", channels: [{ id: "c", name: "", keys }] }] } as unknown as Sequence;
    const at = (range: [number, number], ex?: (c: string, b: number) => boolean) => keyProvider(s, ex)({ ...ctx(0), range }).map((t) => t.beat);
    expect(at([10, 13])).toEqual([10, 11, 12, 13]);
    expect(at([-5, 1])).toEqual([0, 1]);
    expect(at([98.5, 500])).toEqual([99]);
    expect(at([10, 13], (_c, b) => b === 11)).toEqual([10, 12, 13]);
  });
});
