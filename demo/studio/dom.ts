// Shared DOM helpers for the studio panels.
export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};
export const row = (...k: (Node | string)[]) => { const d = el("div", {}, ...k); d.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0"; return d; };
export const btn = (text: string, onclick: () => void, id?: string) => { const b = el("button", { textContent: text, onclick }); if (id) b.id = id; return b; };
