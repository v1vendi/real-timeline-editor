import { describe, expect, it } from "vitest";
import { setAudioFade, setAudioGain } from "../src/edit/commands";
import type { AudioClip, Sequence } from "../src/core/model";
import { parseSequence, serializeSequence, validateSequence } from "../src/core/serialize";

const mk = (locked = false, clip: Partial<AudioClip> = {}): Sequence => ({
  version: 1, id: "r", name: "r", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [{ id: "au", kind: "audio", name: "au", locked, clips: [{ id: "c", start: 0, length: 8, offset: 0, ...clip }] }],
});
const clip = (s: Sequence) => (s.tracks[0] as { clips: AudioClip[] }).clips[0]!;

describe("audio fade/gain", () => {
  it("sets fades quantized and clamped", () => {
    expect(clip(setAudioFade(mk(), "au", "c", { fadeIn: 2, fadeOut: 1 }))).toMatchObject({ fadeIn: 2, fadeOut: 1 });
    expect(clip(setAudioFade(mk(), "au", "c", { fadeIn: 1 / 3 })).fadeIn).toBe(Math.round(960 / 3) / 960);
    expect(clip(setAudioFade(mk(), "au", "c", { fadeIn: -3 })).fadeIn).toBeUndefined();
    const s = setAudioFade(mk(false, { fadeIn: 6 }), "au", "c", { fadeOut: 5 });
    expect(clip(s).fadeOut).toBe(2);
    expect(clip(setAudioFade(mk(), "au", "c", { fadeIn: 99 })).fadeIn).toBe(8);
  });

  it("sets gain, dropping the default", () => {
    expect(clip(setAudioGain(mk(), "au", "c", 0.5)).gain).toBe(0.5);
    expect(clip(setAudioGain(mk(), "au", "c", -1)).gain).toBe(0);
    expect("gain" in clip(setAudioGain(mk(false, { gain: 0.5 }), "au", "c", 1))).toBe(false);
  });

  it("is a no-op (same reference) when locked, missing or unchanged", () => {
    const l = mk(true);
    expect(setAudioFade(l, "au", "c", { fadeIn: 1 })).toBe(l);
    expect(setAudioGain(l, "au", "c", 2)).toBe(l);
    const s = mk();
    expect(setAudioFade(s, "au", "nope", { fadeIn: 1 })).toBe(s);
    expect(setAudioGain(s, "au", "c", 1)).toBe(s);
    expect(setAudioGain(s, "au", "c", NaN)).toBe(s);
  });

  it("serializes and validates", () => {
    const s = setAudioGain(setAudioFade(mk(), "au", "c", { fadeIn: 1, fadeOut: 2 }), "au", "c", 0.25);
    expect(validateSequence(s)).toEqual([]);
    expect(parseSequence(serializeSequence(s))).toEqual(s);
    expect(validateSequence(mk(false, { fadeIn: -1, gain: -2 })).join("\n")).toMatch(/fadeIn[\s\S]*gain/);
  });
});
