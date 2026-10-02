# API reference

Everything here is exported from the package root (`src/index.ts`) unless noted. For the quick start see the
[README](../README.md); for behavior decisions see [behavior.md](behavior.md).

Contents: [Install](#install) · [createTimeline](#createtimeline) · [Options](#options-timelineoptions) ·
[Handle](#handle-timeline) · [Clock](#clock) · [Read-only and host edits](#read-only-and-host-edits) ·
[Custom painters](#custom-painters) · [Keymap](#keymap) · [Theme](#theme) · [Data model](#data-model) ·
[Serialization](#serialization) · [Time and grid](#time-and-grid) · [Edit commands](#edit-commands) ·
[History](#history) · [Selection](#selection) · [Clipboard](#clipboard-and-splitting) · [Color groups](#color-groups) ·
[Curves and easing](#curves-and-easing) · [Layout](#layout) · [Snapping](#snapping) · [Nested sequences](#nested-sequences) ·
[Events](#events) · [Audio and peaks](#audio-and-peaks) · [Scripts](#scripts)

## Install

Not yet published to npm. Install from GitHub; the `prepare` script builds `dist/` on install:

```bash
npm install github:v1vendi/real-timeline-editor
```

Or from a checkout: `npm install && npm run build` (vite bundle into `dist/index.js` plus tsc declarations).

The package is ESM-only (`import` export, types at `dist/index.d.ts`). Use `"moduleResolution": "Bundler"` for types.
The core has no DOM access and no runtime dependencies.

## createTimeline

`createTimeline(el: HTMLElement, o: TimelineOptions): Timeline` mounts the widget into `el`. The container needs an
explicit size (the widget fills 100% width and height). Call `destroy()` on the returned handle to remove it.

```ts
import { createTimeline, parseSequence, serializeSequence } from "real-timeline-editor";

let beat = 0;                                   // your transport owns this
const tl = createTimeline(el, {
  sequence: parseSequence(savedJson),
  clock: { getTime: () => beat },
  onSeek: (b) => { beat = b; },
  onChange: (seq, info) => save(serializeSequence(seq)),  // info: ChangeInfo
});
```

## Options (`TimelineOptions`)

`sequence` and `clock` are required; everything else is optional.

### Document and clock

- `sequence`: initial `Sequence`.
- `clock`: a `TimelineClock`, see [Clock](#clock).
- `newId()`: id generator for created sections, markers and so on.
- `readOnly`: start read-only, see [Read-only and host edits](#read-only-and-host-edits).
- `expanded`: iterable of track ids to start expanded.
- `outliner`: show the left track outliner (default `true`). `outlinerWidth`: its width in px (default 180).
- `gridMode`: initial grid flavor, a `GridMode` (default `"straight"`). Drives grid lines, snapping, step keys and the ruler readout.

### Callbacks

- `onChange(seq, info)`: after every user edit, undo and redo. Not fired by `setSequence`. `info` is a
  `ChangeInfo`: `{ label, kind: "edit" | "undo" | "redo" }`.
- `onSeek(beat)`: ruler scrub or jump keys. The host decides whether to move its clock.
- `onSelect(sel)`: the user changed the selection (click, box select, select all) or an edit pruned it. Not fired by `setSelection`.
- `onSelectionChange(sel)`: alias of `onSelect`.
- `onPlayToggle()`: play/pause key (Space).
- `onAddMarker(beat)`: marker key (M).
- `onOpenCurve(trackId, channelId?)`: double-click on a channel row, a collapsed channels track or a key. Open your own curve editor.
- `onPickColor(trackId, groupId, beat | null)`: double-click on a color group row (expanded or collapsed). On a stop mark
  `beat` is its beat; elsewhere on the gradient strip it is the beat under the pointer (you may add a stop there). Takes
  precedence over `onOpenCurve` on those rows. Dragging a selected mark on a collapsed color row moves every selected
  stop (`moveColorStops`) and other selected keys together.
- `onWorkRange(range | null)`: Shift+drag on the ruler sets the work range, Shift+click clears it (`null`). Not serialized.
- `onGridMode(mode)`: the user clicked the ruler readout to change the grid flavor. Not fired by `setGridMode`.
- `onNavigate(crumbs)`: after the user enters a nested section (double-click) or goes up (Esc, Alt+Up, the in-canvas "Up"
  button or a crumb). `crumbs` is root-first. Inside a child the widget is read-only.
- `onKeymapWarning({ conflicts, invalid })`: called once at creation when `keymapOverrides` binds one chord to several
  actions or contains unparseable or unknown entries.

### Host hooks

- `resolvePeaks(id)`: lazy `PeaksHook` for `AudioClip.peaksId` (sync or promise), asked once per id when `peaks` has no entry.
- `resolveSequence(id)`: synchronous `SequenceResolver` for a nested `ref.sequenceId` that is not in `Sequence.library`.
- `peaks`: a `PeaksMap` (`ReadonlyMap<string, PeakMips>`) of waveform peaks for audio clips.

### Painters, keys and theme

- `renderSection`, `renderAudio`, `renderKey`: custom painters, see [Custom painters](#custom-painters).
- `keymap`, `keymapOverrides`: see [Keymap](#keymap).
- `theme`: a `ThemeInput`, see [Theme](#theme).

## Handle (`Timeline`)

Document and history:

- `getSequence()`, `setSequence(seq)` (replaces the document, clears undo history, no `onChange`).
- `edit(label, fn)`: apply a pure `seq => seq` edit as one undo entry, fires `onChange` with `kind: "edit"`. No-op when read-only or `fn` returns the same object.
- `undo()`, `redo()`, and the getters `canUndo`, `canRedo`.

Selection and rename:

- `getSelection()`, `setSelection(sel)` (ids that do not exist are dropped, `onSelect` is not fired).
- `renameSelection()`: open the inline rename editor on the selected row, or the single selected section or event (what R or F2 does). Returns `false` when there is nothing to rename.

Modes and navigation:

- `readOnly` (getter), `setReadOnly(on)`.
- `getCrumbs()` (root-first, length 1 at the root), `goTo(depth)` (0 = root).
- `getWorkRange()`, `setWorkRange(r)` (`{ start, end, loop? } | null`, does not fire `onWorkRange`).
- `getGridMode()`, `setGridMode(m)` (does not fire `onGridMode`).
- `getView()`, `setView(v)`: a `ViewState` of `{ startBeat, pxPerBeat, scrollY }`.

Layout and look:

- `foldAll(fold?)`: collapse (default) or unfold every expandable track and folder.
- `getExpanded()` (a copy of the expanded ids), `setExpanded(ids)`.
- `setOutliner(on)`: show or hide the outliner at runtime.
- `fitRowHeight()`: scale row heights so every row fits the viewport (clamped). `resetRowHeight()` restores the defaults.
- `getTheme()`, `setTheme(t)`.

Audio and lifecycle:

- `setPeaks(p)`, `reloadPeaks(id?)`: forget cached `resolvePeaks` results (all or one id) and repaint.
- `redraw()`: repaint after host-side changes, for example a clock jump without `subscribe`.
- `destroy()`: remove every listener, observer, frame request and the DOM it created. Idempotent; other methods become no-ops.

## Clock

`TimelineClock` is `{ getTime(): Beats; subscribe?(cb): () => void }`. Without `subscribe` the widget polls `getTime`
each frame; with it, push changes and the widget repaints on demand.

```ts
const subs = new Set<(b: number) => void>();
createTimeline(el, {
  sequence,
  clock: { getTime: () => beat, subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)) },
  onSeek: (b) => { beat = b; subs.forEach((f) => f(b)); },
});
```

Call `tl.redraw()` after a clock jump if you do not use `subscribe`. The library never plays audio and never fires
events itself; see [Events](#events).

## Read-only and host edits

Read-only blocks drags and trims, edit shortcuts (undo, redo, cut, paste, duplicate, split, delete), outliner edits,
and `undo()`/`redo()`. Selection, scrub, navigation, expand/collapse, copy, `onSeek`, `onPlayToggle` and `setSequence`
still work.

`setSequence` replaces the document and clears undo history. To change the sequence from host UI (a toolbar add-clip,
editing `Section.data`) and keep it undoable, use `edit`:

```ts
tl.edit("Add clip", (seq) => addSection(seq, "fx", { id: newId(), start: 4, length: 8, label: "Chase" }));
```

## Custom painters

Each painter draws inside a clip of its section, clip or key and returns `true` to skip the default look.

```ts
renderSection: (ctx, s, rect, track) => {      // rect: { x, y, w, h } in canvas px
  if (s.data === undefined) return false;       // fall back to the default fill and label
  ctx.fillStyle = "#7a3fa0"; ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = "#fff"; ctx.fillText(String(s.label), rect.x + 5, rect.y + 5);
  return true;
}
```

- `renderSection(ctx, section, rect, track)`: skips the default fill and label.
- `renderAudio(ctx, clip, rect, track)`: skips the default fill and waveform.
- `renderKey(ctx, key, { x, y, r }, { trackId, channelId, selected })`: `x, y` is the center and `r` the radius in px. Skips the default diamond. Not called for keys collapsed by density.

## Keymap

Actions are `CommandId`s; `COMMAND_IDS` lists them all:
`delete duplicate copy cut paste selectAll playToggle stepBack stepForward jumpStart jumpEnd split marker undo redo clear
addEvent prevMarker nextMarker zoomSelection zoomOut nudgeLeft nudgeRight quantize goUp rowPrev rowNext rename`.

`DEFAULT_BINDINGS` maps each to canonical chord strings (`"Mod"` = Ctrl or Cmd). Defaults: Delete/Backspace, Mod+D,
Mod+C/X/V/A, Space, Arrow keys, Shift+Arrow (jump to start/end), S (split), M (marker), E (event), Mod+Z, Mod+Shift+Z or
Mod+Y, Escape (clears the selection; with nothing selected inside a child sequence it leaves the child), Alt+Up (`goUp`),
Alt+, and Alt+. (marker jump), Z (zoom to selection), X (zoom out), Mod+Left/Right (nudge), Q (quantize), Up/Down (row
selection), R or F2 (rename: inline-rename the selected row, section, event, marker or clip; double-clicking a name also renames).

Prefer `keymapOverrides` (per-action, merged over the defaults); `keymap` replaces the defaults wholesale:

```ts
keymapOverrides: { undo: "Mod+Shift+Z", split: null }       // null or [] unbinds an action
keymap: { Space: "playToggle", "Mod+Z": "undo", Delete: "delete" }   // complete chord -> CommandId map
```

- `KeymapOverrides`: `Partial<Record<CommandId, string | string[] | null>>`. `keymapOverrides` wins over `keymap`.
- `buildKeymap(overrides?)` returns a `ResolvedKeymap` `{ map, conflicts, invalid }` with conflict detection. Two overrides on one chord produce a `KeymapConflict` (`{ chord, actions }`); an override displacing a default does not.
- `normalizeChord(text)`: canonical string or `null`. `parseChord(text)`: parts (`mod`, `alt`, `shift`, `key`) or `null`.
- `eventChord(e)`: canonical chord for a keyboard event, to match against a `keymap`.

## Theme

One `Theme` object holds every color, font, radius and default row height. `darkTheme` and `lightTheme` are the two
bases; `resolveTheme(input?)` merges a `ThemeInput` (a deep partial plus `base?: "dark" | "light"`) over its base.
Pass a partial as `TimelineOptions.theme` or call `tl.setTheme(partial)`; it repaints both canvas layers and the
outliner, and `tl.getTheme()` returns the resolved object. Each call replaces the previous theme, it does not stack.

```ts
const tl = createTimeline(el, { sequence, clock, theme: { base: "light", color: { accent: "#d6336c", section: "#7a5af8" } } });
tl.setTheme({ base: "dark", radius: { bar: 8 } });
```

`Theme` fields: `name`, `font` (`ui`, `mono`, `size`, `small`), `radius` (`bar`, `chip`), `rows` (`trackH`, `channelH`),
and `color` (canvas, ruler, content, curve-series, color-group and outliner colors; see `src/view/theme.ts` for the
full list). The outliner and crumb bar read `--tl-*` CSS custom properties set on the widget root. The studio demo has a
dark/light toggle in Settings.

## Data model

Types are exported from `src/core/model.ts`. Time is in `Beats`.

- `Sequence`: `{ version: 1, id, name, length, beatsPerBar, tempo: TempoPoint[], tracks: Track[], markers: Marker[], library: Record<string, Sequence> }`.
- `Track` is one of five kinds (`TrackKind`): `SectionTrack` (`sections`), `ChannelTrack` (`channels`, optional `groups`),
  `AudioTrack` (`clips`), `EventTrack` (`events`), `FolderTrack` (`children`). All share `id`, `name`, `muted?`, `solo?`,
  `locked?` and `binding?` (`TrackBinding`: an opaque `targetId` of a host object the track drives).
- `Section`: `id, start, length, row` (overlap lane, assigned by the editor), plus optional `offset`, `scale`, `easeIn`,
  `easeOut`, `easeInShape`, `easeOutShape`, `ref` (`{ sequenceId, loop? }`), `label`, `color`, `data` (yours).
- `Channel`: `{ id, name, keys: Key[] }`. `Key`: `{ beat, value, interp, tan? }`; the segment after a key uses its `interp`
  (`Interp`: `"constant" | "linear" | "bezier"`). `Tangent` holds bezier handles relative to the key
  (`mode: "auto" | "aligned" | "free"`, `inDx`, `inDy`, `outDx`, `outDy`).
- `ChannelGroup`: `{ id, name, kind?, channelIds, color?, range? }`, channels shown and edited together. See [Color groups](#color-groups).
- `AudioClip`: `{ id, start, length, offset, fadeIn?, fadeOut?, gain?, peaksId?, label? }`. `peaksId` names host peaks, which stay outside the serialized model.
- `TimelineEvent`: `{ id, beat, name, payload? }`, a named point event. `Marker`: `{ id, beat, label, color? }`.
- `TempoPoint`: `{ beat, bpm }`; the tempo map must be sorted and start at beat 0.
- `BEAT_RESOLUTION` is 960: beats are quantized to 1/960 on commit, and `quantize(beat)` does the rounding.

The model stays `version: 1` until the first release (changed in place, no migrations yet); after that a breaking
change bumps `version` and adds a migration.

## Serialization

- `parseSequence(textOrObject)`: migrates to the current version, validates, throws `SequenceFormatError` (with `.issues`).
- `serializeSequence(seq, space?)`: JSON string with stable key order.
- `validateSequence(seq)`: list of problems (empty when valid).
- `CURRENT_VERSION` is `1`.

```json
{ "version": 1, "id": "show", "name": "Show", "length": 32, "beatsPerBar": 4,
  "tempo": [{ "beat": 0, "bpm": 120 }],
  "tracks": [
    { "id": "fx", "kind": "sections", "name": "Effects",
      "sections": [{ "id": "s1", "start": 2, "length": 8, "row": 0, "label": "Chase" }] },
    { "id": "d", "kind": "channels", "name": "Dimmers",
      "channels": [{ "id": "dim", "name": "dim", "keys": [{ "beat": 0, "value": 10, "interp": "linear" }] }] }
  ],
  "markers": [{ "id": "m", "beat": 8, "label": "Drop" }],
  "library": {} }
```

## Time and grid

- `beatToSeconds(tempo, beat)` and `secondsToBeat(tempo, seconds)` integrate the piecewise-constant tempo map.
- `beatToFrames(tempo, beat, fps)`, `formatBeat(tempo, beat, mode, fps?)` with a `TimeDisplay` (`"seconds" | "timecode" | "frames"`).
- `fitLength(seq)`: the length that fits the content (last key beat or section/clip end; 0 when empty).
- `GridMode` is `"straight" | "triplet" | "dotted"`. `tickSteps(pxPerBeat, beatsPerBar, minLabelPx?, minMinorPx?, mode?)` returns `TickSteps` for ruler ticks; `gridStep(pxPerBeat, beatsPerBar, minPx?, mode?)` the grid step in beats.

## Edit commands

All edit operations are pure (`Sequence` in, `Sequence` out) and compose with [`History`](#history) or `tl.edit`.

```ts
const next = addKey(seq, "dimmers", "dim", { beat: 4, value: 80, interp: "linear" });
tl.edit("Add key", (s) => addKey(s, "dimmers", "dim", { beat: 4, value: 80, interp: "linear" }));
```

Sections (`src/edit/sectionCommands.ts`):

- `addSection(seq, trackId, section)` (`row` optional), `deleteSection(seq, trackId, id)`, `moveSection(seq, trackId, id, start)`.
- `trimSection(seq, trackId, id, edge, beat, minLength?)` with `edge` `"start" | "end"`; `MIN_SECTION_LENGTH` (1/16 beat) is the default minimum.
- `moveSectionToTrack(seq, fromId, id, toId, start)`.

Keys and channels:

- `addKey(seq, trackId, channelId, key)`, `moveKeys(seq, refs, dBeat, dValue?)`, `deleteKeys(seq, refs)`, `setInterp(seq, refs, interp)`.
- `setHandle(seq, ref, side, dx, dy)` edits a bezier handle (`side` `"in" | "out"`).
- `setKeys(seq, refs, spec)` batch-sets keys from a `SetKeysSpec` (`value`, `dValue`, `beat`, `dBeat`) and returns a `SetKeysResult` `{ seq, refs }` with where each ref ended up.
- `movedKeyRef(ref, dBeat, earliest?)`: a `KeyRef` after a move. `KeyRef` is `{ trackId, channelId, beat }`.
- `addChannel(seq, trackId, channel, index?)`, `removeChannel(seq, trackId, channelId)`.
- Auto-key: `setValueAtTime(seq, ref, beat, value, o?)` creates or updates a key, with `AutoKeyOptions` (`autoKey`, `interp`). `ChannelRef` is `{ trackId, channelId }`. `applyValueAtTime(history, ref, beat, value, o?)` does the same through a `History`.
- Groups: `groupSummary(track, group)` returns `GroupSummaryKey[]`; `moveGroupKeys(seq, trackId, groupId, beat, dBeat, dValue?)`, `applyMoveGroupKeys(history, ...)` (same arguments after the history), `setGroup(seq, trackId, group)`.

Tracks, events and markers (`src/edit/trackCommands.ts`):

- `addTrack(seq, track, index?, parentId?)`, `removeTrack(seq, trackId)`, `moveTrack(seq, trackId, toIndex)`, `nestTrack(seq, trackId, parentId | null, index?)`, `findTrack(tracks, id)`.
- `addEvent(seq, trackId, event)`, `moveEvent(seq, trackId, id, beat)`, `deleteEvent(seq, trackId, id)`.
- `moveMarker(seq, id, beat)`, `deleteMarker(seq, id)`.

Audio clips:

- `deleteClip(seq, trackId, id)`, `setAudioFade(seq, trackId, id, { fadeIn?, fadeOut? })`, `setAudioGain(seq, trackId, id, gain)`.

Renaming (`cleanName(name)` trims and returns `undefined` for an empty name):

- `renameTrack`, `renameChannel`, `renameSection`, `renameEvent`, `renameClip`, `renameMarker`.

Nudge and quantize:

- `nudgeSelection(seq, sel, steps, step)` and `quantizeSelection(seq, sel, step, strength?)` take an `EditSelection` (`{ keys?: KeyRef[], sections?: SectionRef[] }`, `SectionRef` is `{ trackId, id }`) and return a `MovedSelection` (`{ seq, keys, sections }`).

Track bindings (`src/edit/binding.ts`): `setTrackBinding(seq, trackId, targetId | null)`, `retargetBinding(seq, from, to)`,
`bindingOf(track)`, `brokenTrackIds(seq, valid)` (with a `BindingValidity` predicate answered by the host),
`applyBindSelected(history, trackIds, targetId)`, `applyRetarget(history, from, to)`.

## History

`History` keeps undo/redo over immutable `Sequence` snapshots. Selection is not part of history.

```ts
const h = new History(seq, { onChange: (s, info) => render(s) });
h.apply("Move", (s) => moveSection(s, "fx", "s1", 4));
h.undo(); h.redo();
h.begin("Drag"); h.preview((s) => moveSection(s, "fx", "s1", 5)); h.commit();   // a gesture is one entry
```

- `new History(seq, options?)`: `HistoryOptions` are `cap` (default 200), `mergeWindowMs` (default 500), `now`, `onChange`.
- `apply(label, fn, mergeKey?)`: one command, one entry; consecutive edits sharing a `mergeKey` inside the window coalesce.
- `begin(label, mergeKey?)`, `preview(fn)`, `commit()`, `cancel()`: a gesture as one entry.
- `undo()`, `redo()` return whether anything happened; `canUndo`, `canRedo`; `seq`, `past`, `future` (`HistoryEntry[]`) are readable.

## Selection

`Selection` holds seven immutable id sets: `sections`, `keys`, `channels`, `tracks`, `events`, `markers`, `clips`.
Keys and events are encoded ids.

- `emptySelection`, `clearSelection()`, `isEmpty(sel)`.
- `select(sel, kind, ids, mode?)` with a `SelectionKind` and `SelectMode` (`"replace" | "toggle" | "add"`).
- `pruneSelection(sel, seq)` drops ids that no longer exist.
- `keyId(ref)` / `parseKeyId(id)` and `eventId(trackId, id)` / `parseEventId(ref)` encode and decode ids. Audio clip ids use the `eventId` encoding.

## Clipboard and splitting

- `copySelection(seq, sel)` returns a `Clipboard` or `null`; `cutSelection(seq, sel)` returns `{ seq, clip }` or `null`.
- `paste(seq, clip, playhead, newId, target?)` with a `PasteTarget` (`{ trackId?, channelId? }`) returns a `PasteResult` (`{ seq, sections, keys, events }`, the new ids for re-selecting).
- `duplicate(seq, sel, newId, step)` returns a `PasteResult`.
- `splitSection(seq, trackId, id, at, newId)` returns `{ seq, id }`; `splitAt(seq, sel, at, newId)` splits every selected section under `at` and returns `{ seq, ids }`.

## Color groups

Channel groups of kind `rgb`, `rgba`, `hsv` or `hue` are colors (`range` is the max channel value, default 255 for
rgb/rgba and 1 for hsv s/v/a; hue is always degrees 0..360).

- Read: `colorAt(seq, trackId, groupId, beat)` returns an `Rgba` (`{ r, g, b, a }`); `colorStops(seq, trackId, groupId, t0, t1, maxStops?)` returns `ColorStop[]` (`{ beat, css }`).
- Convert: `hsvToRgb`, `rgbToHsv`, `toHex(rgba)`, `toCss(rgba)`.
- Edit a whole stop (all channels at one beat) as one pure step, so a host color picker never touches channels one by one:
  `setGroupColor(seq, ref, beat, color)`, `addColorStop(seq, ref, beat, color?)`, `moveColorStop(seq, stopRef, dBeat)`,
  `moveColorStops(seq, stops, dBeat)`, `removeColorStop(seq, stopRef)`. `ColorGroupRef` is `{ trackId, groupId }`; `ColorStopRef` adds a `beat`.
- `colorStopsDelta(seq, stops, dBeat)`: the shared beat delta `moveColorStops` will actually apply (clamped so stops stay at or after 0 and do not collide with or pass non-moving stops). `splitColorStops(seq, refs)`: separate a key selection into `{ stops, keys }`.

## Curves and easing

- `evaluate(channel, beat)`: value at a beat (holds the first and last key outside the range; `undefined` for an empty channel). `findKey(keys, beat)`: index of the last key at or before `beat` (-1 if `beat` precedes all keys). `handlesOf(keys, i)`: bezier `Handles` of key `i`.
- `EASE_SHAPES` lists the `EaseShape`s (`linear sine quad cubic quart expo circ`); `isEaseShape(x)` tests a value.
- `easeValue(shape, t)`: eased 0..1. `easeWeight(t, start, length, easeIn?, easeOut?, inShape?, outShape?)`: blend weight of a section at time `t`, for hosts that fade sections in and out.
- `mountCurveEditor` is not exported from the package root yet (demo: the curve dialog in `studio.html`). Use `onOpenCurve` to host your own.

## Layout

Pure row layout, used by the widget and useful for custom UI.

- `flattenRows(seq, expansion?, metrics?)` returns a `RowLayout`; a `Row` describes one visible row. `ExpansionState` is the expanded-id state; `toggleExpanded(state, id, on?)`, `isExpanded`, `expandableIds(tracks)`.
- `RowMetrics` with `DEFAULT_ROW_METRICS`; `trackHeight(track, m?)`, `lanePitch(track, m?)`.
- Lookup: `rowIndexAtY(layout, y)`, `rowAtY(layout, y)`, `visibleRowRange(layout, y0, y1)`, `laneAtY(row, y, m?)`.
- Overlap lanes: `assignLanes(sections)`, `placeSection(section, existing)`, `firstFreeLane(span, others)`, `laneCount(sections)`.

## Snapping

A `SnapProvider` is `(ctx: SnapContext) => SnapTarget[]`. The context has `pxPerBeat`, `beatsPerBar`, `gridMode?`, the
`beat` being dragged, a visible `range` and an `exclude` set. A `SnapTarget` is `{ beat, kind: SnapKind, id? }`.

- `resolveSnap(providers, ctx, opts?)` returns the winning `SnapTarget` or `null`; `snapBeat(providers, ctx, opts?)` returns just the beat. `SnapOptions` are `thresholdPx` and `disabled`.
- `defaultProviders(seq, getPlayhead)` builds the standard set from `gridProvider`, `playheadProvider(getBeat)`, `markerProvider(seq)`, `sectionEdgeProvider(seq)`, `keyProvider(seq, excludeKey?)` and `eventProvider(seq)`.
- `SNAP_THRESHOLD_PX` (8) and `SNAP_PRIORITY` (marker, playhead, section, key/event, grid).

## Nested sequences

A section nests another sequence from `Sequence.library` via `ref: { sequenceId, loop? }`. Child time is
`(t - start) * scale + offset`.

- `resolveSequence(root, id, host?)` finds a child in the library or via a `SequenceResolver` hook.
- `parentToChild(section, t, childLength)` and `childToParent(section, c)` convert time; `sectionContains(section, t)`.
- `childRefs(seq)`, `wouldCreateCycle(root, hostId, refId)`, `findCycle(root)`, `danglingRefs(root)`.

## Events

Event tracks hold named point events. The library never fires them; `eventsBetween(seq, t0, t1, opts?)` is a pure
query for playback hosts. It returns `EventHit[]` (`{ event, trackId, pass }`) in firing order within `[t0, t1)`, skips
muted tracks, and with `EventsOptions.loop` handles a span that wraps (`t1 < t0`): `pass` is 0 for the first segment and
1 after the wrap, so the host can dedupe per pass.

## Audio and peaks

Peaks are supplied by the host and stay outside the serialized model.

- `buildPeaks(samples, sampleRate, samplesPerPeak)` returns `Peaks` (`peaksPerSecond`, `min`, `max`). `downsamplePeaks(peaks)` halves the resolution.
- `buildPeakMips(samples, sampleRate, opts?)` builds `PeakMips` (a pyramid of `Peaks`); `pickMip(mips, pxPerSecond)` picks the level index whose resolution suits the zoom.
- `lazyPeaks(hook, onLoad)` wraps a `PeaksHook` as a reader: each id is asked once, failures and unknown ids are cached until `reset`. Returns `LazyPeaks` (`get(id)`, `reset(id?)`). The widget does this for you with `resolvePeaks`.

## Scripts

```bash
npm run dev     # vite demo: / (index), /studio.html, /widget.html, /bench.html
npm run build   # library bundle + declarations
npm run check   # tsc --noEmit && vitest run
npm run bench   # headless perf run
```
