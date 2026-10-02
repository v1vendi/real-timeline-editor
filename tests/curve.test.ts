import { describe, expect, it } from "vitest";
import { evaluate, findKey, handlesOf } from "../src/core/curve";
import type { Key } from "../src/core/model";

const k = (beat: number, value: number, interp: Key["interp"] = "linear", tan?: Key["tan"]): Key =>
  ({ beat, value, interp, ...(tan ? { tan } : {}) });
const ch = (...keys: Key[]) => ({ keys });

describe("evaluate", () => {
  it("empty, holds ends", () => {
    expect(evaluate(ch(), 1)).toBeUndefined();
    const c = ch(k(1, 5), k(3, 9));
    expect(evaluate(c, 0)).toBe(5);
    expect(evaluate(c, 10)).toBe(9);
  });
  it("constant and linear", () => {
    expect(evaluate(ch(k(0, 1, "constant"), k(2, 5)), 1.9)).toBe(1);
    expect(evaluate(ch(k(0, 0), k(2, 4)), 0.5)).toBe(1);
    expect(evaluate(ch(k(0, 0), k(2, 4)), 2)).toBe(4);
  });
  it("findKey binary search", () => {
    const keys = [k(0, 0), k(1, 0), k(4, 0)];
    expect([findKey(keys, -1), findKey(keys, 0), findKey(keys, 3.9), findKey(keys, 4)]).toEqual([-1, 0, 1, 2]);
  });
  it("auto bezier hits keys, is flat at ends, monotonic between monotonic keys", () => {
    const c = ch(k(0, 0, "bezier"), k(1, 1, "bezier"), k(2, 4, "bezier"), k(3, 5));
    expect(evaluate(c, 1)).toBe(1);
    let prev = -Infinity;
    for (let b = 0; b <= 3; b += 0.05) { const v = evaluate(c, b)!; expect(v).toBeGreaterThanOrEqual(prev - 1e-9); prev = v; }
    expect(evaluate(c, 0.01)!).toBeLessThan(0.01);
    expect(handlesOf(c.keys, 0).outDy).toBe(0);
  });
  it("auto is flat at a local extremum", () => {
    const keys = [k(0, 0, "bezier"), k(1, 5, "bezier"), k(2, 0)];
    expect(handlesOf(keys, 1).outDy).toBe(0);
  });
  it("free tangents use stored handles; straight handles give a line", () => {
    const tan = (outDy: number, inDy: number) => ({ mode: "free" as const, inDx: -1 / 3, inDy, outDx: 1 / 3, outDy });
    const line = ch(k(0, 0, "bezier", tan(1 / 3, 0)), k(1, 1, "linear", tan(0, -1 / 3)));
    expect(evaluate(line, 0.25)).toBeCloseTo(0.25, 6);
    const up = ch(k(0, 0, "bezier", tan(5, 0)), k(1, 0, "linear", tan(0, 0)));
    expect(evaluate(up, 0.3)!).toBeGreaterThan(0.5);
  });
});
