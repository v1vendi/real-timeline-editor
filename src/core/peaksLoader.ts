// Lazy host peaks: wraps a host `peaks(id)` hook as a PeaksMap-shaped reader. No DOM.
// The hook may return mips now, a promise, or undefined (unknown). Each id is asked once (failures
// and "unknown" are cached until `reset`); `onLoad` fires when a promise resolves with data.
import type { PeakMips } from "./waveform";

export type PeaksHook = (id: string) => PeakMips | undefined | Promise<PeakMips | undefined>;
export interface LazyPeaks {
  get(id: string): PeakMips | undefined;
  /** Forget everything (or one id) so the hook is asked again. */
  reset(id?: string): void;
}

export function lazyPeaks(hook: PeaksHook, onLoad: (id: string) => void): LazyPeaks {
  const done = new Map<string, PeakMips | undefined>();
  const pending = new Set<string>();
  let epoch = 0;
  return {
    get(id) {
      if (done.has(id)) return done.get(id);
      if (pending.has(id)) return undefined;
      let r: ReturnType<PeaksHook>;
      try { r = hook(id); } catch { done.set(id, undefined); return undefined; }
      if (!(r instanceof Promise)) { done.set(id, r); return r; }
      pending.add(id);
      const at = epoch;
      r.then((m) => m, () => undefined).then((m) => {
        if (at !== epoch) return;
        pending.delete(id); done.set(id, m);
        if (m) onLoad(id);
      });
      return undefined;
    },
    reset(id) {
      if (id === undefined) { epoch++; done.clear(); pending.clear(); } else { done.delete(id); pending.delete(id); }
    },
  };
}
