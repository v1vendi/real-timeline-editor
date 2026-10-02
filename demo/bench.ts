// Repeatable perf bench (not a unit test): 200 tracks x 2000 keys, real createTimeline, synthetic pointer events.
// Run: `npm run bench` (headless Chrome via CDP) or open /bench.html?auto on a dev server.
// Per step = handler ms + every rAF callback ms (the paint). Results: window.benchResult, also printed in #out.
import { createTimeline, type Timeline } from "../src/view/timeline";
import { buildPeakMips, flattenRows, parseSequence, serializeSequence, type Channel, type Sequence, type Track } from "../src";
import { keyId } from "../src/edit/selection";
import { applyRename } from "../src/view/rename";

// Wrap rAF before anything else so paint time is attributed to the frame.
let frameMs = 0;
const nativeRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => nativeRaf((t) => { const t0 = performance.now(); cb(t); frameMs += performance.now() - t0; });

const mkChannel = (id: string, n: number, len: number, seed: number): Channel => ({
  id, name: id, keys: Array.from({ length: n }, (_, i) => ({ beat: Math.round((i / n) * len * 960) / 960, value: Math.sin(i * 0.3 + seed) * 50 + 50, interp: i % 3 === 0 ? "linear" : "bezier" as const })),
});
function fixture(nTracks: number, nKeys: number): Sequence {
  const tracks: Track[] = [
    { id: "fx", name: "Effects", kind: "sections", sections: Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, start: i * 1.5, length: 1.2, row: i % 2, label: `Sec ${i}` })) },
    { id: "ev", name: "Cues", kind: "events", events: Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, beat: i * 3, name: `Cue ${i}` })) },
  ];
  for (let i = 0; i < nTracks; i++) tracks.push({ id: `t${i}`, name: `T${i}`, kind: "channels", channels: [mkChannel(`c${i}`, nKeys, 60, i)] });
  return { version: 1, id: "bench", name: "Bench", length: 64, beatsPerBar: 4, tempo: [{ beat: 0, bpm: 120 }], tracks, markers: [{ id: "m1", beat: 0, label: "Intro" }], library: {} };
}

const raf = () => new Promise<void>((r) => nativeRaf(() => r()));
const stats = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return { mean: +(a.reduce((x, y) => x + y, 0) / n).toFixed(2), p95: +s[Math.min(n - 1, Math.floor(n * 0.95))]!.toFixed(2), max: +s[n - 1]!.toFixed(2), n }; };
const heap = () => { (window as unknown as { gc?: () => void }).gc?.(); return heapNow(); };
const heapNow = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

async function measure(n: number, step: (i: number) => void): Promise<ReturnType<typeof stats>> {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) {
    frameMs = 0;
    const t0 = performance.now();
    step(i);
    const h = performance.now() - t0;
    await raf();
    await raf(); // timeline frames run in the first rAF after the invalidate; second guards chained invalidations
    ms.push(h + frameMs);
  }
  return stats(ms);
}

/** Handler + paint ms of one action (pointerup etc.). */
async function commit(f: () => void): Promise<number> { frameMs = 0; const t0 = performance.now(); f(); const h = performance.now() - t0; await raf(); await raf(); return +(h + frameMs).toFixed(1); }

export async function runBench(): Promise<Record<string, unknown>> {
  const res: Record<string, unknown> = {};
  const host = document.getElementById("app")!;
  const seq = fixture(200, 2000);
  let clock = 4; let push: ((b: number) => void) | undefined;
  const setTime = (b: number) => { clock = b; push?.(b); };

  const g0 = performance.now(); const h0 = heap();
  const expanded = seq.tracks.slice(2, 12).map((t) => t.id);
  const tl: Timeline = createTimeline(host, { sequence: seq, clock: { getTime: () => clock, subscribe: (cb) => { push = cb; return () => { push = undefined; }; } }, expanded });
  res["create 400k keys ms"] = +(performance.now() - g0).toFixed(1);
  await raf(); await raf();
  res["create+first paint heap MB"] = +((heap() - h0) / 1048576).toFixed(1);

  const canvasHost = host.querySelector(".tl-root")!.children[1] as HTMLElement;
  const rect = () => canvasHost.getBoundingClientRect();
  const RULER = 28;
  const ptr = (type: string, x: number, y: number, o: PointerEventInit = {}) => canvasHost.dispatchEvent(new PointerEvent(type, { clientX: rect().left + x, clientY: rect().top + y, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true, ...o }));
  (canvasHost as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (canvasHost as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
  const X = (b: number) => (b - tl.getView().startBeat) * tl.getView().pxPerBeat;
  const view = (v: Partial<ReturnType<Timeline["getView"]>>) => tl.setView({ ...tl.getView(), ...v });
  const layoutNow = () => flattenRows(tl.getSequence(), new Set(tl.getExpanded()), tl.getTheme().rows);

  // 1. Idle playhead (clock push, overlay only)
  view({ startBeat: 0, pxPerBeat: 14, scrollY: 0 }); await raf(); await raf();
  const hA = heap();
  res["idle playhead"] = await measure(240, (i) => setTime(4 + i * 0.05));
  res["idle heap KB/frame"] = +((heap() - hA) / 1024 / 240).toFixed(1);
  // 2. Scroll, pan, zoom
  res["scroll"] = await measure(120, (i) => view({ scrollY: i * 20 }));
  view({ scrollY: 0 });
  res["pan"] = await measure(120, (i) => view({ startBeat: i * 0.2 }));
  res["zoom"] = await measure(120, (i) => view({ startBeat: 0, pxPerBeat: 6 + (i % 60) }));
  view({ startBeat: 0, pxPerBeat: 30, scrollY: 0 }); await raf(); await raf();

  // 3. Drag a section (single, snapping on). Press selects, moves, release commits one history entry.
  {
    const sx = X(0.6 * 1.5 + 1.5 * 0) + 2, y = RULER + 14;
    const s1 = seq.tracks[0]! as Extract<Track, { kind: "sections" }>; const b = s1.sections[2]!.start + 0.4;
    const px = X(b);
    ptr("pointerdown", px, y); await raf();
    let d = 0;
    res["drag section (moves)"] = await measure(120, (i) => ptr("pointermove", px + 10 + i * 2, y));
    res["drag section commit ms"] = await commit(() => ptr("pointerup", px + 250, y)); void sx; void d;
  }
  // 4. Drag selected keys (8000 keys across 4 channels)
  {
    const L = layoutNow();
    const chRows = L.rows.filter((r) => r.kind === "channel").slice(0, 4);
    const keys = new Set<string>();
    for (const r of chRows) if (r.kind === "channel") for (const k of r.channel.keys) keys.add(keyId({ trackId: r.track.id, channelId: r.channel.id, beat: k.beat }));
    tl.setSelection({ ...tl.getSelection(), sections: new Set(), keys });
    await raf(); await raf();
    const r0 = chRows[0]!; const k = r0.kind === "channel" ? r0.channel.keys[600]! : { beat: 18 };
    view({ startBeat: 10, pxPerBeat: 30, scrollY: 0 });
    await raf(); await raf();
    const px = X(k.beat), y = RULER + r0.y + 10;
    ptr("pointerdown", px, y); await raf();
    res["drag keys (moves)"] = await measure(120, (i) => ptr("pointermove", px + 10 + i * 1.5, y));
    res["drag keys commit ms"] = await commit(() => ptr("pointerup", px + 190, y));
  }
  // 5. Box select across the expanded rows and full width
  {
    tl.setSelection({ sections: new Set(), keys: new Set(), channels: new Set(), tracks: new Set(), events: new Set(), markers: new Set(), clips: new Set() });
    view({ startBeat: 0, pxPerBeat: 14, scrollY: 0 }); await raf(); await raf();
    const y0 = RULER + 6, x0 = 600;
    // start on an empty spot: past sequence end (beat 64 at 14 px = 896 px)
    ptr("pointerdown", 1000, y0 + 120); await raf();
    res["box select (moves)"] = await measure(120, (i) => ptr("pointermove", 1000 - i * 3, y0 + 120 + i * 3));
    res["box select commit ms"] = await commit(() => ptr("pointerup", 640, y0 + 480)); void x0;
    tl.setSelection({ sections: new Set(), keys: new Set(), channels: new Set(), tracks: new Set(), events: new Set(), markers: new Set(), clips: new Set() });
  }
  // 6. Undo / redo alternating (repaint + layout sync after each)
  res["undo/redo"] = await measure(40, (i) => { if (i % 2 === 0) tl.undo(); else tl.redo(); });
  // 7. Edits that touch one track in the 400k fixture (edit -> relayout -> repaint)
  {
    const h1 = heap();
    const ms = await measure(200, (i) => tl.edit("bench nudge", (s) => ({ ...s, tracks: s.tracks.map((t) => t.id === "fx" && t.kind === "sections" ? { ...t, sections: t.sections.map((x, j) => j === 0 ? { ...x, start: x.start + 0.01 * (i + 1) } : x) } : t) })));
    res["edit (200, 1 section)"] = ms;
    res["history heap MB / 200 edits"] = +((heap() - h1) / 1048576).toFixed(2);
  }
  tl.destroy(); host.replaceChildren();

  // 7b. Selection of markers / clips and collapsed color rows (extra fixture: 40 plain tracks + 30 collapsed color tracks
  // x 3 channels x 2000 keys, 1 audio track with 60 clips, 100 markers). Keeps the baseline fixture above unchanged.
  {
    const base = fixture(40, 2000);
    const colorTracks: Track[] = Array.from({ length: 30 }, (_, i) => ({ id: `col${i}`, name: `Color ${i}`, kind: "channels" as const,
      channels: ["r", "g", "b"].map((c, j) => mkChannel(`${c}${i}`, 2000, 60, i + j)),
      groups: [{ id: `g${i}`, name: "Color", kind: "rgb", channelIds: [`r${i}`, `g${i}`, `b${i}`], range: 100 }] }));
    const audio: Track = { id: "au", name: "Audio", kind: "audio", clips: Array.from({ length: 60 }, (_, i) => ({ id: `cl${i}`, start: i, length: 0.8, offset: 0, label: `Clip ${i}` })) };
    const seq2: Sequence = { ...base, tracks: [...base.tracks.slice(0, 2), audio, ...colorTracks, ...base.tracks.slice(2)], markers: Array.from({ length: 100 }, (_, i) => ({ id: `mk${i}`, beat: i * 0.6, label: `M${i}` })) };
    const tl2 = createTimeline(host, { sequence: seq2, clock: { getTime: () => 4, subscribe: () => () => {} }, expanded: [] });
    await raf(); await raf();
    const ch2 = host.querySelector(".tl-root")!.children[1] as HTMLElement;
    const r2 = () => ch2.getBoundingClientRect();
    (ch2 as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
    (ch2 as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () => false;
    const p2 = (type: string, x: number, y: number, o: PointerEventInit = {}) => ch2.dispatchEvent(new PointerEvent(type, { clientX: r2().left + x, clientY: r2().top + y, pointerId: 1, button: 0, buttons: type === "pointerup" ? 0 : 1, bubbles: true, cancelable: true, ...o }));
    const v2 = (v: Partial<ReturnType<Timeline["getView"]>>) => tl2.setView({ ...tl2.getView(), ...v });
    const X2 = (b: number) => (b - tl2.getView().startBeat) * tl2.getView().pxPerBeat;
    v2({ startBeat: 0, pxPerBeat: 14, scrollY: 0 }); await raf(); await raf();
    res["select marker (click)"] = await measure(100, (i) => { const x = X2((i % 100) * 0.6) + 6; p2("pointerdown", x, RULER + 6); p2("pointerup", x, RULER + 6); });
    res["sanity after marker click"] = `${tl2.getSelection().markers.size}`;
    res["select markers (shift-click)"] = await measure(60, (i) => { const x = X2((i % 100) * 0.6) + 6; p2("pointerdown", x, RULER + 6, { shiftKey: true }); p2("pointerup", x, RULER + 6, { shiftKey: true }); });
    const ar = flattenRows(tl2.getSequence(), new Set(), tl2.getTheme().rows).rows.find((r) => r.kind === "track" && r.track.kind === "audio")!; const ay = RULER + ar.y + ar.h / 2;
    res["select clip (click)"] = await measure(60, (i) => { const x = X2(i % 60) + 8; p2("pointerdown", x, ay); p2("pointerup", x, ay); });
    res["sanity after clip click"] = `${tl2.getSelection().clips.size}`;
    res["select clips (shift-click)"] = await measure(60, (i) => { const x = X2(i % 60) + 8; p2("pointerdown", x, ay, { shiftKey: true }); p2("pointerup", x, ay, { shiftKey: true }); });
    res["selected markers / clips (sanity)"] = `${tl2.getSelection().markers.size} / ${tl2.getSelection().clips.size}`;
    v2({ startBeat: 0, pxPerBeat: 14, scrollY: 60 }); await raf(); await raf();
    res["color rows: scroll"] = await measure(60, (i) => v2({ scrollY: 60 + i * 6 }));
    res["color rows: pan"] = await measure(120, (i) => v2({ scrollY: 60, startBeat: i * 0.2 }));
    res["color rows: zoom"] = await measure(60, (i) => v2({ scrollY: 60, startBeat: 0, pxPerBeat: 6 + (i % 30) }));
    v2({ startBeat: 0, pxPerBeat: 14, scrollY: 60 }); await raf(); await raf();
    res["color rows: hover readout"] = await measure(120, (i) => ch2.dispatchEvent(new PointerEvent("pointermove", { clientX: r2().left + 100 + i * 5, clientY: r2().top + RULER + 4 * 28 + 14, pointerId: 1, buttons: 0, bubbles: true })));
    res["color rows: edit one color key"] = await measure(40, (i) => tl2.edit("bench color", (s) => ({ ...s, tracks: s.tracks.map((t) => t.id === "col3" && t.kind === "channels" ? { ...t, channels: t.channels.map((c, j) => j === 0 ? { ...c, keys: c.keys.map((k, n) => n === 10 ? { ...k, value: 10 + i } : k) } : c) } : t) })));
    tl2.destroy(); host.replaceChildren();
  }

  // 7c. Nested sequences, event lanes, audio clips with peaks, outliner with 200 tracks, rename.
  {
    const inner = (n: number): Sequence => ({ ...fixture(6, 300), id: `in${n}`, name: `Inner ${n}`, length: 8 });
    const library: Record<string, Sequence> = {}; for (let i = 0; i < 4; i++) library[`in${i}`] = inner(i);
    const nested: Track = { id: "nst", name: "Nested", kind: "sections", sections: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, start: i * 2, length: 1.8, row: 0, label: `Nest ${i}`, ref: { sequenceId: `in${i % 4}`, loop: i % 2 === 0 } })) };
    const events: Track = { id: "evs", name: "Events", kind: "events", events: Array.from({ length: 600 }, (_, i) => ({ id: `ee${i}`, beat: (i * 7) % 60 + (i % 5) * 0.05, name: `Event number ${i}` })) };
    const sr = 8000, secs = 60; const pcm = new Float32Array(sr * secs); for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * 0.05) * Math.sin(i * 0.0003);
    const peaks = new Map([["wav", buildPeakMips(pcm, sr)]]);
    const audio: Track = { id: "aud", name: "Audio", kind: "audio", clips: Array.from({ length: 60 }, (_, i) => ({ id: `ac${i}`, start: i, length: 4, offset: (i % 10) * 2, peaksId: "wav", fadeIn: 0.3, label: `Clip ${i}` })) };
    const base = fixture(200, 50);
    const seq3: Sequence = { ...base, library, tracks: [nested, events, audio, ...base.tracks.slice(2)] };
    const t0 = performance.now(); const h3 = heap();
    const tl3 = createTimeline(host, { sequence: seq3, clock: { getTime: () => 4, subscribe: () => () => {} }, expanded: [], peaks });
    await raf(); await raf();
    res["startup mixed (200 tracks, nested+events+audio) ms"] = +(performance.now() - t0).toFixed(1);
    res["startup mixed heap MB"] = +((heap() - h3) / 1048576).toFixed(1);
    const v3 = (v: Partial<ReturnType<Timeline["getView"]>>) => tl3.setView({ ...tl3.getView(), ...v });
    v3({ startBeat: 0, pxPerBeat: 20, scrollY: 0 }); await raf(); await raf();
    res["mixed: pan"] = await measure(120, (i) => v3({ startBeat: i * 0.2 }));
    res["mixed: zoom"] = await measure(120, (i) => v3({ startBeat: 0, pxPerBeat: 6 + (i % 60) }));
    v3({ startBeat: 0, pxPerBeat: 30 }); await raf(); await raf();
    res["mixed: scroll (200 tracks)"] = await measure(120, (i) => v3({ scrollY: i * 30 }));
    v3({ scrollY: 0 }); await raf(); await raf();
    res["rename track (edit + outliner refresh)"] = await measure(60, (i) => tl3.edit("bench rename", (s) => applyRename(s, { kind: "track", trackId: `t${i % 200}` }, `Renamed ${i}`)));
    res["rename event (600 events)"] = await measure(40, (i) => tl3.edit("bench rename", (s) => applyRename(s, { kind: "event", trackId: "evs", id: `ee${i}` }, `Cue ${i}`)));
    res["rename clip"] = await measure(40, (i) => tl3.edit("bench rename", (s) => applyRename(s, { kind: "clip", trackId: "aud", id: `ac${i}` }, `Take ${i}`)));
    tl3.destroy(); host.replaceChildren();
  }

  // 8. Serialize / parse throughput on the full fixture
  {
    const s = fixture(200, 2000);
    let t0 = performance.now(); let json = ""; for (let i = 0; i < 3; i++) json = serializeSequence(s);
    const ser = (performance.now() - t0) / 3;
    t0 = performance.now(); for (let i = 0; i < 3; i++) parseSequence(json);
    const par = (performance.now() - t0) / 3;
    res["serialize ms (400k keys)"] = +ser.toFixed(1); res["parse ms (400k keys)"] = +par.toFixed(1);
    res["json MB"] = +(json.length / 1048576).toFixed(1);
  }
  return res;
}

(window as unknown as { runBench: typeof runBench }).runBench = runBench;
if (location.search.includes("auto")) runBench().then((r) => { (window as unknown as { benchResult: unknown }).benchResult = r; document.getElementById("out")!.textContent = JSON.stringify(r, null, 1); });
