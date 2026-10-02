// Pure waveform peak mip builder (no DOM). The host may build peaks itself;
// this helper turns PCM into a min/max pyramid and picks a level for a zoom.

export interface Peaks {
  /** Peaks per second of audio at this level. */
  peaksPerSecond: number;
  min: Float32Array;
  max: Float32Array;
}

export interface PeakMips {
  sampleRate: number;
  /** levels[0] is the finest; each next level has half the peaks per second. */
  levels: Peaks[];
}

/** Build the finest level: one min/max pair per `samplesPerPeak` samples. */
export function buildPeaks(samples: ArrayLike<number>, sampleRate: number, samplesPerPeak: number): Peaks {
  const spp = Math.max(1, Math.floor(samplesPerPeak));
  const n = Math.ceil(samples.length / spp);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const end = Math.min(samples.length, (i + 1) * spp);
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = i * spp; j < end; j++) {
      const v = samples[j]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[i] = lo;
    max[i] = hi;
  }
  return { peaksPerSecond: sampleRate / spp, min, max };
}

/** Halve a level (pairs merged by min/max); an odd trailing peak is kept. */
export function downsamplePeaks(p: Peaks): Peaks {
  const n = Math.ceil(p.min.length / 2);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = 2 * i;
    const b = Math.min(a + 1, p.min.length - 1);
    min[i] = Math.min(p.min[a]!, p.min[b]!);
    max[i] = Math.max(p.max[a]!, p.max[b]!);
  }
  return { peaksPerSecond: p.peaksPerSecond / 2, min, max };
}

/** Build the pyramid from PCM, down to `minPeaks` peaks in the coarsest level. */
export function buildPeakMips(
  samples: ArrayLike<number>,
  sampleRate: number,
  opts: { samplesPerPeak?: number; minPeaks?: number } = {},
): PeakMips {
  const minPeaks = Math.max(1, opts.minPeaks ?? 64);
  let cur = buildPeaks(samples, sampleRate, opts.samplesPerPeak ?? 64);
  const levels: Peaks[] = [cur];
  while (cur.min.length > minPeaks) {
    cur = downsamplePeaks(cur);
    levels.push(cur);
  }
  return { sampleRate, levels };
}

/**
 * Per docs/behavior.md section 8: the finest level where one peak is >= 1 px wide
 * (peaksPerSecond <= pxPerSecond). Zoomed in past level 0 gives 0; zoomed out
 * past the coarsest gives the coarsest.
 */
export function pickMip(mips: PeakMips, pxPerSecond: number): number {
  const i = mips.levels.findIndex((l) => l.peaksPerSecond <= pxPerSecond);
  return i < 0 ? mips.levels.length - 1 : i;
}
