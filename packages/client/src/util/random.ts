/** Cosmetic randomness only (particles, wobble). Game randomness lives in core. */
export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Cheap deterministic hash in [0, 1) for stable per-cell variation. */
export function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
