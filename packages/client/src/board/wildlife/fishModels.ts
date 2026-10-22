import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  LatheGeometry,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface FishLook {
  length: number;
  height: number;
  width: number;
  back: string;
  belly: string;
  fin: string;
  /** Dark vertical bars (tucunaré). */
  bars?: string;
  /** Ocellus near the tail (tucunaré). */
  tailSpot?: string;
  /** Rear body blush (pirarucu). */
  rear?: string;
}

function colorize(geometry: BufferGeometry, look: FishLook, fixed?: Color): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  const position = g.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const back = new Color(look.back);
  const belly = new Color(look.belly);
  const bars = look.bars ? new Color(look.bars) : null;
  const spot = look.tailSpot ? new Color(look.tailSpot) : null;
  const rear = look.rear ? new Color(look.rear) : null;
  const c = new Color();
  const half = look.height / 2;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) / look.length;
    const y = position.getY(i);
    if (fixed) c.copy(fixed);
    else {
      const k = Math.min(1, Math.max(0, (y + half * 0.4) / (half * 1.2)));
      c.copy(belly).lerp(back, k * k * (3 - 2 * k));
      if (bars && Math.sin(x * 26) > 0.55 && x > -0.3 && x < 0.3 && y > -half * 0.3) c.lerp(bars, 0.75);
      if (rear && x < -0.12) c.lerp(rear, Math.min(1, (-0.12 - x) * 4) * 0.8);
      if (spot && Math.hypot(x + 0.4, y / look.length) < 0.06) c.copy(spot);
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

function triangle(points: number[], look: FishLook): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  g.computeVertexNormals();
  return colorize(g, look, new Color(look.fin));
}

/** A simple fish: lathe body, tail, dorsal fin and eyes. Head points to +x. */
export function fishGeometry(look: FishLook): BufferGeometry {
  const { length: L, height: H } = look;
  const profile: Vector2[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = (H / 2) * Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * t)), 0.72);
    profile.push(new Vector2(Math.max(0.0005, r), (t - 0.5) * L));
  }
  const body = new LatheGeometry(profile, 10);
  body.rotateZ(-Math.PI / 2);
  body.scale(1, 1, look.width / H);

  const tx = -L / 2;
  const tail = triangle([tx + 0.02 * L, 0, 0, tx - 0.24 * L, 0.2 * L, 0, tx - 0.24 * L, -0.2 * L, 0], look);
  const dorsal = triangle([0.1 * L, H * 0.42, 0, -0.18 * L, H * 0.42, 0, -0.12 * L, H * 0.42 + 0.12 * L, 0], look);
  const eyes: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const eye = new SphereGeometry(Math.max(0.006, H * 0.09), 6, 4);
    eye.translate(L * 0.36, H * 0.08, side * look.width * 0.36);
    eyes.push(colorize(eye, look, new Color('#0b0b0b')));
  }
  const merged = mergeGeometries([colorize(body, look), tail, dorsal, ...eyes]);
  merged.computeBoundingSphere();
  return merged;
}

export function fishMaterial(): MeshStandardMaterial {
  return new MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.35, side: DoubleSide });
}

export const LAMBARI: FishLook = { length: 0.16, height: 0.05, width: 0.022, back: '#5d7a7c', belly: '#e8eef0', fin: '#d4a53b' };
export const TUCUNARE: FishLook = {
  length: 0.5,
  height: 0.15,
  width: 0.07,
  back: '#5f7a2a',
  belly: '#e8cf6a',
  fin: '#c9502b',
  bars: '#1f2a12',
  tailSpot: '#e34b1c',
};
export const CARP: FishLook = { length: 0.55, height: 0.17, width: 0.08, back: '#a8621f', belly: '#f2c86d', fin: '#c97a2c' };
export const PIRARUCU: FishLook = {
  length: 1.35,
  height: 0.24,
  width: 0.13,
  back: '#2c3430',
  belly: '#8c8f84',
  fin: '#4a2a22',
  rear: '#a3291c',
};
