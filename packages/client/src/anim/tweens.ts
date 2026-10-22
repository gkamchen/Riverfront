import { linear, type Easing } from './easing';

interface Tween {
  elapsed: number;
  readonly delay: number;
  readonly duration: number;
  readonly ease: Easing;
  readonly onUpdate: (value: number) => void;
  readonly resolve: () => void;
}

export interface TweenOptions {
  ease?: Easing;
  delay?: number;
}

/**
 * Minimal tween runner driven by the render loop. Every tween resolves a
 * promise so sequences read top to bottom with async/await.
 */
export class Tweens {
  #active: Tween[] = [];
  #timeScale = 1;

  /** Scales all durations; used to shorten animations for reduced motion. */
  setTimeScale(scale: number): void {
    this.#timeScale = scale;
  }

  run(seconds: number, onUpdate: (value: number) => void, options: TweenOptions = {}): Promise<void> {
    return new Promise((resolve) => {
      this.#active.push({
        elapsed: 0,
        delay: (options.delay ?? 0) * this.#timeScale,
        duration: Math.max(0.0001, seconds * this.#timeScale),
        ease: options.ease ?? linear,
        onUpdate,
        resolve,
      });
    });
  }

  wait(seconds: number): Promise<void> {
    return this.run(seconds, () => undefined);
  }

  update(dt: number): void {
    if (this.#active.length === 0) return;
    const finished: Tween[] = [];

    for (const tween of this.#active) {
      tween.elapsed += dt;
      const local = tween.elapsed - tween.delay;
      if (local < 0) continue;
      const progress = Math.min(1, local / tween.duration);
      tween.onUpdate(tween.ease(progress));
      if (progress >= 1) finished.push(tween);
    }

    if (finished.length > 0) {
      this.#active = this.#active.filter((tween) => !finished.includes(tween));
      for (const tween of finished) tween.resolve();
    }
  }

  /** Snaps every running tween to its end state. */
  finishAll(): void {
    const pending = this.#active;
    this.#active = [];
    for (const tween of pending) {
      tween.onUpdate(tween.ease(1));
      tween.resolve();
    }
  }
}
