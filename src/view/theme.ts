// Visual theme: every color, font, radius and row height the view draws with. One object, dark default,
// light variant. Canvas painters read it from `DrawContext.theme`; DOM pieces (outliner, crumb bar) read it
// as CSS custom properties set by `themeCssVars`. No DOM access here.

export interface Theme {
  /** Name of the base this theme started from (`"dark"`, `"light"` or whatever the host picked). */
  name: string;
  font: {
    ui: string;
    mono: string;
    /** Body text (section labels, outliner rows), px. */
    size: number;
    /** Small text (ruler seconds, marker flags, chips), px. */
    small: number;
  };
  radius: {
    /** Section / clip bars. */
    bar: number;
    /** Chips, pills and outliner buttons. */
    chip: number;
  };
  /** Default row heights (px), used until the host fits or resets them. */
  rows: { trackH: number; channelH: number };
  color: {
    // canvas body
    bg: string; rowA: string; rowB: string; rowLine: string;
    gridMinor: string; gridBeat: string; gridBar: string;
    /** Shade over the area past the sequence end. */
    pastEnd: string;
    // ruler
    rulerBg: string; rulerLine: string; rulerTick: string; rulerTickStrong: string; rulerText: string; rulerSub: string;
    // general
    text: string; textDim: string; textOnBar: string;
    accent: string; accentSoft: string;
    /** Selection outline and its glow. */
    selection: string; selectionGlow: string;
    playhead: string; playheadGlow: string;
    // content
    section: string; sheen: string; shade: string;
    audio: string; waveform: string;
    key: string; keyStroke: string; curve: string;
    event: string;
    marker: string; markerText: string;
    range: string; rangeEdge: string; loop: string;
    chip: string; chipText: string; chipActive: string; chipActiveText: string;
    handle: string; handleGain: string; handleStroke: string;
    ghost: string; ghostEdge: string; box: string; boxEdge: string;
    guide: { grid: string; section: string; key: string; event: string; playhead: string; marker: string };
    /** Curve editor series colors (cycled per channel). */
    series: string[];
    /** Color channel groups: per-channel tint / curve colors (r g b a / h s v), checkerboard under alpha, key outline. */
    color: { r: string; g: string; b: string; a: string; h: string; s: string; v: string; checkerA: string; checkerB: string; ring: string };
    // DOM: outliner and crumb bar
    panel: string; panelHover: string; panelSel: string; panelText: string; panelDim: string; panelLine: string;
    button: string; buttonBorder: string; mute: string; solo: string; lock: string;
    kind: { sections: string; channels: string; events: string; audio: string; folder: string };
    popup: string; popupBorder: string;
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
/** Partial theme: anything omitted comes from `base` (default `"dark"`). */
export type ThemeInput = DeepPartial<Theme> & { base?: "dark" | "light" };

const FONT_UI = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
const FONT_MONO = `ui-monospace, "SF Mono", Menlo, monospace`;

export const darkTheme: Theme = {
  name: "dark",
  font: { ui: FONT_UI, mono: FONT_MONO, size: 11.5, small: 10 },
  radius: { bar: 5, chip: 4 },
  rows: { trackH: 28, channelH: 22 },
  color: {
    bg: "#14151a", rowA: "#181a1f", rowB: "#1b1d23", rowLine: "#23252c",
    gridMinor: "rgba(255,255,255,.03)", gridBeat: "rgba(255,255,255,.06)", gridBar: "rgba(255,255,255,.12)",
    pastEnd: "rgba(0,0,0,.26)",
    rulerBg: "#1c1d23", rulerLine: "#31323b", rulerTick: "#555868", rulerTickStrong: "#9599aa", rulerText: "#e0e2ea", rulerSub: "#6d7086",
    text: "#e8e9ef", textDim: "#8f92a3", textOnBar: "#ffffff",
    accent: "#5b8def", accentSoft: "rgba(91,141,239,.16)",
    selection: "#ffffff", selectionGlow: "rgba(130,175,255,.85)",
    playhead: "#ff5a52", playheadGlow: "rgba(255,90,82,.2)",
    section: "#4a7fd4", sheen: "rgba(255,255,255,.2)", shade: "rgba(0,0,0,.24)",
    audio: "#21574b", waveform: "#8fe6cc",
    key: "#ffc94d", keyStroke: "rgba(30,20,0,.7)", curve: "#5fd39c",
    event: "#ff9f5a",
    marker: "#e8b341", markerText: "#1b1608",
    range: "rgba(91,141,239,.2)", rangeEdge: "#5b8def", loop: "#ffb454",
    chip: "rgba(255,255,255,.07)", chipText: "#c4c7d4", chipActive: "#ffb454", chipActiveText: "#1b1b1f",
    handle: "#eceef5", handleGain: "#ffd84d", handleStroke: "#14151a",
    ghost: "rgba(255,255,255,.2)", ghostEdge: "#ffffff", box: "rgba(91,141,239,.16)", boxEdge: "#5b8def",
    guide: { grid: "rgba(255,255,255,.3)", section: "#ffd84d", key: "#7be0a0", event: "#7be0a0", playhead: "#ff5a5a", marker: "#6cb6ff" },
    series: ["#5ab0ff", "#ff8a5a", "#7bd88f", "#d98aff", "#ffd45a"],
    color: { r: "#ff5d5d", g: "#4fdc6e", b: "#5a8dff", a: "#c9ccd8", h: "#ffa64d", s: "#b58cff", v: "#dfe1ea", checkerA: "#3a3c46", checkerB: "#555866", ring: "rgba(255,255,255,.9)" },
    panel: "#1a1b21", panelHover: "rgba(255,255,255,.045)", panelSel: "rgba(91,141,239,.22)", panelText: "#dfe1ea", panelDim: "#8b8ea0", panelLine: "#23252c",
    button: "rgba(255,255,255,.05)", buttonBorder: "rgba(255,255,255,.1)", mute: "#d2693a", solo: "#d1ae35", lock: "#5b8def",
    kind: { sections: "#6ea0ff", channels: "#5fd39c", events: "#ff9f5a", audio: "#46c4a6", folder: "#c2aa6e" },
    popup: "rgba(24,25,31,.94)", popupBorder: "rgba(255,255,255,.14)",
  },
};

export const lightTheme: Theme = {
  name: "light",
  font: darkTheme.font,
  radius: darkTheme.radius,
  rows: darkTheme.rows,
  color: {
    bg: "#f2f3f6", rowA: "#f6f7f9", rowB: "#eff0f4", rowLine: "#dfe1e8",
    gridMinor: "rgba(20,24,40,.035)", gridBeat: "rgba(20,24,40,.07)", gridBar: "rgba(20,24,40,.15)",
    pastEnd: "rgba(20,24,40,.07)",
    rulerBg: "#e8eaf0", rulerLine: "#cbcdd8", rulerTick: "#a2a5b5", rulerTickStrong: "#5d6073", rulerText: "#23252f", rulerSub: "#80839a",
    text: "#22242e", textDim: "#6b6e80", textOnBar: "#ffffff",
    accent: "#3d74e0", accentSoft: "rgba(61,116,224,.14)",
    selection: "#14161f", selectionGlow: "rgba(61,116,224,.7)",
    playhead: "#e5372e", playheadGlow: "rgba(229,55,46,.16)",
    section: "#4a7fd4", sheen: "rgba(255,255,255,.3)", shade: "rgba(10,20,50,.3)",
    audio: "#7cc9b4", waveform: "#1d5a4b",
    key: "#f2a900", keyStroke: "rgba(90,50,0,.75)", curve: "#1f9c68",
    event: "#e57a26",
    marker: "#e8a91c", markerText: "#2b1f00",
    range: "rgba(61,116,224,.16)", rangeEdge: "#3d74e0", loop: "#e08a1e",
    chip: "rgba(20,24,40,.07)", chipText: "#3c3f50", chipActive: "#e08a1e", chipActiveText: "#ffffff",
    handle: "#ffffff", handleGain: "#d99a00", handleStroke: "#2a2d3a",
    ghost: "rgba(20,24,40,.14)", ghostEdge: "#14161f", box: "rgba(61,116,224,.14)", boxEdge: "#3d74e0",
    guide: { grid: "rgba(20,24,40,.3)", section: "#d99a00", key: "#1f9c68", event: "#1f9c68", playhead: "#e5372e", marker: "#2a7fd0" },
    series: ["#2a82d8", "#e0602a", "#2f9e4f", "#a64fd0", "#c79a00"],
    color: { r: "#d83a3a", g: "#2a9e47", b: "#2f66d8", a: "#6b6e80", h: "#dd7a12", s: "#8a52d8", v: "#4a4d5e", checkerA: "#ffffff", checkerB: "#cfd2dc", ring: "rgba(20,24,40,.85)" },
    panel: "#eceef3", panelHover: "rgba(20,24,40,.05)", panelSel: "rgba(61,116,224,.18)", panelText: "#23252f", panelDim: "#72758a", panelLine: "#dcdee6",
    button: "rgba(20,24,40,.05)", buttonBorder: "rgba(20,24,40,.16)", mute: "#d2693a", solo: "#c79c1e", lock: "#3d74e0",
    kind: { sections: "#3d74e0", channels: "#1f9c68", events: "#e57a26", audio: "#1d9c80", folder: "#a8883a" },
    popup: "rgba(255,255,255,.95)", popupBorder: "rgba(20,24,40,.2)",
  },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function merge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(patch)) if (patch[k] !== undefined) out[k] = merge(out[k], patch[k]);
  return out as T;
}

/** Full theme from a partial: missing fields come from `input.base` (default dark). Returns the preset itself for `{}`. */
export function resolveTheme(input?: ThemeInput): Theme {
  const base = input?.base === "light" ? lightTheme : darkTheme;
  if (!input) return base;
  const { base: _b, ...rest } = input;
  return Object.keys(rest).length ? merge(base, rest) : base;
}

/** CSS custom properties (`--tl-*`) for the DOM parts (outliner, crumb bar). Set them on the widget root. */
export function themeCssVars(t: Theme): Record<string, string> {
  const c = t.color;
  return {
    "--tl-font": t.font.ui, "--tl-font-size": `${t.font.size}px`, "--tl-small": `${t.font.small}px`,
    "--tl-radius": `${t.radius.chip}px`,
    "--tl-bg": c.bg, "--tl-row-a": c.rowA, "--tl-row-b": c.rowB, "--tl-line": c.rowLine,
    "--tl-ruler": c.rulerBg, "--tl-ruler-line": c.rulerLine, "--tl-ruler-text": c.rulerSub,
    "--tl-accent": c.accent, "--tl-panel": c.panel, "--tl-hover": c.panelHover, "--tl-sel": c.panelSel,
    "--tl-text": c.panelText, "--tl-dim": c.panelDim, "--tl-panel-line": c.panelLine,
    "--tl-btn": c.button, "--tl-btn-border": c.buttonBorder, "--tl-mute": c.mute, "--tl-solo": c.solo, "--tl-lock": c.lock,
    "--tl-k-sections": c.kind.sections, "--tl-k-channels": c.kind.channels, "--tl-k-events": c.kind.events, "--tl-k-audio": c.kind.audio, "--tl-k-folder": c.kind.folder,
    "--tl-popup": c.popup, "--tl-popup-border": c.popupBorder,
  };
}

export function applyThemeVars(el: HTMLElement, t: Theme): void {
  for (const [k, v] of Object.entries(themeCssVars(t))) el.style.setProperty(k, v);
}

/** Rounded-rect path (uses `roundRect` where available). Does not begin the path. */
export function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr < 0.5) { ctx.rect(x, y, w, h); return; }
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, rr); return; }
  ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr); ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr); ctx.arcTo(x, y, x + w, y, rr); ctx.closePath();
}

let sheenGrad: { key: string; g: CanvasGradient } | null = null;
/** Fill a bar with a soft top-light / bottom-shade gradient over whatever is already painted (one shared unit gradient). */
export function fillSheen(ctx: CanvasRenderingContext2D, t: Theme, x: number, y: number, w: number, h: number, r: number): void {
  const key = t.color.sheen + t.color.shade;
  if (!sheenGrad || sheenGrad.key !== key) {
    const g = ctx.createLinearGradient(0, 0, 0, 1);
    g.addColorStop(0, t.color.sheen); g.addColorStop(0.5, "rgba(255,255,255,0)"); g.addColorStop(1, t.color.shade);
    sheenGrad = { key, g };
  }
  ctx.save(); ctx.beginPath(); roundRectPath(ctx, x, y, w, h, r); ctx.clip();
  ctx.translate(x, y); ctx.scale(1, h); ctx.fillStyle = sheenGrad.g; ctx.fillRect(0, 0, w, 1);
  ctx.restore();
}
