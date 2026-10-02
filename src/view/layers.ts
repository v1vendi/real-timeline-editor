import { defaultViewState, type ViewState } from "./viewState";
import { darkTheme, type Theme } from "./theme";

export type Layer = "static" | "overlay";
export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  width: number; // CSS px
  height: number;
  view: ViewState;
  dpr: number;
  /** Active theme (dark default). */
  theme: Theme;
}
type DrawFn = (c: DrawContext) => void;

/**
 * Two stacked canvases: `static` (grid, rows, sections, keys) and `overlay`
 * (playhead, drag preview). Each has its own dirty flag; invalidations are
 * coalesced into one requestAnimationFrame. Overlay redraws never touch static.
 */
export class LayeredCanvas {
  readonly staticCanvas = document.createElement("canvas");
  readonly overlayCanvas = document.createElement("canvas");
  drawStatic: DrawFn = () => {};
  drawOverlay: DrawFn = () => {};
  theme: Theme = darkTheme;
  private view = defaultViewState();
  private dirty = { static: true, overlay: true };
  private raf = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private ro: ResizeObserver;
  /** Frame time of the last paint in ms, for the demo readout. */
  lastFrameMs = 0;

  constructor(readonly host: HTMLElement) {
    host.style.position = "relative";
    for (const c of [this.staticCanvas, this.overlayCanvas]) {
      c.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
      host.appendChild(c);
    }
    this.overlayCanvas.style.pointerEvents = "none";
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  /** Swap the theme and repaint both layers. */
  setTheme(t: Theme): void { this.theme = t; this.invalidate("static"); this.invalidate("overlay"); }
  getView(): ViewState { return this.view; }
  setView(v: ViewState): void {
    this.view = v;
    this.invalidate("static");
    this.invalidate("overlay");
  }

  invalidate(layer: Layer): void {
    this.dirty[layer] = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.staticCanvas.remove();
    this.overlayCanvas.remove();
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    for (const c of [this.staticCanvas, this.overlayCanvas]) {
      c.width = Math.max(1, Math.round(r.width * this.dpr));
      c.height = Math.max(1, Math.round(r.height * this.dpr));
    }
    this.invalidate("static");
    this.invalidate("overlay");
  }

  private frame(): void {
    this.raf = 0;
    const t0 = performance.now();
    if (this.dirty.static) this.paint(this.staticCanvas, this.drawStatic);
    if (this.dirty.overlay) this.paint(this.overlayCanvas, this.drawOverlay);
    this.dirty.static = this.dirty.overlay = false;
    this.lastFrameMs = performance.now() - t0;
  }

  private paint(canvas: HTMLCanvasElement, draw: DrawFn): void {
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    draw({ ctx, width: this.w, height: this.h, view: this.view, dpr: this.dpr, theme: this.theme });
  }
}
