// Breadcrumb bar content (visible inside a nested sequence only): Up button, clickable crumbs, read-only notice.
export interface Crumb { id: string; name: string }

interface CrumbActions { goUp: () => void; goTo: (i: number) => void; focus: () => void }

export function renderCrumbs(crumbEl: HTMLElement, cs: readonly Crumb[], a: CrumbActions): void {
  const btn = (text: string, title: string, on: () => void, css: string) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = text; b.title = title;
    b.className = "tl-crumb " + css;
    b.onclick = (e) => { e.stopPropagation(); on(); a.focus(); };
    b.onpointerdown = b.ondblclick = (e) => e.stopPropagation();
    return b;
  };
  const up = btn("↑ Up", "Leave this sequence (Esc / Alt+Up)", a.goUp, "tl-crumb-up");
  const notice = document.createElement("span");
  notice.textContent = "read-only"; notice.className = "tl-crumb-note";
  crumbEl.replaceChildren(up, ...cs.flatMap((c, i) => {
    const last = i === cs.length - 1;
    const b = btn(c.name || c.id, last ? "" : "Go to " + (c.name || c.id), () => { if (!last) a.goTo(i); }, last ? "tl-crumb-cur" : "tl-crumb-link");
    return i ? [Object.assign(document.createElement("span"), { textContent: "›", className: "tl-crumb-sep" }), b] : [b];
  }), notice);
  crumbEl.style.display = cs.length > 1 ? "flex" : "none";
  crumbEl.style.alignItems = "center";
}
