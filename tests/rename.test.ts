import { describe, expect, it } from "vitest";
import type { Sequence } from "../src/core/model";
import { renameChannel, renameClip, renameEvent, renameMarker, renameSection, renameTrack } from "../src/edit/rename";

const sec = { id: "s1", start: 0, length: 2, row: 0 };
const seq: Sequence = { version: 1, id: "q", name: "q", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }],
  markers: [{ id: "m", beat: 1, label: "Verse" }], library: {}, tracks: [
    { id: "F", name: "folder", kind: "folder", children: [{ id: "T", name: "t", kind: "channels", channels: [{ id: "c", name: "r", keys: [] }] }] },
    { id: "L", name: "locked", kind: "sections", locked: true, sections: [sec] },
    { id: "S", name: "s", kind: "sections", sections: [sec] },
    { id: "E", name: "e", kind: "events", events: [{ id: "e1", beat: 0, name: "go" }] },
    { id: "A", name: "a", kind: "audio", clips: [{ id: "a1", start: 0, length: 1, offset: 0 }] },
  ] };

describe("rename ops", () => {
  it("renames each kind, trimmed", () => {
    expect(renameTrack(seq, "F", "  Dir ").tracks[0]!.name).toBe("Dir");
    const c = renameChannel(seq, "T", "c", "red").tracks[0] as any;
    expect(c.children[0].channels[0].name).toBe("red");
    expect((renameSection(seq, "S", "s1", "Drop").tracks[2] as any).sections[0].label).toBe("Drop");
    expect((renameEvent(seq, "E", "e1", "stop").tracks[3] as any).events[0].name).toBe("stop");
    expect((renameClip(seq, "A", "a1", "kick").tracks[4] as any).clips[0].label).toBe("kick");
    expect(renameMarker(seq, "m", "Chorus").markers[0]!.label).toBe("Chorus");
  });
  it("no-ops return the same sequence", () => {
    expect(renameTrack(seq, "S", "   ")).toBe(seq);
    expect(renameTrack(seq, "S", "s")).toBe(seq);
    expect(renameTrack(seq, "nope", "x")).toBe(seq);
    expect(renameMarker(seq, "m", " Verse ")).toBe(seq);
    expect(renameMarker(seq, "m", "")).toBe(seq);
    expect(renameChannel(seq, "T", "zz", "x")).toBe(seq);
    expect(renameSection(seq, "E", "s1", "x")).toBe(seq);
  });
  it("respects locks", () => {
    expect(renameTrack(seq, "L", "x")).toBe(seq);
    expect(renameSection(seq, "L", "s1", "x")).toBe(seq);
    const lockedFolder = { ...seq, tracks: [{ ...seq.tracks[0]!, locked: true }, ...seq.tracks.slice(1)] } as Sequence;
    expect(renameChannel(lockedFolder, "T", "c", "x")).toBe(lockedFolder);
  });
});

import { deleteClip, deleteMarker } from "../src/edit/commands";
import { emptySelection, eventId, pruneSelection, select } from "../src/edit/selection";
import { selectionTarget } from "../src/view/rename";
import { buildKeymap } from "../src/view/keymap";

describe("marker / clip selection", () => {
  it("R and F2 both rename; the selected marker or clip is the target", () => {
    const map = buildKeymap().map;
    expect(map["R"]).toBe("rename");
    expect(map["F2"]).toBe("rename");
    expect(selectionTarget(seq, select(emptySelection, "markers", ["m"]))).toEqual({ kind: "marker", id: "m" });
    expect(selectionTarget(seq, select(emptySelection, "clips", [eventId("A", "a1")]))).toEqual({ kind: "clip", trackId: "A", id: "a1" });
    expect(selectionTarget(seq, select(select(emptySelection, "markers", ["m"]), "clips", [eventId("A", "a1")]))).toBeUndefined();
  });
  it("prune drops removed markers and clips; delete ops refuse locked / missing", () => {
    const sel = select(select(emptySelection, "markers", ["m", "x"]), "clips", [eventId("A", "a1"), eventId("A", "zz")]);
    const p = pruneSelection(sel, seq);
    expect([...p.markers]).toEqual(["m"]);
    expect([...p.clips]).toEqual([eventId("A", "a1")]);
    expect(deleteMarker(seq, "m").markers).toHaveLength(0);
    expect(deleteMarker(seq, "nope")).toBe(seq);
    expect((deleteClip(seq, "A", "a1").tracks[4] as any).clips).toHaveLength(0);
    expect(deleteClip(seq, "A", "nope")).toBe(seq);
  });
});
