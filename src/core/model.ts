// Core data model. Time is in beats; a TempoMap converts to seconds. No DOM here.

import type { EaseShape } from "./easing";
export type Beats = number;

export interface TempoPoint { beat: Beats; bpm: number }

/** Beats are quantized to 1/960 on commit (section start/length/offset, key and marker beats). */
export const BEAT_RESOLUTION = 960;

/** Snap a beat to the 1/960 grid so equality, dedupe and serialization are stable. */
export function quantize(beat: Beats): Beats {
  return Math.round(beat * BEAT_RESOLUTION) / BEAT_RESOLUTION;
}

export type Interp = "constant" | "linear" | "bezier";

/** Bezier handles relative to the key (dx in beats, dy in value units). `auto` ignores the numbers. */
export interface Tangent { mode: "auto" | "aligned" | "free"; inDx: Beats; inDy: number; outDx: Beats; outDy: number }

/** The segment after a key uses that key's `interp`. Keys are sorted by beat, unique per channel. */
export interface Key { beat: Beats; value: number; interp: Interp; tan?: Tangent }

export interface Marker { id: string; beat: Beats; label: string; color?: string }

export interface Section {
  id: string;
  start: Beats;
  length: Beats;
  /** Overlap lane within the track, assigned by the editor (0 = first). */
  row: number;
  /** Start into the content (trim); child time = (t - start) * scale + offset. Default 0. */
  offset?: Beats;
  /** Content speed. Default 1. */
  scale?: number;
  easeIn?: Beats;
  easeOut?: Beats;
  /** Curve of the ease handles (host-interpreted blend weight). Default "linear". */
  easeInShape?: EaseShape;
  easeOutShape?: EaseShape;
  /** Nested sequence: id in `Sequence.library`. */
  ref?: { sequenceId: string; loop?: boolean };
  label?: string;
  color?: string;
  /** Host-defined payload, e.g. an effect preset or a QLC+ function id. */
  data?: unknown;
}

export interface Channel { id: string; name: string; keys: Key[] }

/**
 * Audio placement; `peaksId` names host-supplied peaks, which stay outside the serialized model.
 * `fadeIn`/`fadeOut` are in beats (default 0, fadeIn + fadeOut <= length); `gain` is linear (default 1).
 */
export interface AudioClip { id: string; start: Beats; length: Beats; offset: Beats; fadeIn?: Beats; fadeOut?: Beats; gain?: number; peaksId?: string; label?: string }

/** Named point event at a beat (endpoints 0 and length allowed). The library never fires it; see `eventsBetween`. */
export interface TimelineEvent { id: string; beat: Beats; name: string; payload?: unknown }

/** Host object a track drives. Opaque id; validity is answered by the host. */
export interface TrackBinding { targetId: string }
interface TrackBase { id: string; name: string; muted?: boolean; solo?: boolean; locked?: boolean; binding?: TrackBinding }
export interface SectionTrack extends TrackBase { kind: "sections"; sections: Section[] }
/**
 * Channels of one track shown/edited together (vector, color, transform...). `kind` is a host tag; the
 * library understands the color kinds 'rgb' | 'rgba' | 'hsv' | 'hue' (see src/color.ts). `range` is the max
 * channel value for color groups (default 255 for rgb/rgba, 1 for hsv s/v/a; hue is always degrees 0..360).
 */
export interface ChannelGroup { id: string; name: string; kind?: string; channelIds: string[]; color?: string; range?: number }
export interface ChannelTrack extends TrackBase { kind: "channels"; channels: Channel[]; groups?: ChannelGroup[] }
export interface AudioTrack extends TrackBase { kind: "audio"; clips: AudioClip[] }
export interface EventTrack extends TrackBase { kind: "events"; events: TimelineEvent[] }
export interface FolderTrack extends TrackBase { kind: "folder"; children: Track[] }
export type Track = SectionTrack | ChannelTrack | AudioTrack | EventTrack | FolderTrack;
export type TrackKind = Track["kind"];

export interface Sequence {
  version: 1;
  id: string;
  name: string;
  length: Beats;
  beatsPerBar: number;
  tempo: TempoPoint[];
  tracks: Track[];
  markers: Marker[];
  /** Child sequences referenced by `Section.ref`, keyed by id (cycles rejected by commands). */
  library: Record<string, Sequence>;
}

/** Seconds at `beat`, integrating a piecewise-constant tempo map. `tempo` must be sorted and start at beat 0. */
export function beatToSeconds(tempo: TempoPoint[], beat: Beats): number {
  let seconds = 0;
  for (let i = 0; i < tempo.length; i++) {
    const p = tempo[i]!;
    const end = tempo[i + 1]?.beat ?? Infinity;
    if (beat <= p.beat) break;
    seconds += ((Math.min(beat, end) - p.beat) * 60) / p.bpm;
  }
  return seconds;
}
