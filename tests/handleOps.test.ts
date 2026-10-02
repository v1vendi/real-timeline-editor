import { describe, expect, it } from "vitest";
import { editClip, setEase } from "../src/edit/handleOps";
import type { Sequence } from "../src/core/model";

const seq = { tracks: [
  { id: "s", kind: "sections", sections: [{ id: "a", start: 0, length: 8, row: 0, easeOut: 2 }] },
  { id: "au", kind: "audio", clips: [{ id: "c", start: 4, length: 8, offset: 2 }] },
] } as unknown as Sequence;
const clip = (s: Sequence) => (s.tracks[1] as { clips: { start: number; length: number; offset: number }[] }).clips[0]!;

describe("handle ops", () => {
  it("clamps ease so in + out <= length", () => {
    const s = (setEase(seq, "s", "a", "in", 99).tracks[0] as { sections: { easeIn: number }[] }).sections[0]!;
    expect(s.easeIn).toBe(6);
    expect(setEase(seq, "s", "a", "out", 2)).toBe(seq);
  });
  it("trims clip edges keeping audio in place", () => {
    expect(clip(editClip(seq, "au", "c", { mode: "trimStart", beat: 5 }))).toEqual({ id: "c", start: 5, length: 7, offset: 3 });
    expect(clip(editClip(seq, "au", "c", { mode: "trimStart", beat: 0 })).start).toBe(2);
    expect(clip(editClip(seq, "au", "c", { mode: "trimEnd", beat: 6 })).length).toBe(2);
    expect(clip(editClip(seq, "au", "c", { mode: "slip", beat: 1 })).offset).toBe(1);
  });
  it("clamps fades when a trim shortens the clip", () => {
    const f = { tracks: [seq.tracks[0], { id: "au", kind: "audio", clips: [{ id: "c", start: 0, length: 8, offset: 0, fadeIn: 3, fadeOut: 4 }] }] } as unknown as Sequence;
    const trimmed = (beat: number, mode: "trimStart" | "trimEnd" = "trimEnd") => clip(editClip(f, "au", "c", { mode, beat })) as { length: number; fadeIn?: number; fadeOut?: number };
    expect(trimmed(5)).toMatchObject({ length: 5, fadeIn: 3, fadeOut: 2 });
    expect(trimmed(2)).toMatchObject({ length: 2, fadeIn: 2 });
    expect(trimmed(2).fadeOut).toBeUndefined();
    expect(trimmed(6, "trimStart")).toMatchObject({ length: 2, fadeIn: 2 });
    expect(editClip(f, "au", "c", { mode: "move", beat: 1 }).tracks[1]).toMatchObject({ clips: [{ fadeIn: 3, fadeOut: 4 }] });
  });
});
