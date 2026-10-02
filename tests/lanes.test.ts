import { describe, expect, it } from "vitest";
import { assignLanes, firstFreeLane, laneCount, placeSection } from "../src/core/lanes";
import type { Section } from "../src/core/model";

const sec = (id: string, start: number, length: number, row = 0): Section => ({ id, start, length, row });
const rows = (l: Section[]) => l.map((s) => s.row);

describe("lanes", () => {
  it("touching sections share lane 0", () => {
    expect(rows(assignLanes([sec("a", 0, 4), sec("b", 4, 4)]))).toEqual([0, 0]);
  });

  it("overlaps stack onto first free lane", () => {
    const out = assignLanes([sec("a", 0, 8), sec("b", 2, 4), sec("c", 3, 2), sec("d", 6, 4)]);
    expect(rows(out)).toEqual([0, 1, 2, 1]);
  });

  it("recomputes after a move and compacts freed lanes", () => {
    const before = assignLanes([sec("a", 0, 8), sec("b", 2, 4)]);
    expect(rows(before)).toEqual([0, 1]);
    const moved = before.map((s) => (s.id === "b" ? { ...s, start: 10 } : s));
    expect(rows(assignLanes(moved))).toEqual([0, 0]);
  });

  it("is pure and keeps unchanged objects and input order", () => {
    const a = sec("a", 5, 2);
    const b = sec("b", 0, 8);
    const out = assignLanes([a, b]);
    expect(out.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out[1]).toBe(b);
    expect(a.row).toBe(0);
    expect(out[0]!.row).toBe(1);
  });

  it("placeSection on insert does not disturb others", () => {
    const existing = [sec("a", 0, 8, 0), sec("b", 2, 4, 1)];
    expect(firstFreeLane(sec("n", 3, 1), existing)).toBe(2);
    expect(placeSection(sec("n", 20, 1, 3), existing).row).toBe(0);
    expect(placeSection(sec("b", 2, 4, 5), existing).row).toBe(1);
  });

  it("laneCount", () => {
    expect(laneCount([])).toBe(0);
    expect(laneCount([sec("a", 0, 1, 2)])).toBe(3);
  });
});
