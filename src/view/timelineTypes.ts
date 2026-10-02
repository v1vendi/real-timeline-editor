// Public types of the embeddable timeline widget (options, clock, handle). Type-only.
import type { Beats, Sequence } from "../core/model";
import type { GridMode } from "../core/time";
import type { Selection } from "../edit/selection";
import type { CommandId } from "./interaction";
import type { KeymapConflict, KeymapOverrides } from "./keymap";
import type { RenderOptions } from "./render";
import type { PeaksMap } from "./lanesExtra";
import type { PeaksHook } from "../core/peaksLoader";
import type { SequenceResolver } from "../core/nested";
import type { ViewState } from "./viewState";
import type { Theme, ThemeInput } from "./theme";

/** Host-owned playhead. `subscribe` pushes changes; without it the widget polls `getTime` each frame. */
export interface TimelineClock {
  getTime(): Beats;
  subscribe?(cb: (beat: Beats) => void): () => void;
}
export interface ChangeInfo { label: string; kind: "edit" | "undo" | "redo" }
export interface TimelineOptions {
  sequence: Sequence;
  clock: TimelineClock;
  /** Fires after every user edit, undo and redo (not for setSequence). */
  onChange?(seq: Sequence, info: ChangeInfo): void;
  /** User asked to move the playhead (ruler scrub, jump keys). The host decides whether to move its clock. */
  onSeek?(beat: Beats): void;
  /** Fires when the user changes the selection (click, box-select, select-all) or an edit prunes it. Not fired by `setSelection`. */
  onSelect?(sel: Selection): void;
  /** Alias of `onSelect`. */
  onSelectionChange?(sel: Selection): void;
  /** Start in read-only mode (see `Timeline.setReadOnly`). */
  readOnly?: boolean;
  onPlayToggle?(): void;
  onAddMarker?(beat: Beats): void;
  /** Double-click on a channel row, a collapsed channels track or a key (no key selection needed): open your curve editor for that channel. */
  onOpenCurve?(trackId: string, channelId?: string): void;
  /** Double-click on a color group row (expanded or collapsed): on a stop mark `beat` is its beat, elsewhere on the gradient strip the beat under the pointer (you may add a stop there). Takes precedence over `onOpenCurve` on those rows; open your color picker. */
  onPickColor?(trackId: string, groupId: string, beat: number | null): void;
  /** Work range changed by Shift+drag on the ruler (null = cleared by Shift+click). Not serialized. */
  onWorkRange?(range: { start: Beats; end: Beats; loop?: boolean } | null): void;
  /** Initial grid flavour (default "straight"). Drives grid lines, snapping, step keys and the ruler readout. */
  gridMode?: GridMode;
  /** User changed the grid flavour by clicking the ruler readout. Not fired by `setGridMode`. */
  onGridMode?(mode: GridMode): void;
  /** Paint a section yourself; return true to skip the default fill and label. */
  renderSection?: RenderOptions["renderSection"];
  /** Paint an audio clip yourself; return true to skip the default fill and waveform. */
  renderAudio?: RenderOptions["renderAudio"];
  /** Paint an individual key yourself (not called for density-decimated keys); return true to skip the default diamond. */
  renderKey?: RenderOptions["renderKey"];
  peaks?: PeaksMap;
  /**
   * Host hook: peaks for `AudioClip.peaksId`, asked lazily the first time a clip is drawn (sync or promise,
   * once per id). Consulted when `peaks`/`setPeaks` has no entry. `setPeaks` and `reloadPeaks` re-ask.
   */
  resolvePeaks?: PeaksHook;
  /** Host hook: sequence for a nested `ref.sequenceId` that is not in `Sequence.library` (synchronous). */
  resolveSequence?: SequenceResolver;
  /** Fires after the user enters a nested section (double-click) or goes up; `crumbs` is root-first. Inside a child the widget is read-only. */
  onNavigate?(crumbs: { id: string; name: string }[]): void;
  expanded?: Iterable<string>;
  /** Show the track outliner on the left (default true). */
  outliner?: boolean;
  outlinerWidth?: number;
  /** Fully resolved chord -> action map (replaces the defaults). Ignored when `keymapOverrides` is set. */
  keymap?: Record<string, CommandId>;
  /** Per-action overrides merged over the defaults (see `buildKeymap`); problems are reported to `onKeymapWarning`. */
  keymapOverrides?: KeymapOverrides;
  /** Called once at creation when `keymapOverrides` has chords bound to several actions or unparseable/unknown entries. */
  onKeymapWarning?(w: { conflicts: KeymapConflict[]; invalid: string[] }): void;
  newId?(): string;
  /** Colors, fonts, radii and row heights: partial over the dark default, or `{ base: "light" }` (see `Theme`). */
  theme?: ThemeInput;
}
export interface Timeline {
  getSequence(): Sequence;
  /** Replace the document (clears undo history, does not fire onChange). */
  setSequence(seq: Sequence): void;
  undo(): void;
  redo(): void;
  /** Apply a pure edit `seq => seq` as ONE undo entry named `label`; fires `onChange` (kind "edit"). No-op when read-only or `fn` returns the same object. */
  edit(label: string, fn: (seq: Sequence) => Sequence): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  getSelection(): Selection;
  /** Programmatic selection: ids that do not exist are dropped, `onSelect` is not fired. */
  setSelection(sel: Selection): void;
  /** Open the inline rename editor on the selected row, or the single selected section / event (what R or F2 does). False when there is nothing to rename. */
  renameSelection(): boolean;
  readonly readOnly: boolean;
  /**
   * Read-only: no drags/trims, no edit shortcuts (undo, redo, cut, paste, duplicate, split, delete), no outliner
   * edits, and `undo()`/`redo()` do nothing. Selection, scrub, navigation, expand/collapse, copy, onSeek,
   * onPlayToggle and `setSequence` keep working.
   */
  setReadOnly(on: boolean): void;
  /** Breadcrumb path root-first; length 1 at the root. */
  getCrumbs(): { id: string; name: string }[];
  /** Go to breadcrumb depth `i` (0 = root). */
  goTo(i: number): void;
  getWorkRange(): { start: Beats; end: Beats; loop?: boolean } | null;
  /** Programmatic work range (does not fire `onWorkRange`). */
  setWorkRange(r: { start: Beats; end: Beats; loop?: boolean } | null): void;
  /** Fold (collapse, default) or unfold every expandable track and folder. */
  foldAll(fold?: boolean): void;
  /** Ids of the currently expanded tracks and folders (a copy; pass to `setExpanded`, e.g. to keep fold state across a rebuild). */
  getExpanded(): string[];
  /** Replace the expanded set (ids that are not expandable are ignored by the layout). */
  setExpanded(ids: Iterable<string>): void;
  /** Show or hide the left track outliner at runtime (see `TimelineOptions.outliner`). */
  setOutliner(on: boolean): void;
  /** Scale row heights so every row fits the viewport height (clamped); `resetRowHeight` restores the defaults. */
  fitRowHeight(): void;
  resetRowHeight(): void;
  /** The resolved theme in use. */
  getTheme(): Theme;
  /** Replace the theme (partial over the named `base`, default dark) and repaint. Not merged with the previous theme. */
  setTheme(t: ThemeInput): void;
  getGridMode(): GridMode;
  /** Programmatic grid flavour (does not fire `onGridMode`). */
  setGridMode(m: GridMode): void;
  getView(): ViewState;
  setView(v: ViewState): void;
  setPeaks(p: PeaksMap | undefined): void;
  /** Forget cached `resolvePeaks` results (all, or one id) and repaint; they are asked again on next draw. */
  reloadPeaks(id?: string): void;
  /** Repaint after host-side changes (e.g. a clock jump without subscribe). */
  redraw(): void;
  /** Remove every listener, observer and frame request and the DOM it created. Idempotent; other methods become no-ops. */
  destroy(): void;
}
