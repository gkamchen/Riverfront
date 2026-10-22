/** Small deterministic random source, so a match (and every bot) can be replayed from a seed. */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /** Shuffles in place (Fisher–Yates) and returns the same array. */
  shuffle<T>(items: T[]): T[];
  /** Internal position of the stream; equal states produce equal sequences. */
  readonly state: number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  // mulberry32: tiny, fast and good enough for boards and bots.
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('Cannot pick from an empty list');
      return items[int(items.length)] as T;
    },
    shuffle<T>(items: T[]): T[] {
      for (let i = items.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = items[i] as T;
        items[i] = items[j] as T;
        items[j] = tmp;
      }
      return items;
    },
    get state() {
      return state;
    },
  };
}

/** Mixes numbers and strings into one 32-bit seed (FNV-1a followed by a murmur finaliser). */
export function hashSeed(...parts: readonly (number | string)[]): number {
  let h = 0x811c9dc5;
  const feed = (byte: number) => {
    h ^= byte & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (const part of parts) {
    if (typeof part === 'number') {
      const n = part >>> 0;
      feed(n);
      feed(n >>> 8);
      feed(n >>> 16);
      feed(n >>> 24);
    } else {
      for (let i = 0; i < part.length; i++) {
        const code = part.charCodeAt(i);
        feed(code);
        feed(code >>> 8);
      }
    }
    feed(0x2f);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Seed of the "daily challenge": the same for everyone on the same UTC day.
 * Accepts a Date or an ISO day string ("2026-10-19").
 */
export function dailySeed(date: Date | string): number {
  const day = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Invalid day: ${day}`);
  return hashSeed('riverfront-daily', day);
}
