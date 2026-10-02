import { describe, expect, it } from "vitest";
import { buildKeymap, eventChord, normalizeChord, parseChord } from "../src/view/keymap";

const ev = (key: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...m });

describe("chords", () => {
  it("normalizes aliases and order", () => {
    expect(normalizeChord("ctrl+shift+z")).toBe("Mod+Shift+Z");
    expect(normalizeChord("Shift+Alt+cmd+left")).toBe("Mod+Alt+Shift+ArrowLeft");
    expect(normalizeChord(" space ")).toBe("Space");
    expect(normalizeChord("Shift+Space")).toBe("Space");
    expect(normalizeChord("Mod++")).toBe("Mod++");
    expect(normalizeChord("+")).toBe("+");
  });
  it("rejects malformed", () => {
    for (const bad of ["", "  ", "Foo+S", "Mod+", "Mod+Shift", "A+B"]) expect(parseChord(bad)).toBeNull();
  });
  it("event chords match normalized form", () => {
    expect(eventChord(ev("z", { metaKey: true, shiftKey: true }))).toBe("Mod+Shift+Z");
    expect(eventChord(ev(" "))).toBe("Space");
    expect(eventChord(ev("Z", { ctrlKey: true, shiftKey: true }))).toBe(normalizeChord("ctrl+shift+z"));
  });
});

describe("buildKeymap", () => {
  it("defaults", () => {
    const { map, conflicts } = buildKeymap();
    expect(map["Mod+Y"]).toBe("redo");
    expect(map["Space"]).toBe("playToggle");
    expect(conflicts).toEqual([]);
  });
  it("override replaces an action's defaults and displaces others", () => {
    const { map } = buildKeymap({ split: "ctrl+d", delete: "x", redo: null });
    expect(map["Mod+D"]).toBe("split");
    expect(map["X"]).toBe("delete");
    expect(map["Delete"]).toBeUndefined();
    expect(map["Mod+Shift+Z"]).toBeUndefined();
    expect(Object.values(map)).not.toContain("duplicate");
  });
  it("reports override conflicts and invalid entries", () => {
    const r = buildKeymap({ copy: "Q", cut: ["q"], paste: "Bogus+V", nope: "A" } as never);
    expect(r.conflicts).toEqual([{ chord: "Q", actions: ["copy", "cut"] }]);
    expect(r.map["Q"]).toBe("copy");
    expect(r.invalid).toEqual(["paste: Bogus+V", "nope"]);
  });
});
