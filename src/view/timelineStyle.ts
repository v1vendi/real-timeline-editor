// Stylesheet for the read-only outliner state and the breadcrumb bar.
export const TIMELINE_CSS = `.tl-ro .tl-b{opacity:.45;cursor:default!important}
.tl-crumbs{gap:6px;padding:4px 6px 4px 4px;font:12px var(--tl-font);background:var(--tl-popup);color:var(--tl-text);border:1px solid var(--tl-popup-border);border-radius:calc(var(--tl-radius) + 3px);box-shadow:0 4px 14px rgba(0,0,0,.25);backdrop-filter:blur(6px)}
.tl-crumb{font:inherit;color:inherit;background:none;border:0;padding:1px 3px;border-radius:3px}
.tl-crumb-up{cursor:pointer;background:var(--tl-btn);border:1px solid var(--tl-btn-border);padding:1px 8px;color:var(--tl-text)}
.tl-crumb-up:hover{background:var(--tl-hover);border-color:var(--tl-accent)}
.tl-crumb-link{cursor:pointer;color:var(--tl-dim)}.tl-crumb-link:hover{color:var(--tl-text);background:var(--tl-hover)}
.tl-crumb-cur{font-weight:600;cursor:default}.tl-crumb-sep{color:var(--tl-dim);opacity:.7}
.tl-crumb-note{color:var(--tl-dim);font-style:italic;margin-left:4px;padding-left:8px;border-left:1px solid var(--tl-popup-border)}`;
