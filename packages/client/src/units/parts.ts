import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LatheGeometry,
  Mesh,
  TorusGeometry,
  Vector2,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { place, type Placement } from '../util/geometry';

/** A fixed colour, or a team slot resolved by the unit shader. */
export type Tint = Color | 'main' | 'dark' | 'glow';

const TEAM_SLOT: Record<'main' | 'dark' | 'glow', number> = { main: 1, dark: 2, glow: 3 };
const WHITE = new Color(1, 1, 1);

/** Shared non-team colours of the default skin. */
export const SKIN = {
  metal: new Color('#3b3f45'),
  metalLight: new Color('#868d96'),
  steel: new Color('#5b6168'),
  gold: new Color('#d9ac4c'),
  brass: new Color('#b08a3e'),
  skin: new Color('#e3b48d'),
  wood: new Color('#6b4428'),
  woodDark: new Color('#3a2516'),
  rubber: new Color('#1e1e20'),
  canvas: new Color('#8b8a6a'),
  khaki: new Color('#6f6a45'),
  sand: new Color('#b49a6a'),
  concrete: new Color('#8d8a84'),
  concreteDark: new Color('#5f5c57'),
  glass: new Color('#9fd3e6'),
  lens: new Color('#cfefff'),
  white: new Color('#e9ecef'),
  black: new Color('#141414'),
  copper: new Color('#b5653a'),
  lamp: new Color('#ffd27a'),
};

/**
 * Bakes a tint (fixed colour or team slot) into a primitive so that parts can
 * be merged into a single vertex-coloured mesh.
 */
export function part(source: BufferGeometry, tint: Tint, placement?: Placement): BufferGeometry {
  let geometry = source.index ? source.toNonIndexed() : source;
  if (placement) geometry = place(geometry, placement);
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
  }
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const slots = new Float32Array(count);
  const color = typeof tint === 'string' ? WHITE : tint;
  const slot = typeof tint === 'string' ? TEAM_SLOT[tint] : 0;
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    slots[i] = slot;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('aTeam', new Float32BufferAttribute(slots, 1));
  return geometry;
}

/** Merges painted parts; keeps only the attributes every unit part has. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  for (const geometry of parts) {
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv', 'color', 'aTeam'].includes(name)) geometry.deleteAttribute(name);
    }
    geometry.morphAttributes = {};
  }
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Unit parts could not be merged');
  merged.computeBoundingSphere();
  return merged;
}

export function lathe(profile: ReadonlyArray<readonly [number, number]>, segments = 24): LatheGeometry {
  return new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments,
  );
}

export function ring(radius: number, tube: number, y: number): BufferGeometry {
  return place(new TorusGeometry(radius, tube, 8, 28), { rx: Math.PI / 2, y });
}

export function mesh(geometry: BufferGeometry, material: Material, name = ''): Mesh {
  const m = new Mesh(geometry, material);
  m.castShadow = true;
  m.receiveShadow = true;
  m.name = name;
  return m;
}

/** Builds a geometry once per key; unit parts are shared by every instance. */
const cache = new Map<string, BufferGeometry>();
export function cached(key: string, build: () => BufferGeometry): BufferGeometry {
  let geometry = cache.get(key);
  if (!geometry) {
    geometry = build();
    cache.set(key, geometry);
  }
  return geometry;
}
