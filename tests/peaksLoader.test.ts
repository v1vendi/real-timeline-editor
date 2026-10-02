import { describe, expect, it, vi } from "vitest";
import { lazyPeaks } from "../src/core/peaksLoader";
import { resolveSequence } from "../src/core/nested";
import type { Sequence } from "../src/core/model";

const mips = { levels: [] } as never;
const seq = (id: string, library: Record<string, Sequence> = {}): Sequence =>
  ({ version: 1, id, name: id, length: 4, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], tracks: [], library });

describe("lazyPeaks", () => {
  it("asks the hook once per id, sync results included", () => {
    const hook = vi.fn(() => mips);
    const p = lazyPeaks(hook, () => {});
    expect(p.get("a")).toBe(mips); expect(p.get("a")).toBe(mips);
    expect(hook).toHaveBeenCalledTimes(1);
  });
  it("resolves promises later and notifies", async () => {
    const onLoad = vi.fn();
    const p = lazyPeaks(() => Promise.resolve(mips), onLoad);
    expect(p.get("a")).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(onLoad).toHaveBeenCalledWith("a");
    expect(p.get("a")).toBe(mips);
  });
  it("caches failures and ignores stale loads after reset", async () => {
    const onLoad = vi.fn();
    const p = lazyPeaks(() => Promise.resolve(mips), onLoad);
    p.get("a"); p.reset();
    await new Promise((r) => setTimeout(r, 0));
    expect(onLoad).not.toHaveBeenCalled();
    const bad = lazyPeaks(() => { throw new Error("x"); }, onLoad);
    expect(bad.get("z")).toBeUndefined();
  });
});

describe("resolveSequence host fallback", () => {
  it("prefers root and library, then host", () => {
    const child = seq("c"), hosted = seq("h");
    const root = seq("r", { c: child });
    const host = (id: string) => (id === "h" ? hosted : undefined);
    expect(resolveSequence(root, "r", host)).toBe(root);
    expect(resolveSequence(root, "c", host)).toBe(child);
    expect(resolveSequence(root, "h", host)).toBe(hosted);
    expect(resolveSequence(root, "h")).toBeUndefined();
    expect(resolveSequence(root, "toString", host)).toBeUndefined();
  });
});
