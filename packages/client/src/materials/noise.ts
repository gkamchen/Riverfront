/** Lattice value noise, good enough for procedural canvas textures. */
function latticeHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const a = latticeHash(xi, yi, seed);
  const b = latticeHash(xi + 1, yi, seed);
  const c = latticeHash(xi, yi + 1, seed);
  const d = latticeHash(xi + 1, yi + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Noise on a 3D direction, used to displace rock vertices. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  return (valueNoise(x + z * 1.7, y - z * 0.6, seed) + valueNoise(y * 1.3 - x * 0.4, z + x * 0.9, seed + 5)) * 0.5;
}
