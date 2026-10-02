// Crumbs panel: toolbar breadcrumb trail for nested sequences (getCrumbs / goTo). Hidden at the root.
import type { StudioCtx } from "../../studio";

export default function mount(ctx: StudioCtx): void {
  const box = document.createElement("div");
  box.id = "studio-crumbs";
  box.style.cssText = "display:none;align-items:center;gap:6px;font:12px system-ui,sans-serif;padding:0 6px;border-left:1px solid var(--border)";
  ctx.toolbar.append(box);
  const render = () => {
    const cs = ctx.tl.getCrumbs();
    box.style.display = cs.length > 1 ? "flex" : "none";
    box.replaceChildren(...cs.flatMap((c, i) => {
      const last = i === cs.length - 1;
      const b = Object.assign(document.createElement("button"), { textContent: c.name || c.id, disabled: last, onclick: () => ctx.tl.goTo(i), title: last ? "Current sequence" : "Go to " + c.name });
      return i ? [Object.assign(document.createElement("span"), { textContent: "›" }), b] : [b];
    }));
    if (cs.length > 1) box.prepend(Object.assign(document.createElement("button"), { textContent: "↑ Up", onclick: () => ctx.tl.goTo(cs.length - 2), id: "studio-up" }));
  };
  ctx.onUpdate(render); ctx.onRebind(render);
  render();
}
