// Studio demo sample: a 128-beat (64 s @120 bpm) show. Exports `sample` and `peaks` (consumed by demo/studio.ts).
import { buildPeakMips, type Channel, type Key, type PeakMips, type Sequence, type Track } from "../../src";

const LEN = 128;
/** Smooth bezier keys from a function of beat, sampled every `step` beats. */
const curve = (id: string, name: string, step: number, len: number, f: (b: number) => number): Channel => ({
  id, name,
  keys: Array.from({ length: Math.floor(len / step) + 1 }, (_, i): Key => ({ beat: i * step, value: Math.round(f(i * step) * 10) / 10, interp: "bezier" })),
});
const wave = (period: number, phase = 0, lo = 0, hi = 100) => (b: number) => lo + ((Math.sin((b / period) * Math.PI * 2 + phase) + 1) / 2) * (hi - lo);
const steps = (id: string, name: string, vals: number[], every: number): Channel => ({
  id, name, keys: vals.map((value, i): Key => ({ beat: i * every, value, interp: "constant" })),
});

// Nested "chorus": 16 beats, used twice (beats 48 and 96) in the FX folder.
const chorus: Sequence = {
  version: 1, id: "chorus", name: "Chorus", length: 16, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
  tracks: [
    { id: "c-sec", name: "Burst", kind: "sections", sections: [
      { id: "c1", start: 0, length: 8, row: 0, label: "Burst", color: "#e0637a" },
      { id: "c2", start: 8, length: 8, row: 0, label: "Sweep", color: "#e0a24a" },
    ] },
    { id: "c-ch", name: "Intensity", kind: "channels", channels: [curve("c-int", "intensity", 1, 16, wave(4, 0))] },
  ],
};

const ramp = (id: string, name: string, vals: number[], every: number, interp: Key["interp"]): Channel => ({
  id, name, keys: vals.map((value, i): Key => ({ beat: i * every, value, interp })),
});
const PALETTE: [number, number, number][] = [[255, 255, 255], [255, 40, 40], [40, 120, 255], [255, 200, 0], [40, 220, 120], [220, 60, 220], [0, 220, 230], [255, 120, 0]];
const colorTracks: Track[] = [
  { id: "col-rainbow", name: "Rainbow fade (RGB)", kind: "channels", binding: { targetId: "fixture.par-bar" },
    groups: [{ id: "g-rb", name: "RGB", kind: "rgb", channelIds: ["rb-r", "rb-g", "rb-b"] }],
    channels: [
      ramp("rb-r", "R", [255, 255, 0, 0, 0, 255, 255], 8, "bezier"), ramp("rb-g", "G", [0, 255, 255, 255, 0, 0, 0], 8, "bezier"), ramp("rb-b", "B", [0, 0, 0, 255, 255, 255, 0], 8, "bezier"),
    ] },
  { id: "col-rgba", name: "Fade with alpha (RGBA)", kind: "channels",
    groups: [{ id: "g-rgba", name: "RGBA", kind: "rgba", channelIds: ["ra-r", "ra-g", "ra-b", "ra-a"] }],
    channels: [
      ramp("ra-r", "R", [255, 40, 255], 16, "linear"), ramp("ra-g", "G", [80, 160, 80], 16, "linear"), ramp("ra-b", "B", [20, 255, 20], 16, "linear"), ramp("ra-a", "A", [255, 30, 255], 16, "linear"),
    ] },
  { id: "col-hsv", name: "Hue sweep (HSV)", kind: "channels",
    groups: [{ id: "g-hsv", name: "HSV", kind: "hsv", channelIds: ["hs-h", "hs-s", "hs-v"] }],
    channels: [
      ramp("hs-h", "H", [0, 360], 32, "linear"), ramp("hs-s", "S", [1, 0.6, 1], 16, "bezier"), ramp("hs-v", "V", [1, 1], 32, "linear"),
    ] },
  { id: "col-hue", name: "Hue only", kind: "channels",
    groups: [{ id: "g-hue", name: "Hue", kind: "hue", channelIds: ["hu-h"] }],
    channels: [ramp("hu-h", "hue", [240, 300, 30, 120, 240], 8, "bezier")] },
  { id: "col-strobe", name: "Strobe palette (stepped)", kind: "channels",
    groups: [{ id: "g-st", name: "RGB", kind: "rgb", channelIds: ["st-r", "st-g", "st-b"] }],
    channels: [
      ramp("st-r", "R", PALETTE.map((c) => c[0]), 4, "constant"), ramp("st-g", "G", PALETTE.map((c) => c[1]), 4, "constant"), ramp("st-b", "B", PALETTE.map((c) => c[2]), 4, "constant"),
    ] },
];

const lighting: Track = { id: "f-light", name: "Lighting", kind: "folder", children: [
  { id: "dim", name: "Front dimmers", kind: "channels", binding: { targetId: "fixture.front-wash" }, channels: [
    curve("dim-l", "left", 2, LEN, wave(32, 0)), curve("dim-r", "right", 2, LEN, wave(32, 1.2)), curve("dim-c", "center", 4, LEN, wave(48, 2.4, 20, 100)),
  ] },
  { id: "col", name: "Color", kind: "channels", binding: { targetId: "fixture.par-bar" },
    groups: [{ id: "g-rgb", name: "RGB", kind: "rgb", channelIds: ["col-r", "col-g", "col-b"], color: "#d06a6a" }],
    channels: [
      curve("col-r", "R", 4, LEN, wave(64, 0, 0, 255)), curve("col-g", "G", 4, LEN, wave(64, 2.1, 0, 255)), curve("col-b", "B", 4, LEN, wave(64, 4.2, 0, 255)),
      curve("col-w", "white", 8, LEN, wave(40, 0.5, 0, 60)),
    ] },
  ...colorTracks,
  { id: "back", name: "Back truss (locked)", kind: "channels", locked: true, binding: { targetId: "fixture.back-truss" }, channels: [curve("back-i", "intensity", 4, LEN, wave(24, 0.7))] },
] };

const fx: Track = { id: "f-fx", name: "Effects", kind: "folder", children: [
  { id: "fx-main", name: "FX lanes", kind: "sections", binding: { targetId: "fixture.missing-rig" }, sections: [
    { id: "s1", start: 4, length: 20, row: 0, label: "Chase", color: "#4a7fd4", easeIn: 2, easeOut: 2 },
    { id: "s2", start: 12, length: 16, row: 1, label: "Color wash", color: "#8a5fd0", easeIn: 4, easeOut: 4 },
    { id: "s3", start: 20, length: 14, row: 2, label: "Sparkle", color: "#3fae8c" },
    { id: "s4", start: 32, length: 12, row: 0, label: "Pulse", color: "#d4a04a", easeOut: 3 },
    { id: "s5", start: 64, length: 24, row: 0, label: "Rainbow", color: "#d06aa8", easeIn: 4, easeOut: 6 },
    { id: "s6", start: 72, length: 10, row: 1, label: "Flash", color: "#e0e0e0" },
  ] },
  { id: "fx-nest", name: "Chorus (nested)", kind: "sections", sections: [
    { id: "n1", start: 48, length: 16, row: 0, label: "Chorus", ref: { sequenceId: "chorus" } },
    { id: "n2", start: 96, length: 16, row: 0, label: "Chorus", ref: { sequenceId: "chorus" } },
  ] },
  { id: "fx-strobe", name: "Strobe (muted)", kind: "events", muted: true, events: [
    { id: "st1", beat: 47.5, name: "Strobe on" }, { id: "st2", beat: 64, name: "Strobe off" },
    { id: "st3", beat: 95.5, name: "Strobe on" }, { id: "st4", beat: 112, name: "Strobe off" },
  ] },
] };

const audio: Track = { id: "f-audio", name: "Audio & cues", kind: "folder", children: [
  { id: "a-mix", name: "Full mix", kind: "audio", clips: [{ id: "a1", start: 0, length: LEN, offset: 0, peaksId: "mix", label: "Mix", fadeIn: 2, fadeOut: 8 }] },
  { id: "a-perc", name: "Percussion", kind: "audio", clips: [
    { id: "a2", start: 16, length: 32, offset: 0, peaksId: "perc", label: "Drums A" },
    { id: "a3", start: 64, length: 32, offset: 0, peaksId: "perc", label: "Drums B", gain: 0.8 },
  ] },
  { id: "cues", name: "Cues", kind: "events", events: [
    { id: "e1", beat: 0, name: "Show start" }, { id: "e2", beat: 16, name: "Fog" }, { id: "e3", beat: 48, name: "Confetti" },
    { id: "e4", beat: 96, name: "Pyro" }, { id: "e5", beat: 128, name: "Blackout" },
  ] },
  { id: "gobo-t", name: "Gobo wheel", kind: "channels", channels: [steps("gobo", "slot", [0, 1, 2, 3, 2, 1, 0, 3], 16)] },
] };

export const sample: Sequence = {
  version: 1, id: "studio", name: "Studio show", length: LEN, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }],
  markers: [
    { id: "m1", beat: 0, label: "Intro" }, { id: "m2", beat: 16, label: "Verse 1", color: "#4a7fd4" },
    { id: "m3", beat: 48, label: "Chorus", color: "#e0637a" }, { id: "m4", beat: 64, label: "Verse 2", color: "#4a7fd4" },
    { id: "m5", beat: 80, label: "Bridge", color: "#3fae8c" }, { id: "m6", beat: 96, label: "Final chorus", color: "#e0637a" },
    { id: "m7", beat: 112, label: "Outro" },
  ],
  library: { chorus },
  tracks: [lighting, fx, audio],
};

// Generated audio: a "mix" (tones + beat envelope) and a percussion loop, 22.05 kHz, 64 s.
const SR = 22050;
const total = SR * 64;
const mix = new Float32Array(total), perc = new Float32Array(total);
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
for (let i = 0; i < total; i++) {
  const t = i / SR, beatPhase = (t * 2) % 1, bar = Math.floor(t / 2);
  const kick = Math.exp(-beatPhase * 8) * Math.sin(2 * Math.PI * 60 * t);
  const hat = ((t * 4) % 1 < 0.05 ? 1 : 0) * rnd() * 0.3;
  perc[i] = (kick * 0.9 + hat) * (bar % 8 < 6 ? 1 : 0.4);
  const swell = 0.4 + 0.6 * Math.abs(Math.sin((t / 16) * Math.PI));
  mix[i] = Math.max(-1, Math.min(1, (kick * 0.6 + Math.sin(2 * Math.PI * 220 * t) * 0.25 * swell + Math.sin(2 * Math.PI * 330 * t) * 0.15 * swell + hat) * (t > 56 ? 1 - (t - 56) / 8 : 1)));
}
export const peaks = new Map<string, PeakMips>([["mix", buildPeakMips(mix, SR)], ["perc", buildPeakMips(perc, SR)]]);
