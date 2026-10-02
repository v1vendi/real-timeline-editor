// Sequence JSON (de)serialization: stable key order, validation on load, migration hook per version.
import { quantize, type Sequence } from "./model";
import { isEaseShape } from "./easing";
import { danglingRefs, findCycle } from "./nested";

export const CURRENT_VERSION = 1;

/** Upgrade a raw document from version N to N+1. Add entries here when the model bumps `version`. */
const migrations: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

export class SequenceFormatError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid sequence: ${issues.slice(0, 5).join("; ")}${issues.length > 5 ? ` (+${issues.length - 5} more)` : ""}`);
    this.name = "SequenceFormatError";
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

// ---- stable output ----------------------------------------------------------------------------

/** A key, or [key, formatter] for a nested value. Array order is the output key order. */
type Field = string | readonly [string, (v: any) => unknown];

function ordered(o: Obj, fields: readonly Field[]): Obj {
  const out: Obj = {};
  for (const f of fields) {
    const [k, fmt] = typeof f === "string" ? [f, undefined] : f;
    const v = o[k];
    if (v !== undefined) out[k] = fmt ? fmt(v) : v;
  }
  return out;
}
const shape = (fields: readonly Field[]) => (o: unknown) => ordered(o as Obj, fields);
const list = (f: (o: Obj) => unknown) => (v: unknown) => (v as Obj[]).map(f);
const listOf = (fields: readonly Field[]) => list(shape(fields));

/** Host payload: sort object keys deep so output is deterministic. */
function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (!isObj(v)) return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
}

const TRACK_FIELDS: readonly Field[] = [
  "id", "kind", "name", "muted", "solo", "locked", "binding",
  ["sections", listOf(["id", "start", "length", "row", "offset", "scale", "easeIn", "easeOut", "easeInShape", "easeOutShape", ["ref", shape(["sequenceId", "loop"])], "label", "color", ["data", sortDeep]])],
  ["channels", listOf(["id", "name", ["keys", listOf(["beat", "value", "interp", ["tan", shape(["mode", "inDx", "inDy", "outDx", "outDy"])]])]])],
  ["groups", listOf(["id", "name", "kind", "channelIds", "color", "range"])],
  ["clips", listOf(["id", "start", "length", "offset", "fadeIn", "fadeOut", "gain", "peaksId", "label"])],
  ["events", listOf(["id", "beat", "name", ["payload", sortDeep]])],
  ["children", list((t) => canonTrack(t))],
];
const canonTrack = shape(TRACK_FIELDS);

function canon(seq: unknown): Obj {
  return ordered(seq as Obj, [
    "version", "id", "name", "length", "beatsPerBar",
    ["tempo", listOf(["beat", "bpm"])],
    ["tracks", list(canonTrack)],
    ["markers", listOf(["id", "beat", "label", "color"])],
    ["library", (lib) => Object.fromEntries(Object.keys(lib as Obj).sort().map((k) => [k, canon((lib as Obj)[k])]))],
  ]);
}

/** Deterministic JSON: fixed key order, library sorted by id, `data` keys sorted. */
export function serializeSequence(seq: Sequence, space?: number): string {
  return JSON.stringify(canon(seq), null, space);
}

// ---- validation -------------------------------------------------------------------------------

const COLOR_ARITY: Record<string, number[]> = { rgb: [3], rgba: [4], hsv: [3, 4], hue: [1] };
const INTERPS = ["constant", "linear", "bezier"];
const TAN_MODES = ["auto", "aligned", "free"];

function validateOne(seq: Obj, where: string, issues: string[]): void {
  const bad = (m: string) => issues.push(`${where}: ${m}`);
  const ids = new Set<string>();
  const id = (v: unknown, what: string) => {
    if (typeof v !== "string" || v === "") return bad(`${what} needs a non-empty string id`);
    if (ids.has(v)) return bad(`duplicate id "${v}"`);
    ids.add(v);
  };
  const num = (v: unknown, what: string, min?: number): v is number => {
    if (typeof v !== "number" || !Number.isFinite(v)) return bad(`${what} must be a finite number`), false;
    if (min !== undefined && v < min) return bad(`${what} must be >= ${min}`), false;
    return true;
  };
  const beat = (v: unknown, what: string, min?: number) => {
    if (num(v, what, min) && quantize(v) !== v) bad(`${what} ${v} is not quantized to 1/960`);
  };
  const arr = (v: unknown, what: string): Obj[] => {
    if (!Array.isArray(v)) return bad(`${what} must be an array`), [];
    return v.filter((x, i): x is Obj => isObj(x) || (bad(`${what}[${i}] must be an object`), false));
  };

  if (typeof seq.name !== "string") bad("name must be a string");
  beat(seq.length, "length", 0);
  num(seq.beatsPerBar, "beatsPerBar", 1);
  const tempo = arr(seq.tempo, "tempo");
  if (tempo.length === 0) bad("tempo needs at least one point");
  tempo.forEach((p, i) => {
    beat(p.beat, `tempo[${i}].beat`, 0);
    if (num(p.bpm, `tempo[${i}].bpm`) && p.bpm <= 0) bad(`tempo[${i}].bpm must be > 0`);
    if (i === 0 && p.beat !== 0) bad("tempo must start at beat 0");
    if (i > 0 && typeof p.beat === "number" && p.beat <= (tempo[i - 1]!.beat as number)) bad("tempo beats must be strictly increasing");
  });
  for (const m of arr(seq.markers, "markers")) {
    id(m.id, "marker");
    beat(m.beat, `marker ${String(m.id)} beat`, 0);
    if (typeof m.label !== "string") bad(`marker ${String(m.id)} label must be a string`);
  }

  const track = (t: Obj) => {
    id(t.id, "track");
    if (typeof t.name !== "string") bad(`track ${String(t.id)} name must be a string`);
    if (t.binding !== undefined) {
      if (!isObj(t.binding) || typeof t.binding.targetId !== "string" || !t.binding.targetId) bad(`track ${String(t.id)} binding.targetId must be a non-empty string`);
    }
    switch (t.kind) {
      case "sections":
        for (const s of arr(t.sections, "sections")) {
          id(s.id, "section");
          const n = `section ${String(s.id)}`;
          beat(s.start, `${n} start`);
          beat(s.length, `${n} length`, 0);
          num(s.row, `${n} row`, 0);
          for (const k of ["offset", "easeIn", "easeOut"]) if (s[k] !== undefined) beat(s[k], `${n} ${k}`);
          for (const k of ["easeInShape", "easeOutShape"]) if (s[k] !== undefined && !isEaseShape(s[k])) bad(`${n} ${k} invalid`);
          if (s.scale !== undefined && num(s.scale, `${n} scale`) && s.scale === 0) bad(`${n} scale must be non-zero`);
          if (s.ref !== undefined && (!isObj(s.ref) || typeof s.ref.sequenceId !== "string")) bad(`${n} ref.sequenceId must be a string`);
        }
        break;
      case "channels":
        for (const c of arr(t.channels, "channels")) {
          id(c.id, "channel");
          const n = `channel ${String(c.id)}`;
          let prev = -Infinity;
          for (const [i, k] of arr(c.keys, `${n} keys`).entries()) {
            beat(k.beat, `${n} key[${i}].beat`);
            num(k.value, `${n} key[${i}].value`);
            if (!INTERPS.includes(k.interp as string)) bad(`${n} key[${i}].interp invalid`);
            if (k.tan !== undefined && (!isObj(k.tan) || !TAN_MODES.includes(k.tan.mode as string))) bad(`${n} key[${i}].tan invalid`);
            if (typeof k.beat === "number") {
              if (k.beat <= prev) bad(`${n} keys must be sorted and unique by beat`);
              prev = k.beat;
            }
          }
        }
        if (t.groups !== undefined) {
          const ids = new Set(arr(t.channels, "channels").map((c) => c.id));
          for (const g of arr(t.groups, "groups")) {
            id(g.id, "group");
            const n = `group ${String(g.id)}`;
            if (typeof g.name !== "string") bad(`${n} name must be a string`);
            if (!Array.isArray(g.channelIds) || g.channelIds.some((c) => !ids.has(c))) bad(`${n} channelIds must name channels of the track`);
            if (g.range !== undefined) num(g.range, `${n} range`, 0);
            const want = COLOR_ARITY[g.kind as string];
            if (want && Array.isArray(g.channelIds) && !want.includes(g.channelIds.length)) bad(`${n} kind "${String(g.kind)}" needs ${want.join(" or ")} channels`);
            if (g.range === 0) bad(`${n} range must be > 0`);
          }
        }
        break;
      case "audio":
        for (const c of arr(t.clips, "clips")) {
          id(c.id, "clip");
          const n = `clip ${String(c.id)}`;
          beat(c.start, `${n} start`);
          beat(c.length, `${n} length`, 0);
          beat(c.offset, `${n} offset`);
          for (const k of ["fadeIn", "fadeOut"]) if (c[k] !== undefined) beat(c[k], `${n} ${k}`, 0);
          if (c.gain !== undefined) num(c.gain, `${n} gain`, 0);
        }
        break;
      case "events":
        for (const e of arr(t.events, "events")) {
          id(e.id, "event");
          beat(e.beat, `event ${String(e.id)} beat`, 0);
          if (typeof e.name !== "string") bad(`event ${String(e.id)} name must be a string`);
        }
        break;
      case "folder":
        arr(t.children, "children").forEach(track);
        break;
      default:
        bad(`track ${String(t.id)} has unknown kind "${String(t.kind)}"`);
    }
  };
  arr(seq.tracks, "tracks").forEach(track);
}

/** Narrowing only: the structural checks above (validateOne) have already run on `doc` when this is called. */
const isSequenceShape = (doc: Obj): doc is Obj & Sequence => typeof doc.id === "string";

/** All problems with a (structurally typed) sequence; empty when valid. */
export function validateSequence(seq: Sequence): string[] {
  return validateDoc(seq);
}

function validateDoc(doc: unknown): string[] {
  if (!isObj(doc)) return ["document must be an object"];
  const issues: string[] = [];
  if (doc.version !== CURRENT_VERSION) issues.push(`version must be ${CURRENT_VERSION}`);
  if (typeof doc.id !== "string" || doc.id === "") issues.push("root id must be a non-empty string");
  validateOne(doc, `sequence "${String(doc.id)}"`, issues);
  if (!isObj(doc.library)) {
    issues.push("library must be an object");
    return issues;
  }
  for (const [key, child] of Object.entries(doc.library)) {
    if (!isObj(child)) issues.push(`library["${key}"] must be an object`);
    else {
      if (child.id !== key) issues.push(`library key "${key}" does not match sequence id "${String(child.id)}"`);
      if (key === doc.id) issues.push(`library contains the root id "${key}"`);
      validateOne(child, `library["${key}"]`, issues);
    }
  }
  if (issues.length) return issues; // graph checks assume a well-formed shape
  if (!isSequenceShape(doc)) return issues;
  const cycle = findCycle(doc);
  if (cycle) issues.push(`reference cycle: ${cycle.join(" -> ")}`);
  for (const id of danglingRefs(doc)) issues.push(`dangling ref to missing sequence "${id}"`);
  return issues;
}

// ---- parse ------------------------------------------------------------------------------------

/** Parse JSON text (or an already-parsed value), migrate to the current version, validate. Throws SequenceFormatError. */
export function parseSequence(input: string | unknown): Sequence {
  let doc: unknown = input;
  if (typeof input === "string") {
    try {
      doc = JSON.parse(input);
    } catch (e) {
      throw new SequenceFormatError([`not valid JSON: ${(e as Error).message}`]);
    }
  }
  if (!isObj(doc)) throw new SequenceFormatError(["document must be an object"]);
  let cur: Obj = doc;
  let v = cur.version;
  if (typeof v !== "number" || !Number.isInteger(v)) throw new SequenceFormatError(["version must be an integer"]);
  if (v > CURRENT_VERSION) throw new SequenceFormatError([`version ${v} is newer than supported ${CURRENT_VERSION}`]);
  for (; v < CURRENT_VERSION; v++) {
    const step = migrations[v];
    if (!step) throw new SequenceFormatError([`no migration from version ${v}`]);
    cur = { ...step(cur), version: v + 1 };
  }
  const issues = validateDoc(cur);
  if (issues.length || !isSequenceShape(cur)) throw new SequenceFormatError(issues);
  return cur;
}
