# Contributing

Issues and pull requests are welcome. Bigger changes are easier to land if you open an issue first and describe what
you want to change.

## Setup

```bash
npm install
npm run dev     # demo at http://localhost:5173/ (studio at /studio.html)
npm run check   # tsc --noEmit && vitest run, should finish in a few seconds
```

Check visual changes in the studio demo. For anything that touches drawing or dragging, also try `/?stress` and run
`npm run bench`, which drives the demo in headless Chrome and prints frame timings. The budget is a p95 of 8 ms or less
per step. The bench looks for Chrome at the default macOS path; set `CHROME=/path/to/chrome` elsewhere.

## Layout

```
src/core/    model types, beats and tempo math, key evaluation, easing, time formats, row layout,
             overlap lanes, nested time, snapping, event spans, color, waveform peaks, JSON
src/edit/    pure Sequence -> Sequence commands (sections, keys, tracks, audio, color), history,
             selection, clipboard, auto-key, groups, bindings, quantize
src/view/    canvas layers, rendering, hit-testing, drag gestures, keymap, outliner (DOM),
             curve editor, theme; timeline.ts holds createTimeline
src/index.ts the public API
demo/        the demos served by `npm run dev`
tests/       vitest, core logic only
```

## Rules the code follows

- `src/core` and `src/edit` have no DOM access. Rendering and input live in `src/view`.
- No runtime dependencies.
- The host owns playback time. The library takes an external clock and reports edits; it never plays audio.
- Edits are pure functions that return a new `Sequence` with structural sharing. A drag previews and commits once.
- The serialized `Sequence` is versioned. After the first release a breaking change needs a migration in
  `src/core/serialize.ts`.
- `docs/behavior.md` is the spec. Source comments cite its sections by number, so keep the numbers stable and add new
  sections at the end.
- No GPL or AGPL code. MIT, BSD or Apache code is fine; note its source and license at the top of the file.

## Tests

Tests cover core logic, where they pay: time and tempo math, snapping, edit commands with undo and redo, and
serialization. Rendering and the demo are checked by hand in the browser. `tsconfig.json` has
`noUncheckedIndexedAccess`, so expect to write `arr[0]!` in tests.
