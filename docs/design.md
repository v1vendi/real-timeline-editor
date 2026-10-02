# Design

This is the why behind the library: what we took from four editors we admire, what we left behind, and the reasons. Unreal's Sequencer, Unreal's UMG animation editor, Blender's animation editors and Ableton Live's Arrangement view are equal references. Each gets its own section below, organized the same way. Everything here is concepts in our own words; we did not copy code or text from any of those products. Exact behavior lives in [behavior.md](behavior.md), and the file layout is in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Principles and architecture

Three rules decide most of the verdicts in this document. The host owns playback and time, so the library never plays audio or runs a clock; it accepts an external playhead and reports edits. The core (`src/core`, `src/edit`) has no DOM access, which keeps it testable and reusable. And the serialized `Sequence` stays small and host-agnostic, because the host, not the library, knows what a track actually drives.

The code splits in three layers. `src/core` holds the model and the pure math: beats and tempo, key evaluation, easing, snapping, row layout, overlap lanes, nested time, event spans, peaks and JSON. `src/edit` holds commands, all pure `Sequence -> Sequence` functions, plus history, selection and clipboard. `src/view` holds the canvas layers, hit-testing, gestures, the outliner and the curve editor.

Edits use structural sharing: a command copies only the path to what changed. Snapshots are therefore cheap, undo just swaps references, and views can compare references to decide what to redraw. We never deep-clone 400k keys for one edit. History is a capped list (200 entries by default) of label, before and after, with coalescing for repeated edits such as nudging. A gesture calls `begin(label)`, then `commit()` or `cancel()`, so a whole drag is one undo step. Validation lives in the commands, not the UI: locked tracks, cycles in nested references, minimum lengths, sorted unique keys, lane assignment. Every commit emits `onChange(seq, {label, kind})` and the host owns persistence. Selection is a separate store, pruned of dangling ids after commits and undo.

Time is a float `Beats`, quantized to 1/960 of a beat on commit. Unreal uses integer ticks; we kept the float type and quantize so that equality, dedupe and serialization stay stable without a type change. Tempo is piecewise constant, and we do not support linear ramps.

The performance target is 200 tracks by 2,000 keys at 60 fps. We get there with a few habits:

- One flat row list, with a prefix-sum of row tops, so only the tens of visible rows are drawn.
- A binary search in each sorted key array for the visible time slice, and one mark per pixel column once keys are closer than about 3 px.
- Two canvas layers: a static one redrawn only when view, data or selection change, and an overlay (playhead, drag preview, box select, snap guide) redrawn on pointer move. The playhead must never repaint the static layer.
- One path and one fill per color for keys, with no per-key `save/restore` or text.
- A drag offsets the selected items at draw time without touching the model, then commits once on pointer up.
- Hit-testing reuses the row index and sorted arrays, with a pixel tolerance for keys and no picking buffer.
- Waveforms come from a pre-rendered peak mip pyramid.
- Canvases are sized by `devicePixelRatio`, and invalidations are coalesced with `requestAnimationFrame` and a dirty flag per layer.

We check this with a synthetic fixture in the demo (`npm run bench`), not with a unit test.

Serialized JSON carries a `version` field. It is still 1 and edited in place until the first release; `serialize.ts` already has the migration loop ready for when that changes. Ids are plain strings, with an injectable pure `newId()` so tests are deterministic.

## Unreal Sequencer

Sequencer is our primary model for data and interaction. In Unreal a scene owns bindings and tracks, a track owns sections, and a section owns typed channels that hold key times and values. Sections have a range, a row for overlap stacking and blend easing. Time is integer ticks with a separate display rate. A subsequence is just a section that points at another scene with a time transform. The editor is a tree of view models over that data, drags show a preview and then commit, and snapping is a set of providers.

What we borrowed:

- One flat row list drives layout, hit-testing, drawing and the outliner. We rebuild it only when structure or expansion changes, and each row carries `y`, `h`, `depth` and a reference to what it shows.
- Stored data stays separate from derived view data such as summary keys, stacked lanes and waveform mips.
- A gesture is a preview state plus one committed command.
- Snap providers are small functions that return candidate beats, with a single resolver choosing among them.
- Keys live in sorted arrays per channel, which gives binary search and cheap drawing.
- A nested sequence is a section with a time transform, resolved through `Sequence.library`. Blending is limited to ease in and out.
- Events are their own track kind rather than overloaded markers. Events carry a payload and loop semantics; markers need neither.

What we did not:

- Integer ticks, for the reason given above.
- Sections that own channels. Here channels belong to the track and sections are payload only. That suits our main consumer, a light show, and it is simpler. It is also why we reject several sections blending on one property (see the UMG section).
- Markers as a track kind. They live on `Sequence.markers`, because snap targets are global.
- Full blend evaluation. The library never evaluates blends; the host interprets ease weights.

## Unreal UMG animation

UMG's animation editor is Sequencer with a widget-flavored shell, so the data model matches and most of what we took sits around the model rather than in it.

What we borrowed:

- The track tree, as folder, then track, then channel rows. The widget-track-with-property-subtracks idea maps directly onto it.
- Bindings, kept thin. `Track.binding` holds an opaque host id, and commands can bind and retarget. The library never resolves targets; the host answers whether a binding is valid, and `brokenTrackIds` lets it ask the library which tracks fail.
- Channel grouping, so RGBA or a transform edits together. A group is a declaration on the track with a composite edit, and the collapsed summary row reuses the normal collapsed-row path.
- Event keys: a track kind plus a pure `eventsBetween(seq, t0, t1, {loop})`. The library reports hits inside a span the host supplies, and the host fires them. Events at the exact endpoints are allowed, and a `pass` field lets the host dedupe when a loop re-fires them.
- Easing on section ease handles: an easing shape enum and `easeValue(shape, t)`. The shape is a blend weight the host interprets.
- Auto-key: a pure `setValueAtTime` helper that writes one key with one history entry. The value source stays with the host.
- Frame display helpers and `fitLength`, which sizes the sequence from the last key.

What we did not, and why:

- Several stacked sections blending on one property. It conflicts with track-owned channels. If you need stacking, use separate tracks.
- Playback controls such as reverse, ping-pong and speed. The host owns playback, and advisory playback fields on `Sequence` would only duplicate host config.
- Multiple animations per object. Which sequence to show is host UI.
- Keys relative to a base value. The host can pre-offset when it needs that.
- A broken-binding badge, a group filter, a details-panel editor for numeric multi-key edits (the batch `setKeys` command exists, there is just no inspector), a per-section blend type badge (hosts keep it in `Section.data` for now) and a host property catalog behind an add-track menu. All of these are deferred until a host needs them.

## Blender

Blender's animation editors are the reference for how several views can share one data set. An action holds F-curves, each a sorted array of keyframe points with time, value, handles and interpolation. The NLA stacks tracks of non-overlapping strips that reference actions with offset, scale, repeat and blend. The Dope Sheet, Graph Editor, NLA and Timeline are all views over the same data: each builds a filtered flat list of channels per redraw, then draws and hit-tests against that list. Key transforms are modal operators with a live preview and cancel.

What we borrowed:

- The filtered flat channel list as the single source for drawing and hit-testing, which is the same row list described above.
- Sorted keypoint arrays per channel, so evaluation and picking are a binary search.
- Per-key interpolation and handles. The segment after a key uses that key's `interp` (constant, linear or bezier), with auto, aligned and free tangents. Auto tangents are clamped so curves never overshoot at extrema.
- A dope sheet and a curve editor as two views over the same channels, instead of two models.
- Modal transforms with preview and cancel, which became our `begin/commit/cancel` gesture lifecycle.

What we did not:

- The action and strip split of the NLA. A nested sequence is a section with a time transform, the Unreal way, so there is one concept for reuse instead of two.
- Strip-level repeat and blend stacking. Nested sections can loop via `Section.ref.loop`, and blending stays limited to ease in and out.
- Evaluation of the animated result. Blender drives properties itself; we report edits and let the host drive whatever it owns.

## Ableton Live

Live's Arrangement view is the reference for music-flavored editing: beats and bars, grids, clips on a timeline, and quick keyboard-driven nudging. We worked from general knowledge of how it behaves, not from its code or manuals. The same filter applies as everywhere: the host owns playback.

What we borrowed:

- Triplet and dotted grids, with a readout of the current grid. Grid density already follows zoom.
- A loop flag on the work range, drawn as a brace, plus jump to next and previous marker. The host decides what looping actually does.
- Audio fades and gain on clips.
- Folding all tracks and fitting row height, and zoom to selection with a zoom-out shortcut.
- Nudge and quantize for selected keys and sections, with a strength percentage.

What we did not, and why:

- Session view, clip launching, follow actions, freeze and flatten, and tempo following. They are all playback or rendering, which belong to the host.
- Pencil and breakpoint draw mode in the curve editor, warp markers on audio clips, and take lanes with comping. These are deferred. Warping is the clearest case: the library would only store and draw the markers while the host does the stretching, so we wait for a host that wants it.
