// Mutable state of one createTimeline instance, passed explicitly to the handle-method groups.
import type { Beats } from "../core/model";
import type { GridMode } from "../core/time";
import type { RowLayout, RowMetrics, ExpansionState } from "../core/rows";
import type { Selection } from "../edit/selection";
import type { PeaksMap } from "./lanesExtra";
import type { Theme } from "./theme";

export interface TimelineState {
  showOutliner: boolean;
  theme: Theme;
  expansion: ExpansionState;
  selection: Selection;
  readOnly: boolean;
  destroyed: boolean;
  metrics: RowMetrics;
  gridMode: GridMode;
  workRange: { start: Beats; end: Beats; loop?: boolean } | null;
  peaks: PeaksMap | undefined;
  playhead: Beats;
  layout: RowLayout;
}
