// Add-items panel: tracks, sections, keys, events, markers, groups, audio, nested sequences, bindings; delete + duplicate.
import {
  addChannel, addEvent, addKey, addSection, addTrack, deleteEvent, deleteKeys, deleteSection, duplicate, emptySelection, eventId,
  findTrack, parseEventId, parseKeyId, pruneSelection, removeChannel, removeTrack, select, setGroup, setTrackBinding,
} from "../../../src";
import type { ChannelTrack, Sequence, Track, TrackKind } from "../../../src";
import { el, row, btn } from "../dom";
import type { StudioCtx } from "../../studio";

export default function mount(ctx: StudioCtx): void {
  const { toolbar, side, getSeq, edit, getBeat, onUpdate } = ctx;
  let n = 0;
  const uid = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;
  const flat = (l: Track[]): Track[] => l.flatMap((t) => (t.kind === "folder" ? [t, ...flat(t.children)] : [t]));

  // Toast
  const toast = el("div");
  toast.className = "toast";
  let timer = 0;
  const say = (msg: string, ok = false) => {
    toast.textContent = msg; toast.className = `toast show ${ok ? "ok" : "err"}`;
    clearTimeout(timer); timer = window.setTimeout(() => { toast.className = "toast"; }, 3500);
  };

  /** Run a pure edit; toast when it changes nothing (locked track, missing target, cycle...). */
  const run = (label: string, fn: (s: Sequence) => Sequence, why = "locked track or nothing to change") => {
    const before = getSeq();
    const after = fn(before);
    if (after === before) { say(`${label}: refused (${why})`); return false; }
    edit(label, () => after);
    say(label, true);
    return true;
  };

  // Targets
  const selTrack = (s: Sequence, kind: TrackKind): Track | undefined => {
    const all = flat(s.tracks), sel = ctx.tl.getSelection();
    return all.find((t) => t.kind === kind && sel.tracks.has(t.id)) ?? all.find((t) => t.kind === kind && !t.locked) ?? all.find((t) => t.kind === kind);
  };
  const selChannelTrack = (s: Sequence): { track: ChannelTrack; channelId: string } | undefined => {
    const sel = ctx.tl.getSelection();
    const chans = flat(s.tracks).filter((t): t is ChannelTrack => t.kind === "channels");
    for (const t of chans) { const c = t.channels.find((c) => sel.channels.has(c.id)); if (c) return { track: t, channelId: c.id }; }
    const t = chans.find((t) => sel.tracks.has(t.id));
    return t && t.channels[0] ? { track: t, channelId: t.channels[0].id } : undefined;
  };
  const need = (kind: string) => say(`No ${kind} track to add to`);

  const addTrackOf = (kind: TrackKind) => () => {
    const id = uid("t"), name = `New ${kind}`;
    const track: Track =
      kind === "sections" ? { id, name, kind, sections: [] } :
      kind === "channels" ? { id, name, kind, channels: [{ id: uid("c"), name: "ch1", keys: [] }, { id: uid("c"), name: "ch2", keys: [] }] } :
      kind === "audio" ? { id, name, kind, clips: [] } :
      kind === "events" ? { id, name, kind, events: [] } : { id, name, kind: "folder", children: [] };
    run(`Add ${kind} track`, (s) => addTrack(s, track));
  };

  const beatNow = () => getBeat();
  const addSec = () => { const t = selTrack(getSeq(), "sections"); if (!t) return need("sections"); run("Add section", (s) => addSection(s, t.id, { id: uid("s"), start: beatNow(), length: 4, label: "Section" })); };
  const addK = () => {
    const c = selChannelTrack(getSeq()); if (!c) return say("Select a channel or channel track (click its row) first");
    run("Add key", (s) => addKey(s, c.track.id, c.channelId, { beat: beatNow(), value: Math.round(Math.random() * 100), interp: "bezier" }));
  };
  const addEv = () => { const t = selTrack(getSeq(), "events"); if (!t) return need("events"); run("Add event", (s) => addEvent(s, t.id, { id: uid("e"), beat: beatNow(), name: "Cue" })); };
  const addCh = () => {
    const t = flat(getSeq().tracks).filter((x): x is ChannelTrack => x.kind === "channels");
    const sel = ctx.tl.getSelection();
    const tgt = t.find((x) => sel.tracks.has(x.id)) ?? t.find((x) => x.channels.some((c) => sel.channels.has(c.id)));
    if (!tgt) return say("Select a channel track (click its row) first");
    run("Add channel", (s) => addChannel(s, tgt.id, { id: uid("c"), name: `ch${tgt.channels.length + 1}`, keys: [] }));
  };
  const prune = () => ctx.tl.setSelection(pruneSelection(ctx.tl.getSelection(), getSeq()));
  const rmCh = () => {
    const sel = ctx.tl.getSelection();
    const refs = flat(getSeq().tracks).flatMap((t) => t.kind === "channels" ? t.channels.filter((c) => sel.channels.has(c.id)).map((c) => ({ t: t.id, c: c.id })) : []);
    if (!refs.length) return say("Select a channel row first");
    if (run("Remove channel", (s) => refs.reduce((acc, r) => removeChannel(acc, r.t, r.c), s))) prune();
  };
  const rmTrack = () => {
    const ids = [...ctx.tl.getSelection().tracks];
    if (!ids.length) return say("Select a track row first");
    if (run("Remove track", (s) => ids.reduce((acc, id) => removeTrack(acc, id), s))) prune();
  };
  const addMarker = () => run("Add marker", (s) => ({ ...s, markers: [...s.markers, { id: uid("m"), beat: Math.max(0, beatNow()), label: `Marker ${s.markers.length + 1}` }] }));
  const addGroup = () => {
    const c = selChannelTrack(getSeq()); if (!c) return need("channels");
    run("Add channel group", (s) => setGroup(s, c.track.id, { id: uid("g"), name: "Group", channelIds: c.track.channels.map((x) => x.id) }));
  };
  const addClip = () => {
    const t = selTrack(getSeq(), "audio"); if (!t) return need("audio");
    run("Add audio clip", (s) => {
      const t2 = findTrack(s.tracks, t.id);
      if (!t2 || t2.kind !== "audio" || t2.locked) return s;
      const tracks = (l: Track[]): Track[] => l.map((x) => x.id === t.id && x.kind === "audio" ? { ...x, clips: [...x.clips, { id: uid("a"), start: beatNow(), length: 8, offset: 0, peaksId: "song" }] } : x.kind === "folder" ? { ...x, children: tracks(x.children) } : x);
      return { ...s, tracks: tracks(s.tracks) };
    });
  };
  const addNested = () => {
    const t = selTrack(getSeq(), "sections"); if (!t) return need("sections");
    const cid = uid("child");
    run("Add nested sequence", (s) => {
      const child: Sequence = { version: 1, id: cid, name: "Child", length: 8, beatsPerBar: s.beatsPerBar, tempo: [{ beat: 0, bpm: 120 }], markers: [], library: {},
        tracks: [{ id: "ct", name: "Child fx", kind: "sections", sections: [{ id: "cs", start: 0, length: 4, row: 0, label: "Inner" }] }] };
      const out = addSection({ ...s, library: { ...s.library, [cid]: child } }, t.id, { id: uid("s"), start: beatNow(), length: 8, label: "Nested", ref: { sequenceId: cid } });
      return findTrack(out.tracks, t.id) === findTrack(s.tracks, t.id) ? s : out;
    }, "locked track or cycle");
  };
  const bind = () => {
    const ids = [...ctx.tl.getSelection().tracks];
    if (!ids.length) return say("Select a track (click its header) to bind");
    run("Bind track", (s) => ids.reduce((acc, id, i) => setTrackBinding(acc, id, `target-${i + 1}`), s));
  };

  const selectNew = (r: { sections: { id: string }[]; keys: { trackId: string; channelId: string; beat: number }[]; events: { trackId: string; id: string }[] }) => {
    let sel = emptySelection;
    sel = select(sel, "sections", r.sections.map((x) => x.id));
    sel = select(sel, "keys", r.keys.map((k) => `${k.trackId}\0${k.channelId}\0${k.beat}`));
    sel = select(sel, "events", r.events.map((e) => eventId(e.trackId, e.id)));
    ctx.tl.setSelection(sel);
  };
  const dup = () => {
    const sel = ctx.tl.getSelection();
    if (!sel.sections.size && !sel.keys.size && !sel.events.size) return say("Nothing selected to duplicate");
    let res: ReturnType<typeof duplicate> | undefined;
    if (run("Duplicate", (s) => { res = duplicate(s, sel, () => uid("d"), 1); return res.seq; }) && res) selectNew(res);
  };
  const del = () => {
    const sel = ctx.tl.getSelection();
    if (!sel.sections.size && !sel.keys.size && !sel.events.size && !sel.tracks.size) return say("Nothing selected to delete");
    run("Delete selected", (s) => {
      let out = s;
      const walk = (l: Track[]) => { for (const t of l) {
        if (t.kind === "sections") for (const x of t.sections) { if (sel.sections.has(x.id)) out = deleteSection(out, t.id, x.id); }
        else if (t.kind === "folder") walk(t.children);
      } };
      walk(s.tracks);
      const byTrack = new Map<string, ReturnType<typeof parseKeyId>[]>();
      for (const id of sel.keys) { const r = parseKeyId(id); byTrack.set(r.trackId, [...(byTrack.get(r.trackId) ?? []), r]); }
      for (const [tid, refs] of byTrack) if (!findTrack(out.tracks, tid)?.locked) out = deleteKeys(out, refs);
      for (const id of sel.events) { const r = parseEventId(id); out = deleteEvent(out, r.trackId, r.id); }
      const removeTracks = (l: Track[]): Track[] => l.filter((t) => !(sel.tracks.has(t.id) && !t.locked)).map((t) => (t.kind === "folder" && !t.locked ? { ...t, children: removeTracks(t.children) } : t));
      const tracks = sel.tracks.size ? removeTracks(out.tracks) : out.tracks;
      if (tracks.length !== out.tracks.length || JSON.stringify(tracks) !== JSON.stringify(out.tracks)) out = { ...out, tracks };
      return out;
    });
  };

  const sub = (t: string) => { const s = el("div", { textContent: t }); s.style.cssText = "font:600 11px var(--font);letter-spacing:.02em;color:var(--muted);margin-top:10px"; return s; };

  const dupB = btn("Duplicate", dup, "add-duplicate"), delB = btn("Delete selected", del, "add-delete");
  const renB = btn("Rename", () => { if (!ctx.tl.renameSelection()) say("Select a row, section, event, marker or clip to rename (R)"); }, "add-rename");
  toolbar.append(dupB, delB, renB);

  const kinds: TrackKind[] = ["sections", "channels", "audio", "events", "folder"];
  const target = el("div", { id: "add-target" }); target.style.cssText = "font:12px var(--font);color:var(--accent-hi);margin:6px 0";
  const info = el("div"); info.style.cssText = "font:11px var(--font);color:var(--muted)";
  side.append(el("section", {},
    el("h4", { textContent: "Add items" }),
    info, target,
    sub("Tracks"), row(...kinds.map((k) => btn(`+ ${k}`, addTrackOf(k), `add-track-${k}`))),
    sub("At the playhead (into the selected track, else the first of its kind)"),
    row(btn("+ Section", addSec, "add-section"), btn("+ Key", addK, "add-key"), btn("+ Channel", addCh, "add-channel"), btn("+ Event", addEv, "add-event"), btn("+ Marker", addMarker, "add-marker"),
      btn("+ Audio clip", addClip, "add-clip"), btn("+ Nested seq", addNested, "add-nested")),
    sub("Structure"),
    row(btn("+ Channel group", addGroup, "add-group"), btn("Bind selected track", bind, "add-bind"),
      btn("Remove channel", rmCh, "remove-channel"), btn("Remove track", rmTrack, "remove-track")),
    toast,
  ));
  const refresh = () => {
    info.textContent = `Playhead: beat ${getBeat().toFixed(2)}`;
    const sel = ctx.tl.getSelection(), tr = flat(getSeq().tracks);
    const ch = tr.flatMap((t) => (t.kind === "channels" ? t.channels.filter((c) => sel.channels.has(c.id)).map((c) => `${t.name} / ${c.name}`) : []));
    const name = ch[0] ?? tr.find((t) => sel.tracks.has(t.id))?.name;
    target.textContent = name ? `Target row: ${name}` : "Target row: none (click a row in the outliner)";
  };
  onUpdate(refresh); refresh();
}
