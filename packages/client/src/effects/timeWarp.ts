interface SlowMo {
  elapsed: number;
  duration: number;
  scale: number;
}

const EASE_IN = 0.12;
const EASE_OUT = 0.35;

/**
 * Game-time scaling for impact feel: short hit-stops (a few frames almost
 * frozen) and longer slow-motion windows (kill cams). Feed it the real frame
 * delta and use the returned value for animation.
 */
export class TimeWarp {
  #stop = 0;
  #stopScale = 0.03;
  #slow: SlowMo | null = null;
  #scale = 1;
  enabled = true;

  /** Current multiplier (1 = normal speed). */
  get scale(): number {
    return this.#scale;
  }

  /** Near-freeze for `duration` real seconds. Repeated calls extend, never stack. */
  hitstop(duration = 0.06, scale = 0.03): void {
    if (!this.enabled) return;
    this.#stop = Math.max(this.#stop, duration);
    this.#stopScale = scale;
  }

  /** Slow motion for `duration` real seconds at `scale`, eased at both ends. */
  slowMo(duration: number, scale = 0.3): void {
    if (!this.enabled) return;
    this.#slow = { elapsed: 0, duration: Math.max(duration, EASE_IN + EASE_OUT), scale };
  }

  cancel(): void {
    this.#stop = 0;
    this.#slow = null;
    this.#scale = 1;
  }

  /** Advances with the real delta and returns the scaled delta. */
  update(realDt: number): number {
    let scale = 1;
    if (this.#slow) {
      const s = this.#slow;
      s.elapsed += realDt;
      const fadeIn = Math.min(1, s.elapsed / EASE_IN);
      const fadeOut = Math.min(1, (s.duration - s.elapsed) / EASE_OUT);
      const k = Math.max(0, Math.min(fadeIn, fadeOut));
      scale = 1 + (s.scale - 1) * k;
      if (s.elapsed >= s.duration) this.#slow = null;
    }
    if (this.#stop > 0) {
      this.#stop -= realDt;
      scale = Math.min(scale, this.#stopScale);
    }
    this.#scale = scale;
    return realDt * scale;
  }
}
