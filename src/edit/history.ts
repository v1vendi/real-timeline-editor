// Undo/redo over immutable Sequence snapshots (structural sharing makes entries cheap).
// Selection is not part of history. A gesture is one entry via begin/preview/commit.
import type { Sequence } from "../core/model";

export interface HistoryEntry { label: string; before: Sequence; after: Sequence; mergeKey?: string; time: number }
export interface HistoryOptions { cap?: number; mergeWindowMs?: number; now?: () => number; onChange?: (seq: Sequence, info: { label: string; kind: "edit" | "undo" | "redo" }) => void }

export class History {
  seq: Sequence;
  past: HistoryEntry[] = [];
  future: HistoryEntry[] = [];
  private tx: { label: string; before: Sequence; mergeKey?: string } | null = null;
  private cap: number;
  private win: number;
  private now: () => number;
  private onChange?: HistoryOptions["onChange"];

  constructor(seq: Sequence, o: HistoryOptions = {}) {
    this.seq = seq;
    this.cap = o.cap ?? 200;
    this.win = o.mergeWindowMs ?? 500;
    this.now = o.now ?? Date.now;
    this.onChange = o.onChange;
  }

  get canUndo() { return this.past.length > 0 && !this.tx; }
  get canRedo() { return this.future.length > 0 && !this.tx; }

  /** Run one command as one entry. Consecutive edits sharing `mergeKey` within the window coalesce. */
  apply(label: string, fn: (s: Sequence) => Sequence, mergeKey?: string): void {
    if (this.tx) return this.preview(fn); // inside a gesture: fold into it
    const after = fn(this.seq);
    if (after !== this.seq) this.push({ label, before: this.seq, after, mergeKey, time: this.now() });
  }

  begin(label: string, mergeKey?: string): void {
    if (!this.tx) this.tx = { label, before: this.seq, mergeKey };
  }

  /** Replace the live sequence during a gesture, computed from the pre-gesture state. */
  preview(fn: (s: Sequence) => Sequence): void {
    if (this.tx) this.seq = fn(this.tx.before);
  }

  commit(): void {
    const t = this.tx;
    if (!t) return;
    this.tx = null;
    if (this.seq === t.before) return;
    const after = this.seq;
    this.seq = t.before; // push() re-assigns
    this.push({ label: t.label, before: t.before, after, mergeKey: t.mergeKey, time: this.now() });
  }

  cancel(): void {
    if (this.tx) { this.seq = this.tx.before; this.tx = null; }
  }

  undo(): boolean {
    const e = this.past.at(-1);
    if (!e || this.tx) return false;
    this.past.pop();
    this.future.push(e);
    this.seq = e.before;
    this.onChange?.(this.seq, { label: e.label, kind: "undo" });
    return true;
  }

  redo(): boolean {
    const e = this.future.pop();
    if (!e || this.tx) return false;
    this.past.push(e);
    this.seq = e.after;
    this.onChange?.(this.seq, { label: e.label, kind: "redo" });
    return true;
  }

  private push(e: HistoryEntry): void {
    const top = this.past.at(-1);
    if (top && e.mergeKey && top.mergeKey === e.mergeKey && e.time - top.time <= this.win && this.future.length === 0) {
      this.past[this.past.length - 1] = { ...top, after: e.after, time: e.time };
    } else {
      this.past.push(e);
      if (this.past.length > this.cap) this.past.shift();
    }
    this.future = [];
    this.seq = e.after;
    this.onChange?.(this.seq, { label: e.label, kind: "edit" });
  }
}
