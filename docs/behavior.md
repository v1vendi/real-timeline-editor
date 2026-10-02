# Behavior guide

This guide describes what the editor does and why. The interaction model follows Unreal Engine's Sequencer, with a few ideas borrowed from Blender's Dope Sheet and Graph Editor. Source comments cite sections of this file by number, so keep the numbers stable and add new sections at the end.

## 1. Model and time

- A `Sequence` holds tracks, markers and a library of child sequences. A track holds sections and keyed channels. The keys belong to the track's channels; a section never carries keys of its own, it only says where and for how long something plays.
- Time is measured in beats. Bars.beats, seconds and frames are just ways of showing a beat. Seconds come from the tempo map, so 4 beats at 120 BPM display as 2 seconds.
- When an edit commits, beats are rounded to 1/960 (section start, length and offset, key beats, marker beats). That keeps saved files free of floating-point noise like `1.0000000002`.
- The saved JSON has a `version` field. It stays at 1 until the first release, so the model can still change in place. Migrations begin at release.
- Track kinds include an `events` kind, where the host fires events through `eventsBetween`. A track can also carry a `binding`, which the host can retarget (say, from one character to another).
- Out of scope: a blend-mode setting, curve normalize, tempo ramps and audio playback. The host owns the clock and plays the audio.

## 2. Ruler, grid and view

- The ruler shows bars.beats. As you zoom in, ticks get denser (bar, beat, half, quarter, and so on). A label only appears at the coarsest level that leaves at least about 60 px between labels, so the ruler never turns into a wall of numbers.
- Everything outside `[0, sequence.length]` is shaded, so you can see where the sequence ends.
- Click or drag on the ruler to scrub. The library does not move the playhead itself; it asks the host to seek (`onSeek(beat)`) and draws the playhead at the host's `clock.now()`. Scrubbing snaps to the grid. Hold Alt to move freely, or hold Shift to snap to keys, section edges and markers instead.
- During playback the view can follow the playhead in page steps. It stops following while you are panning, so it never fights you.
- The wheel scrolls vertically. Ctrl/Cmd+wheel zooms around the cursor, so the beat under the cursor stays where it is. Shift+wheel, middle-drag, space-drag and a two-finger horizontal swipe all pan.
- `Home` fits the whole sequence and `F` fits the selection with 5% padding. Zoom is limited to 4 px per bar at the low end and about 2000 px per beat at the high end.
- View state (start beat, pixels per beat, vertical scroll) lives in the view and is never saved.

## 3. Tracks and rows

- The editor has two panes that scroll together: an outliner (DOM) on the left and the time area (canvas) on the right. Both draw the same flat list of rows (`Row[]`, each with a `depth` and an `expanded` flag), which is why a row always lines up across the two.
- A track expands to show its sections and channels. A collapsed parent draws a summary of its children's keys and sections. Those summary diamonds are derived on the fly and never stored.
- Each track has mute, solo and lock. A locked row rejects edits in the command layer, not only in the UI, so a script cannot change it either. Locked and muted targets are also skipped as snap targets. Channels do not have their own mute or lock yet.
- When sections overlap on one track they are stacked into lanes. A section's `row` is assigned on insert (the first free lane), and the track grows to fit its tallest lane.
- Clicking an outliner row selects it, with a tinted band and a left accent in both panes. Up and Down move the row selection when no section, key or event is selected.

## 4. Selection

- Click selects one item and clears the rest. Ctrl/Cmd+click or Shift+click toggles an item in or out of the selection.
- Dragging on empty space draws a box. The box replaces the selection, or adds to it while a modifier is held. A section is selected if the box touches it at all; a key is selected only if its center is inside the box, which keeps dense keys from being grabbed by accident.
- Keys sit above section bars when hit-testing, and clicking a section body never selects the keys drawn over it.
- The selection can hold sections, keys, channels and tracks. It is not part of undo.
- Ctrl/Cmd+A selects everything visible. Esc clears the selection.

## 5. Editing gestures

- Sections: drag the body to move it. It never goes below beat 0, and it can move between rows of the same track kind. Drag an edge to trim; a section cannot get shorter than one grid step. Trimming the left edge of a section with content adjusts `offset`, so the content stays where it was in time.
- Sections may overlap. The corner handles set ease in and ease out, in beats; the host decides how overlapping payloads combine.
- Keys: each key has an interpolation (`constant`, `linear` or `bezier`) that applies to the segment after it. Bezier keys have tangents in `auto`, `aligned` or `free` mode, and the default is auto-smooth. A channel has one key per beat, so dropping a key onto another replaces it.
- Split (`S`) cuts the section under the playhead in two. The second half keeps its content in place through `offset`.
- A drag is only a preview. It commits as one command when you release the pointer, so one gesture is one undo step. Consecutive nudges within 500 ms merge into a single step, so holding an arrow key does not flood the history. History is capped at about 200 entries (configurable).
- Locked targets ignore edits.

## 6. Snapping

- Drags snap to the grid, section edges, the playhead, markers and key times, when they come within about 8 px.
- Hold Alt to turn snapping off for the current drag.
- Markers are always snap targets, because they belong to the whole sequence rather than one track.

## 7. Curve editor

- The curve view replaces the row layout in the same time area, so the time axis and the playhead are shared. A value axis appears on the left.
- It shows the channels selected in the outliner, one color per channel.
- Y zoom is independent of time zoom (Ctrl+wheel or Shift+wheel on the value axis). The Frame command fits both axes at once.
- Tangent handles appear only for selected keys, to keep the view readable.

## 8. Audio

- The host supplies peak data (`peaksPerSecond`, `min[]`, `max[]`, plus a start offset). The renderer picks the finest mip level whose peaks are each at least one pixel wide, and caches it in an offscreen canvas per level.
- Audio lanes are read-only for alignment, so the waveform is never edited. Clips can still be selected, moved, renamed and deleted.

## 9. Markers

- A marker (`id`, `beat`, `label`, optional `color`) lives in `Sequence.markers`, not on a track. It is drawn as a flag on the ruler.
- Press `M` to add one at the playhead and drag it to move it. `Alt+,` and `Alt+.` jump to the previous and next marker.
- Markers can be selected by clicking, moved and deleted. They are always snap targets.

## 10. Clipboard and duplicate

- Copy and cut store sections or keys as plain JSON. The clipboard is held inside the library, so the host can bridge it to the system clipboard if it wants to.
- Paste puts the items at the playhead and keeps their relative spacing. Sections go onto a track of the same kind. Keys go onto the same channel they came from, or else the selected channel.
- Duplicate puts a copy of a section right after the original. Keys are copied one grid step later on the same row.

## 11. Work range

- The work range is a `{start, end}` pair that belongs to the view and is not saved. Shift+drag on the ruler sets it. It is drawn on the ruler, and the host can use it as a loop range or a zoom range.

## 12. Nested sequences

- A section can reference a child sequence (`Section.ref = { sequenceId, loop? }`). Child time is `(parent time - start) * scale + offset`, wrapped over the child's length when looping.
- Child sequences live in `Sequence.library`. A reference that would create a cycle, including a sequence referencing itself, is rejected in the command layer.
- A nested section draws a small summary of the child's tracks. Double-click enters the child and shows a breadcrumb. Alt+Up, Esc on an empty selection, the Up button, or a click on a crumb all leave it. While you are inside a child (depth above 0), the crumbs appear under the ruler together with a read-only notice.
- Why `offset` and `scale` live on the section: trimming needs `offset` anyway, so the reference reuses it.

## 13. Color groups

- A `ChannelGroup` can be a color. The kinds are `rgb` (3 channels), `rgba` (4), `hsv` (3 or 4: hue in degrees, the rest normalized) and `hue` (1 channel, in degrees, with saturation and value fixed at 1). Other kinds are free tags for the host. Channel order is the order of `channelIds`.
- `range` is the maximum channel value: 255 by default, and 1 for hsv saturation, value and alpha. Values clamp to `0..range`, while hue wraps around. A group with the wrong channel count is rejected.
- `colorAt` evaluates each channel with `evaluate()`, so a constant key gives a hard step. `colorStops` emits key beats, paired stops for hard steps, and extra samples on bezier segments (and on linear hsv and hue segments), capped by `maxStops`. Hue on a linear segment takes the short way around 360: going from 350 to 10 passes through 0 and never sweeps the whole wheel. The other channels stay linear, and constant and bezier segments evaluate unchanged.
- A color stop is the set of keys at one beat across all channels of the group. These helpers work on whole stops:
  - `setGroupColor(seq, {trackId, groupId}, beat, rgba)` writes every channel in one step. It creates missing keys with the previous key's interpolation and keeps the interpolation of existing keys. rgb and rgba scale to `range`, hsv and hue convert via `rgbToHsv`, and alpha is written only when there is a 4th channel.
  - `addColorStop` defaults its color to `colorAt`, so the gradient does not change when you add a stop.
  - `moveColorStop(seq, {trackId, groupId, beat}, dBeat)` moves all channel keys together. The move is clamped to `>= 0` and strictly between the neighboring stops, so a stop never collides with or passes another.
  - `removeColorStop` deletes all the keys of the stop.
  - Locked tracks and non-color groups make all of these a no-op.
- Double-click on a color group row, expanded or collapsed, calls `onPickColor(trackId, groupId, beat)`. On a stop mark it gives that stop's beat; elsewhere on the gradient strip it gives the beat under the pointer (the host may then add a stop). This takes precedence over `onOpenCurve` on those rows; without the hook, double-click opens curves as before.
- Dragging a selected mark on a collapsed color row moves the whole stop (all channel keys, via `moveColorStop`) as one undo step, and the selection follows the stop.
- With several marks selected, all selected stops (of any color group) and any other selected keys move together by one delta (`moveColorStops` / `colorStopsDelta`). The delta is clamped so each moving stop stays at or above 0 and strictly between its group's non-moving stops. The moving set keeps its order, and ghost lines show every moving mark. A selected key counts as a stop when its channel is in a color group, even if only some of the stop's channels are selected.

## 14. Rename

- `R` or `F2` renames the selected outliner row, or else the single selected section, event, marker or audio clip.
- Double-clicking an outliner name, a section body, an event, an audio clip or a ruler marker does the same thing. On a nested section the two gestures differ: Alt+double-click renames, and plain double-click enters the child.
- An inline editor opens. Enter or clicking away commits one "Rename ..." undo step, and Esc cancels. Empty names are rejected, and a locked or read-only target shakes instead of opening an editor.

## 15. Keyboard shortcuts

The defaults live in `src/view/keymap.ts`. The host can override any action, and the library never binds Space to audio. "Mod" means Ctrl on Windows and Linux, and Cmd on macOS. Each line reads `Key - what it does`.

Navigation
- Space - asks the host to play or pause (it emits `onPlayToggle`; the host decides what that means).
- Left, Right - step the playhead back or forward by one grid step.
- Shift+Left, Shift+Right - jump to the start or the end of the sequence.
- Up, Down - select the previous or next row, but only when no section, key or event is selected.
- Alt+Up - leave the child sequence you are inside.
- Alt+, and Alt+. - jump to the previous or next marker.
- Esc - clear the selection; with nothing selected, leave the child sequence.

Editing
- Delete, Backspace - delete the selection.
- Mod+D - duplicate the selection.
- Mod+C, Mod+X, Mod+V - copy, cut and paste (paste lands at the playhead).
- S - split the section under the playhead.
- M - add a marker at the playhead.
- E - add an event at the playhead (on an events track).
- Mod+Left, Mod+Right - nudge the selected keys and sections by one grid step.
- Q - quantize the selection to the grid.
- Mod+Z - undo.
- Mod+Shift+Z, Mod+Y - redo.

Selection
- Mod+A - select everything visible.

Zoom
- Z - zoom to the selection, or to the whole sequence if nothing is selected.
- X - zoom out, halving the zoom about the center.
- Home and F (section 2) are handled by the navigation controller, not the keymap.

Rename
- R, F2 - rename the selected row, section, event, marker or audio clip.

There are no default color shortcuts; color stops are edited with the mouse and the host's picker (section 13).

## Sources

Own-words summaries of behavior seen in these references; nothing is copied. The Unreal pages are script-rendered, so UE details come from general knowledge and should be checked in the live editor before anything goes into a test.

- Unreal Sequencer overview: https://dev.epicgames.com/documentation/en-us/unreal-engine/sequencer-movie-tool-overview-for-unreal-engine
- Unreal Sequencer editor reference: https://dev.epicgames.com/documentation/en-us/unreal-engine/sequencer-editor-reference-for-unreal-engine
- Unreal sub-tracks and shots: https://dev.epicgames.com/documentation/en-us/unreal-engine/cinematic-sub-tracks-and-shots-in-unreal-engine
- Blender NLA editor: https://docs.blender.org/manual/en/latest/editors/nla/index.html
- Blender Dope Sheet: https://docs.blender.org/manual/en/latest/editors/dope_sheet/introduction.html
- Blender Graph Editor F-curves: https://docs.blender.org/manual/en/latest/editors/graph_editor/fcurves/introduction.html
