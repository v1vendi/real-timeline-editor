// Keyboard command execution (behavior.md section 15): selection-level edits, clipboard, transport steps.
import type { Beats, Sequence, Track } from "../core/model";
import { addEvent, deleteClip, deleteEvent, deleteKeys, deleteMarker, deleteSection } from "../edit/commands";
import { nudgeSelection, quantizeSelection } from "../edit/quantize";
import { copySelection, cutSelection, duplicate, paste, splitAt, type Clipboard } from "../edit/clipboard";
import { emptySelection, eventId, isEmpty, keyId, parseEventId, parseKeyId, pruneSelection, select, type Selection } from "../edit/selection";
import type { CommandId } from "./keymap";
import { sectionTrackIds, solo } from "./drag";
import type { InteractionHost } from "./interaction";

interface CommandEnv { host: InteractionHost; seq(): Sequence; newId(): string; step(): Beats; refresh(): void; rename?(): boolean }

export function createCommands({ host, seq, newId, step, refresh, rename }: CommandEnv): { run(cmd: CommandId): boolean; addEventAt(beat: Beats, trackId?: string): boolean } {
  let clip: Clipboard | null = null;

  /** Add an event on the selected events track (else the first one) and select it. */
  const addEventAt = (beat: Beats, trackId?: string): boolean => {
    const sel = host.getSelection();
    const evTracks: string[] = [];
    const walk = (l: Track[]) => { for (const t of l) { if (t.kind === "events" && !t.locked) evTracks.push(t.id); else if (t.kind === "folder") walk(t.children); } };
    walk(seq().tracks);
    const tid = trackId ?? evTracks.find((i) => sel.tracks.has(i)) ?? evTracks[0];
    if (!tid || host.readOnly?.()) return false;
    const id = newId();
    host.history.apply("Add event", (q) => addEvent(q, tid, { id, beat, name: "Event" }));
    host.setSelection(pruneSelection(solo(sel, "events", eventId(tid, id)), seq()));
    refresh();
    return true;
  };

  const run = (cmd: CommandId): boolean => {
    const h = host.history, sel = host.getSelection(), s = seq();
    const fin = (next: Selection = sel) => { host.setSelection(pruneSelection(next, seq())); refresh(); return true; };
    switch (cmd) {
      case "undo": return h.undo() ? fin() : true;
      case "redo": return h.redo() ? fin() : true;
      case "clear": {
        const empty = isEmpty(sel);
        return empty && host.goUp?.() ? true : fin(emptySelection);
      }
      case "rowPrev": case "rowNext": {
        if (sel.sections.size || sel.keys.size || sel.events.size || sel.markers.size || sel.clips.size) return false;
        const rows = host.getLayout().rows;
        if (!rows.length) return true;
        const at = rows.findIndex((r) => (r.kind === "channel" ? sel.channels.has(r.channel.id) : sel.tracks.has(r.track.id)));
        const r = rows[at < 0 ? (cmd === "rowNext" ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + (cmd === "rowNext" ? 1 : -1)))]!;
        host.setSelection(r.kind === "channel" ? { ...emptySelection, channels: new Set([r.channel.id]) } : { ...emptySelection, tracks: new Set([r.track.id]) });
        refresh();
        return true;
      }
      case "goUp": return !!host.goUp?.();
      case "playToggle": host.onPlayToggle?.(); return !!host.onPlayToggle;
      case "marker": host.onAddMarker?.(host.getPlayhead()); return !!host.onAddMarker;
      case "prevMarker": case "nextMarker": {
        const at = host.getPlayhead(), ms = s.markers.map((m) => m.beat);
        const t = cmd === "nextMarker" ? Math.min(...ms.filter((b) => b > at + 1e-9)) : Math.max(...ms.filter((b) => b < at - 1e-9));
        if (Number.isFinite(t)) host.seek(t);
        return true;
      }
      case "zoomSelection": host.zoomSelection?.(); return !!host.zoomSelection;
      case "zoomOut": host.zoomOut?.(); return !!host.zoomOut;
      case "nudgeLeft": case "nudgeRight": case "quantize": {
        const keys = [...sel.keys].map(parseKeyId), tm = sectionTrackIds(s.tracks);
        const sections = [...sel.sections].flatMap((id) => { const t = tm.get(id); return t ? [{ trackId: t, id }] : []; });
        if (!keys.length && !sections.length) return true;
        const r = cmd === "quantize" ? quantizeSelection(s, { keys, sections }, step()) : nudgeSelection(s, { keys, sections }, cmd === "nudgeLeft" ? -1 : 1, step());
        if (r.seq === s) return true;
        h.apply(cmd === "quantize" ? "Quantize" : "Nudge", () => r.seq);
        return fin({ ...sel, keys: new Set(r.keys.map(keyId)) });
      }
      case "stepBack": host.seek(Math.max(0, host.getPlayhead() - step())); return true;
      case "stepForward": host.seek(host.getPlayhead() + step()); return true;
      case "jumpStart": host.seek(0); return true;
      case "jumpEnd": host.seek(s.length); return true;
      case "selectAll": {
        const secs = [...sectionTrackIds(s.tracks).keys()], keys: string[] = [], evs: string[] = [];
        const walk = (l: Track[]) => { for (const t of l) { if (t.kind === "channels") for (const c of t.channels) for (const k of c.keys) keys.push(keyId({ trackId: t.id, channelId: c.id, beat: k.beat })); else if (t.kind === "events") for (const e of t.events) evs.push(eventId(t.id, e.id)); else if (t.kind === "folder") walk(t.children); } };
        walk(s.tracks);
        return fin(select(select(select(sel, "sections", secs, "replace"), "keys", keys, "replace"), "events", evs, "replace"));
      }
      case "copy": clip = copySelection(s, sel) ?? clip; return true;
      case "cut": {
        const r = cutSelection(s, sel);
        if (!r) return true;
        clip = r.clip; h.apply("Cut", () => r.seq); return fin();
      }
      case "paste": {
        if (!clip) return true;
        let res: ReturnType<typeof paste> | null = null;
        const target = { trackId: [...sel.tracks][0], channelId: [...sel.channels][0] };
        h.apply("Paste", (q) => (res = paste(q, clip!, host.getPlayhead(), newId, target)).seq);
        return res ? fin({ ...sel, sections: new Set((res as ReturnType<typeof paste>).sections.map((x) => x.id)), keys: new Set((res as ReturnType<typeof paste>).keys.map(keyId)), events: new Set((res as ReturnType<typeof paste>).events.map((x) => eventId(x.trackId, x.id))) }) : true;
      }
      case "duplicate": {
        let res: ReturnType<typeof duplicate> | null = null;
        h.apply("Duplicate", (q) => (res = duplicate(q, sel, newId, step())).seq);
        return res ? fin({ ...sel, sections: new Set((res as ReturnType<typeof duplicate>).sections.map((x) => x.id)), keys: new Set((res as ReturnType<typeof duplicate>).keys.map(keyId)), events: new Set((res as ReturnType<typeof duplicate>).events.map((x) => eventId(x.trackId, x.id))) }) : true;
      }
      case "split": {
        h.apply("Split", (q) => splitAt(q, sel, host.getPlayhead(), newId).seq);
        return fin();
      }
      case "delete": {
        const tracks = sectionTrackIds(s.tracks);
        h.apply("Delete", (q) => {
          const r = deleteKeys([...sel.sections].reduce((a, id) => { const t = tracks.get(id); return t ? deleteSection(a, t, id) : a; }, q), [...sel.keys].map(parseKeyId));
          const r2 = [...sel.events].map(parseEventId).reduce((a, e) => deleteEvent(a, e.trackId, e.id), r);
          const r3 = [...sel.clips].map(parseEventId).reduce((a, e) => deleteClip(a, e.trackId, e.id), r2);
          return [...sel.markers].reduce((a, id) => deleteMarker(a, id), r3);
        });
        return fin();
      }
      case "rename": return rename?.() ?? false;
      case "addEvent": return addEventAt(host.getPlayhead());
    }
  };

  return { run, addEventAt };
}
