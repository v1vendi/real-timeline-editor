import { describe, expect, it } from "vitest";
import { attachScrub } from "../src/view/ruler";

type Handler = (e: any) => void;
function fakeRuler() {
  const h = new Map<string, Handler>();
  const el: any = {
    addEventListener: (t: string, f: Handler) => h.set(t, f),
    removeEventListener: (t: string) => h.delete(t),
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: () => {},
  };
  const fire = (t: string, x: number, shift = true) =>
    h.get(t)?.({ button: 0, clientX: x, clientY: 5, pointerId: 1, shiftKey: shift, altKey: false });
  return { el, fire, handlers: h };
}

describe("ruler Shift+drag work range", () => {
  const view: any = { startBeat: 0, pxPerBeat: 100 };
  const setup = () => {
    const r = fakeRuler();
    const ranges: any[] = [];
    const seeks: number[] = [];
    attachScrub(r.el, () => view, { beatsPerBar: 4, onRange: (x) => ranges.push(x) }, (b) => seeks.push(b));
    return { ...r, ranges, seeks };
  };

  it("drag sets a looping range, never seeks", () => {
    const t = setup();
    t.fire("pointerdown", 100);
    t.fire("pointermove", 300);
    t.fire("pointerup", 300);
    expect(t.seeks).toEqual([]);
    expect(t.ranges.at(-1)).toEqual({ start: 1, end: 3, loop: true });
  });

  it("dragging leftwards orders start/end", () => {
    const t = setup();
    t.fire("pointerdown", 400);
    t.fire("pointermove", 200);
    t.fire("pointerup", 200);
    expect(t.ranges.at(-1)).toEqual({ start: 2, end: 4, loop: true });
  });

  it("Shift+click without drag clears the range", () => {
    const t = setup();
    t.fire("pointerdown", 100);
    t.fire("pointerup", 100);
    expect(t.ranges).toEqual([null]);
  });

  it("plain drag scrubs and leaves the range alone", () => {
    const t = setup();
    t.fire("pointerdown", 100, false);
    t.fire("pointermove", 300, false);
    t.fire("pointerup", 300, false);
    expect(t.ranges).toEqual([]);
    expect(t.seeks.at(-1)).toBe(3);
  });
});
