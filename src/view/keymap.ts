// Data-driven keymap (behavior.md section 15): action ids -> chords, user overrides merged over
// defaults, chord parsing/normalizing, conflict detection. Pure; no DOM types needed.
export type CommandId = "delete" | "duplicate" | "copy" | "cut" | "paste" | "selectAll" | "playToggle" | "stepBack" | "stepForward" | "jumpStart" | "jumpEnd" | "split" | "marker" | "undo" | "redo" | "clear" | "addEvent" | "prevMarker" | "nextMarker" | "zoomSelection" | "zoomOut" | "nudgeLeft" | "nudgeRight" | "quantize" | "goUp" | "rowPrev" | "rowNext" | "rename";

/** Default bindings per action, in canonical chord form ("Mod" = Ctrl or Cmd). */
export const DEFAULT_BINDINGS: Record<CommandId, string[]> = {
  delete: ["Delete", "Backspace"], duplicate: ["Mod+D"], copy: ["Mod+C"], cut: ["Mod+X"], paste: ["Mod+V"], selectAll: ["Mod+A"],
  playToggle: ["Space"], stepBack: ["ArrowLeft"], stepForward: ["ArrowRight"], jumpStart: ["Shift+ArrowLeft"], jumpEnd: ["Shift+ArrowRight"],
  split: ["S"], marker: ["M"], undo: ["Mod+Z"], redo: ["Mod+Shift+Z", "Mod+Y"], clear: ["Escape"], addEvent: ["E"], prevMarker: ["Alt+,"], nextMarker: ["Alt+."],
  zoomSelection: ["Z"], zoomOut: ["X"], nudgeLeft: ["Mod+ArrowLeft"], nudgeRight: ["Mod+ArrowRight"], quantize: ["Q"], goUp: ["Alt+ArrowUp"], rowPrev: ["ArrowUp"], rowNext: ["ArrowDown"], rename: ["R", "F2"],
};
export const COMMAND_IDS = Object.keys(DEFAULT_BINDINGS) as CommandId[];

/** Per-action override: chord(s) replace the defaults; `null` or `[]` unbinds the action. */
export type KeymapOverrides = Partial<Record<CommandId, string | string[] | null>>;

export interface ParsedChord { mod: boolean; alt: boolean; shift: boolean; key: string }

const KEY_ALIASES: Record<string, string> = { " ": "Space", space: "Space", spacebar: "Space", esc: "Escape", del: "Delete", left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", return: "Enter" };
const MODS: Record<string, "mod" | "alt" | "shift"> = { mod: "mod", ctrl: "mod", control: "mod", cmd: "mod", meta: "mod", command: "mod", alt: "alt", option: "alt", shift: "shift" };

function normKey(k: string): string {
  const alias = KEY_ALIASES[k.toLowerCase()] ?? KEY_ALIASES[k];
  if (alias) return alias;
  return k.length === 1 ? k.toUpperCase() : k;
}

/** Parse "ctrl+shift+z" / "Mod+Shift+Z" / "Space" / "Mod++" into parts; null when empty or malformed. */
export function parseChord(text: string): ParsedChord | null {
  const t = text.trim();
  if (!t) return null;
  const out: ParsedChord = { mod: false, alt: false, shift: false, key: "" };
  const plus = t === "+" || t.endsWith("++");
  const parts = (plus ? t.slice(0, -1) : t).split("+").map((x) => x.trim());
  if (plus) { if (parts.pop() !== "") return null; out.key = "+"; } else out.key = parts.pop() ?? "";
  for (const m of parts) { const k = MODS[m.toLowerCase()]; if (!k) return null; out[k] = true; }
  if (!out.key || (out.key.length > 1 && MODS[out.key.toLowerCase()])) return null;
  out.key = normKey(out.key);
  return out;
}

/** Canonical string form: Mod+Alt+Shift+Key (Shift is dropped for Space). */
function formatChord(c: ParsedChord): string {
  return `${c.mod ? "Mod+" : ""}${c.alt ? "Alt+" : ""}${c.shift && c.key !== "Space" ? "Shift+" : ""}${c.key}`;
}
export function normalizeChord(text: string): string | null {
  const p = parseChord(text);
  return p ? formatChord(p) : null;
}
/** Chord string for a keyboard event (matches normalizeChord output). */
export function eventChord(e: { key: string; code?: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  // macOS Option+key yields a composed character; recover the physical , / . key from `code`.
  const key = e.altKey && e.code === "Comma" ? "," : e.altKey && e.code === "Period" ? "." : e.key;
  return formatChord({ mod: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey, key: normKey(key) });
}

export interface KeymapConflict { chord: string; actions: CommandId[] }
export interface ResolvedKeymap {
  /** Canonical chord -> action. */
  map: Record<string, CommandId>;
  /** Chords bound by more than one override (first action in COMMAND_IDS order wins the chord). */
  conflicts: KeymapConflict[];
  /** Override entries that could not be parsed or named an unknown action. */
  invalid: string[];
}

/** Merge overrides over defaults. An overridden chord displaces a default binding silently; two overrides on one chord conflict. */
export function buildKeymap(overrides: KeymapOverrides = {}): ResolvedKeymap {
  const invalid: string[] = [];
  const user = new Map<CommandId, string[]>();
  for (const [id, v] of Object.entries(overrides)) {
    if (!(id in DEFAULT_BINDINGS)) { invalid.push(id); continue; }
    const list = v == null ? [] : Array.isArray(v) ? v : [v];
    const chords: string[] = [];
    for (const c of list) { const n = normalizeChord(c); if (n) chords.push(n); else invalid.push(`${id}: ${c}`); }
    user.set(id as CommandId, chords);
  }
  const claimed = new Map<string, CommandId[]>();
  for (const id of COMMAND_IDS) for (const c of user.get(id) ?? []) claimed.set(c, [...(claimed.get(c) ?? []), id]);
  const map: Record<string, CommandId> = {};
  const conflicts: KeymapConflict[] = [];
  for (const [c, ids] of claimed) {
    map[c] = ids[0]!;
    if (ids.length > 1) conflicts.push({ chord: c, actions: ids });
  }
  for (const id of COMMAND_IDS) {
    if (user.has(id)) continue;
    for (const c of DEFAULT_BINDINGS[id]) if (!(c in map)) map[c] = id;
  }
  return { map, conflicts, invalid };
}
