// Channel groups: summary row data and composite key edits. Pure; groups live on ChannelTrack.groups.
import { quantize } from "../core/model";
import type { Beats, ChannelGroup, ChannelTrack, Sequence } from "../core/model";
import { findTrack, moveKeys } from "./commands";
import type { History } from "./history";
import { withTrack } from "./trackOps";

export interface GroupSummaryKey { beat: Beats; /** Channels of the group with a key here. */ channelIds: string[]; /** True when every group channel has one. */ full: boolean }

function groupOf(seq: Sequence, trackId: string, groupId: string): { t: ChannelTrack; g: ChannelGroup } | undefined {
  const t = findTrack(seq.tracks, trackId);
  const g = t?.kind === "channels" ? t.groups?.find((x) => x.id === groupId) : undefined;
  return t?.kind === "channels" && g ? { t, g } : undefined;
}

/** Union of key beats across the group's channels (sorted), for the collapsed summary row. */
export function groupSummary(track: ChannelTrack, group: ChannelGroup): GroupSummaryKey[] {
  const at = new Map<Beats, string[]>();
  const chans = track.channels.filter((c) => group.channelIds.includes(c.id));
  for (const c of chans) for (const k of c.keys) (at.get(k.beat) ?? at.set(k.beat, []).get(k.beat)!).push(c.id);
  return [...at].sort((a, b) => a[0] - b[0]).map(([beat, channelIds]) => ({ beat, channelIds, full: channelIds.length === chans.length }));
}

/** Move the group's keys at `beat` (in every member channel) by dBeat / dValue. Locked track: no-op. */
export function moveGroupKeys(seq: Sequence, trackId: string, groupId: string, beat: Beats, dBeat: Beats, dValue = 0): Sequence {
  const f = groupOf(seq, trackId, groupId);
  if (!f || f.t.locked) return seq;
  const b = quantize(beat);
  const refs = f.t.channels.filter((c) => f.g.channelIds.includes(c.id) && c.keys.some((k) => k.beat === b))
    .map((c) => ({ trackId, channelId: c.id, beat: b }));
  return refs.length ? moveKeys(seq, refs, dBeat, dValue) : seq;
}

/** Declare (or replace by id) a group; unknown channel ids are dropped. */
export function setGroup(seq: Sequence, trackId: string, group: ChannelGroup): Sequence {
  const t = findTrack(seq.tracks, trackId);
  if (!t || t.kind !== "channels" || t.locked) return seq;
  const g = { ...group, channelIds: group.channelIds.filter((id) => t.channels.some((c) => c.id === id)) };
  const groups = [...(t.groups ?? []).filter((x) => x.id !== g.id), g];
  return withTrack(seq, trackId, () => ({ ...t, groups }));
}

/** One history entry; repeated drags of the same group key coalesce. */
export function applyMoveGroupKeys(h: History, trackId: string, groupId: string, beat: Beats, dBeat: Beats, dValue = 0): void {
  h.apply("Move group keys", (s) => moveGroupKeys(s, trackId, groupId, beat, dBeat, dValue), `group:${trackId}:${groupId}:${quantize(beat)}`);
}
