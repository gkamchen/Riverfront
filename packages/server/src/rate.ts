/** Balde de fichas: `burst` ações de uma vez, repondo `perSecond` por segundo. */
export class TokenBucket {
  #tokens: number;
  #last: number;
  readonly #burst: number;
  readonly #perMs: number;

  constructor(burst: number, perSecond: number, now: number) {
    this.#burst = burst;
    this.#tokens = burst;
    this.#perMs = perSecond / 1000;
    this.#last = now;
  }

  take(now: number, cost = 1): boolean {
    this.#tokens = Math.min(this.#burst, this.#tokens + (now - this.#last) * this.#perMs);
    this.#last = now;
    if (this.#tokens < cost) return false;
    this.#tokens -= cost;
    return true;
  }
}

/** No máximo `limit` eventos dentro de `windowMs`. Guarda só os momentos recentes. */
export class SlidingWindow {
  #times: number[] = [];
  readonly #limit: number;
  readonly #windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  /** Nada dentro da janela (pode ser descartada). */
  empty(now: number): boolean {
    return this.#times.every((t) => now - t >= this.#windowMs);
  }

  allow(now: number): boolean {
    this.#times = this.#times.filter((t) => now - t < this.#windowMs);
    if (this.#times.length >= this.#limit) return false;
    this.#times.push(now);
    return true;
  }
}
