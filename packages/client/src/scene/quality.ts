/** Quality tiers. Ids stay in English; labels are what players see. */
export type QualityTier = 'high' | 'low';

export const QUALITY_LABELS: Readonly<Record<QualityTier, string>> = { high: 'Alto', low: 'Baixo' };

export interface QualityPreset {
  /** Multiplier for effect particle counts. */
  particles: number;
  shadowMapSize: number;
  shadowRadius: number;
  bloom: boolean;
  /** Upper bound for devicePixelRatio (coarse pointers are capped lower still). */
  maxPixelRatio: number;
  /** Wildlife cast size (passed to the wildlife controller). */
  wildlife: QualityTier;
}

export const QUALITY_PRESETS: Readonly<Record<QualityTier, QualityPreset>> = {
  high: { particles: 1, shadowMapSize: 4096, shadowRadius: 3, bloom: true, maxPixelRatio: 2, wildlife: 'high' },
  low: { particles: 0.55, shadowMapSize: 1024, shadowRadius: 1, bloom: false, maxPixelRatio: 1, wildlife: 'low' },
};

/** 1.5 on touch devices (they are usually high-dpi and thermally limited), 2 elsewhere. */
export function pixelRatioCap(tier: QualityTier): number {
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const cap = QUALITY_PRESETS[tier].maxPixelRatio;
  return coarse ? Math.min(cap, 1.5) : cap;
}

export interface FpsReport {
  /** Average frames per second over the window. */
  average: number;
  /** 95th percentile frame time in milliseconds. */
  p95: number;
  frames: number;
  recommendation: QualityTier;
}

/**
 * Measures frame times for a few seconds (default 3) and recommends a tier.
 * Call `sample(dt)` every frame; `done`/`report` tell the result. It does not
 * change anything by itself.
 */
export class FpsProbe {
  readonly duration: number;
  readonly #times: number[] = [];
  #elapsed = 0;
  #skip: number;
  #report: FpsReport | null = null;

  constructor(seconds = 3, warmupFrames = 20) {
    this.duration = seconds;
    this.#skip = warmupFrames;
  }

  get done(): boolean {
    return this.#report !== null;
  }

  get report(): FpsReport | null {
    return this.#report;
  }

  /** Progress 0..1. */
  get progress(): number {
    return Math.min(1, this.#elapsed / this.duration);
  }

  sample(realDt: number): FpsReport | null {
    if (this.#report) return this.#report;
    // The first frames after load include shader compiles; ignore them.
    if (this.#skip > 0) {
      this.#skip--;
      return null;
    }
    this.#times.push(realDt * 1000);
    this.#elapsed += realDt;
    if (this.#elapsed < this.duration) return null;
    const sorted = [...this.#times].sort((a, b) => a - b);
    const mean = sorted.reduce((sum, t) => sum + t, 0) / sorted.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? mean;
    const average = 1000 / mean;
    // Below ~55 fps on average, or frequent long frames, the low tier is the better bet.
    const recommendation: QualityTier = average < 55 || p95 > 26 ? 'low' : 'high';
    this.#report = { average, p95, frames: sorted.length, recommendation };
    return this.#report;
  }

  restart(): void {
    this.#times.length = 0;
    this.#elapsed = 0;
    this.#skip = 10;
    this.#report = null;
  }
}
