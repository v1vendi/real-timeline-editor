import { describe, expect, it } from "vitest";
import { applyWheel, clampScrollY, frameRange } from "../src/view/navigation";
import { beatToX, defaultViewState, xToBeat } from "../src/view/viewState";

describe("navigation math", () => {
  it("frameRange fits range with 5% padding", () => {
    const v = frameRange(defaultViewState(), 10, 30, 1100);
    expect(beatToX(v, 10)).toBeCloseTo(50);
    expect(beatToX(v, 30)).toBeCloseTo(1050);
  });
  it("frameRange centers when zoom-limited", () => {
    const v = frameRange(defaultViewState(), 10, 10, 1000);
    expect(xToBeat(v, 500)).toBeCloseTo(10);
    expect(v.pxPerBeat).toBe(2000);
  });
  it("clampScrollY", () => {
    expect(clampScrollY(-5, 500, 200)).toBe(0);
    expect(clampScrollY(999, 500, 200)).toBe(300);
    expect(clampScrollY(50, 100, 200)).toBe(0);
  });
  it("ctrl+wheel zooms about the cursor", () => {
    const v = { ...defaultViewState(), startBeat: 4 };
    const before = xToBeat(v, 300);
    const z = applyWheel(v, { deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: true, metaKey: false, shiftKey: false }, 300, 1000, { w: 800, h: 400 });
    expect(z.pxPerBeat).toBeGreaterThan(v.pxPerBeat);
    expect(xToBeat(z, 300)).toBeCloseTo(before);
  });
  it("plain wheel scrolls y clamped, shift pans x", () => {
    const v = defaultViewState();
    const vp = { w: 800, h: 400 };
    const base = { deltaX: 0, deltaMode: 0, ctrlKey: false, metaKey: false };
    expect(applyWheel(v, { ...base, deltaY: 900, shiftKey: false }, 0, 500, vp).scrollY).toBe(100);
    expect(applyWheel(v, { ...base, deltaY: 120, shiftKey: true }, 0, 500, vp).startBeat).toBeCloseTo(2);
  });
});
