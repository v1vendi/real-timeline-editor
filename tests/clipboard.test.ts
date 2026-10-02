import { describe, expect, it } from "vitest";
import type { Sequence } from "../src/core/model";
import { addKey, addSection } from "../src/edit/commands";
import { copySelection, cutSelection, duplicate, paste, splitAt, splitSection } from "../src/edit/clipboard";
import { keyId } from "../src/edit/selection";

const base: Sequence = {
  version: 1, id: "s", name: "s", length: 64, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [
    { id: "T", name: "t", kind: "sections", sections: [] },
    { id: "L", name: "l", kind: "sections", locked: true, sections: [] },
    { id: "C", name: "c", kind: "channels", channels: [{ id: "ch", name: "ch", keys: [] }, { id: "ch2", name: "ch2", keys: [] }] },
  ],
};
let n = 0;
const mint = () => `n${++n}`;
const secs = (s: Sequence) => (s.tracks[0] as any).sections as any[];
const keys = (s: Sequence, c = 0) => (s.tracks[2] as any).channels[c].keys.map((k: any) => k.beat);
const k = (beat: number) => ({ beat, value: beat, interp: "linear" as const });
const none = new Set<string>();

describe("clipboard", () => {
  it("pastes sections at the playhead with relative offsets and free lanes", () => {
    let s = addSection(addSection(base, "T", { id: "a", start: 2, length: 4 }), "T", { id: "b", start: 8, length: 2 });
    const clip = copySelection(s, { sections: new Set(["a", "b"]), keys: none })!;
    s = paste(s, clip, 3, mint).seq;
    const added = secs(s).slice(2);
    expect(added.map((x) => [x.start, x.length])).toEqual([[3, 4], [9, 2]]);
    expect(added[0].row).toBe(1); // overlaps original a (2..6)
    expect(JSON.parse(JSON.stringify(clip))).toEqual(clip);
  });
  it("duplicates sections after the original, keys one step later; locked rejects", () => {
    let s = addSection(base, "T", { id: "a", start: 2, length: 4 });
    s = addKey(s, "C", "ch", k(1));
    const sel = { sections: new Set(["a"]), keys: new Set([keyId({ trackId: "C", channelId: "ch", beat: 1 })]) };
    const r = duplicate(s, sel, mint, 0.25);
    expect(secs(r.seq)[1]).toMatchObject({ start: 6, length: 4, row: 0 });
    expect(keys(r.seq)).toEqual([1, 1.25]);
    expect(r.sections).toHaveLength(1);
    expect(r.keys).toEqual([{ trackId: "C", channelId: "ch", beat: 1.25 }]);
  });
  it("pastes keys to the same channel, else the target channel", () => {
    const s = addKey(base, "C", "ch", k(1));
    const clip = copySelection(s, { sections: none, keys: new Set([keyId({ trackId: "C", channelId: "ch", beat: 1 })]) })!;
    expect(keys(paste(s, clip, 5, mint).seq)).toEqual([1, 5]);
    const gone = { ...clip, keys: [{ ...clip.keys[0]!, channelId: "x" }] };
    expect(keys(paste(s, gone, 5, mint, { trackId: "C", channelId: "ch2" }).seq, 1)).toEqual([5]);
    expect(paste(s, gone, 5, mint).keys).toEqual([]);
  });
  it("splits keeping content in place via offset; rejects degenerate cuts", () => {
    const s = addSection(base, "T", { id: "a", start: 2, length: 4, offset: 1, scale: 2 });
    const r = splitSection(s, "T", "a", 3, mint);
    expect(secs(r.seq)).toMatchObject([{ id: "a", start: 2, length: 1 }, { start: 3, length: 3, offset: 3 }]);
    expect(splitSection(s, "T", "a", 2, mint).id).toBeNull();
    expect(splitSection(s, "T", "a", 6, mint).seq).toBe(s);
    const all = splitAt(s, { sections: new Set(["a"]) }, 4, mint);
    expect(all.ids).toHaveLength(1);
    expect(secs(all.seq).map((x) => x.row)).toEqual([0, 0]);
  });
  it("split clears easeOut on the first half and easeIn on the second", () => {
    const s = addSection(base, "T", { id: "a", start: 2, length: 4, easeIn: 1, easeOut: 1 });
    const r = splitSection(s, "T", "a", 4, mint);
    const [a, b] = secs(r.seq);
    expect(a.id).toBe("a");
    expect(a.easeIn).toBe(1);
    expect(a.easeOut).toBeUndefined();
    expect(b.easeIn).toBeUndefined();
    expect(b.easeOut).toBe(1);
  });
  it("cuts: copies then deletes sections and keys; null when empty", () => {
    let s = addSection(base, "T", { id: "a", start: 2, length: 4 });
    s = addKey(addKey(s, "C", "ch", k(1)), "C", "ch", k(3));
    const sel = { sections: new Set(["a"]), keys: new Set([keyId({ trackId: "C", channelId: "ch", beat: 1 })]) };
    const r = cutSelection(s, sel)!;
    expect(secs(r.seq)).toHaveLength(0);
    expect(keys(r.seq)).toEqual([3]);
    expect(r.clip.sections).toHaveLength(1);
    expect(r.clip.keys).toHaveLength(1);
    expect(paste(r.seq, r.clip, 10, mint).sections).toHaveLength(1);
    expect(cutSelection(s, { sections: none, keys: none })).toBeNull();
  });
});

describe("clipboard events", () => {
  const ev = (id: string, beat: number) => ({ id, beat, name: id });
  const withEv: Sequence = { ...base, tracks: [...base.tracks,
    { id: "E", name: "e", kind: "events", events: [ev("a", 2), ev("b", 6)] },
    { id: "E2", name: "e2", kind: "events", events: [] }] };
  const evs = (s: Sequence, i = 3) => (s.tracks[i] as any).events.map((e: any) => [e.id, e.beat]);
  const sel = { sections: none, keys: none, events: new Set(["E\0a", "E\0b"]) };

  it("copies, pastes with relative offsets and new ids, falls back to the target track", () => {
    const clip = copySelection(withEv, sel)!;
    expect(clip.events!.map((e) => e.rel)).toEqual([0, 4]);
    expect(JSON.parse(JSON.stringify(clip))).toEqual(clip);
    const r = paste(withEv, clip, 10, mint);
    expect(evs(r.seq).slice(2).map((e: any) => e[1])).toEqual([10, 14]);
    expect(r.events).toHaveLength(2);
    const gone = { ...r.seq, tracks: r.seq.tracks.filter((t) => t.id !== "E") };
    expect(evs(paste(gone, clip, 1, mint, { trackId: "E2" }).seq, 3).map((e: any) => e[1])).toEqual([1, 5]);
    expect(paste(gone, clip, 1, mint).events).toEqual([]);
  });
  it("cuts and duplicates events; locked tracks keep them", () => {
    const cut = cutSelection(withEv, sel)!;
    expect(evs(cut.seq)).toEqual([]);
    const d = duplicate(withEv, sel, mint, 1);
    expect(evs(d.seq).map((e: any) => e[1])).toEqual([2, 3, 6, 7]);
    expect(d.events).toHaveLength(2);
    const locked = { ...withEv, tracks: withEv.tracks.map((t) => (t.id === "E" ? { ...t, locked: true } : t)) } as Sequence;
    expect(cutSelection(locked, sel)!.seq).toEqual(locked);
    expect(duplicate(locked, sel, mint, 1).events).toEqual([]);
  });
});
