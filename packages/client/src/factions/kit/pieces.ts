import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshBasicMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from 'three';
import { lathe, part, ring, type Tint } from '../../units/parts';
import { place, type Placement } from '../../util/geometry';
import type { BoatStyle, ColumnStyle, HelmetStyle, OrnamentStyle, RoofStyle, ShieldStyle, WeaponStyle } from '../types';
import type { KitStyle } from './style';

export type Parts = BufferGeometry[];

/** Moves already painted parts (in place) and returns them. */
export function moved(parts: Parts, at: Placement): Parts {
  for (const g of parts) place(g, at);
  return parts;
}

// ------------------------------------------------------------------ ornaments

/** A run of small repeated motifs along x, centred on the origin. */
export function ornamentBand(k: KitStyle, style: OrnamentStyle, length: number, tint: Tint = k.color.accent): Parts {
  const parts: Parts = [];
  if (style === 'none') return parts;
  const step = 0.07;
  const count = Math.max(2, Math.floor(length / step));
  for (let i = 0; i < count; i++) {
    const x = -length / 2 + (i + 0.5) * (length / count);
    switch (style) {
      case 'lotus':
        parts.push(part(new ConeGeometry(0.014, 0.04, 5), tint, { x, y: 0.01 }));
        if (i % 2) parts.push(part(new SphereGeometry(0.008, 5, 4), tint, { x, y: -0.018 }));
        break;
      case 'meander':
        parts.push(part(new BoxGeometry(0.03, 0.008, 0.008), tint, { x, y: i % 2 ? 0.012 : -0.012 }));
        parts.push(part(new BoxGeometry(0.008, 0.03, 0.008), tint, { x: x + 0.015 }));
        break;
      case 'laurel':
        parts.push(part(new SphereGeometry(0.012, 5, 4), tint, { x, y: i % 2 ? 0.006 : -0.006, sx: 1.8, sy: 0.6, rz: i % 2 ? 0.5 : -0.5 }));
        break;
      case 'knot':
        parts.push(part(new TorusGeometry(0.014, 0.004, 4, 8), tint, { x }));
        break;
      case 'zigzag':
        parts.push(part(new BoxGeometry(0.04, 0.008, 0.008), tint, { x, rz: i % 2 ? 0.7 : -0.7 }));
        break;
      case 'scroll':
        parts.push(part(new TorusGeometry(0.013, 0.004, 4, 8, Math.PI * 1.5), tint, { x, rz: i * 0.8 }));
        break;
      case 'sun':
        parts.push(part(new CylinderGeometry(0.016, 0.016, 0.006, 8), tint, { x, rx: Math.PI / 2 }));
        break;
      case 'cloud':
        parts.push(part(new SphereGeometry(0.012, 5, 4), tint, { x, y: i % 2 ? 0.005 : 0 }));
        break;
    }
  }
  return parts;
}

// ------------------------------------------------------------------ architecture

/** A column from the ground (y = 0) up to `height`, capital included. */
export function column(k: KitStyle, style: ColumnStyle, height: number, radius = 0.05): Parts {
  const stone = k.color.stone;
  const capital = k.color.accent;
  const parts: Parts = [];
  if (style === 'none') return parts;
  switch (style) {
    case 'papyrus':
      parts.push(part(new CylinderGeometry(radius * 0.85, radius * 1.15, height * 0.82, 10), stone, { y: height * 0.41 }));
      parts.push(part(ring(radius * 0.9, 0.006, height * 0.7), capital));
      parts.push(part(lathe([[radius * 0.85, 0], [radius * 1.7, height * 0.12], [radius * 1.5, height * 0.16], [0, height * 0.16]], 10), stone, { y: height * 0.82 }));
      parts.push(part(new BoxGeometry(radius * 2.2, height * 0.03, radius * 2.2), capital, { y: height * 0.985 }));
      break;
    case 'doric':
      parts.push(part(new CylinderGeometry(radius * 0.88, radius, height * 0.86, 12), stone, { y: height * 0.43 }));
      parts.push(part(new CylinderGeometry(radius * 1.25, radius * 0.88, height * 0.06, 12), stone, { y: height * 0.89 }));
      parts.push(part(new BoxGeometry(radius * 2.7, height * 0.05, radius * 2.7), stone, { y: height * 0.945 }));
      break;
    case 'ionic':
      parts.push(part(new CylinderGeometry(radius, radius * 1.1, height * 0.04, 12), stone, { y: height * 0.02 }));
      parts.push(part(new CylinderGeometry(radius * 0.85, radius * 0.95, height * 0.86, 12), stone, { y: height * 0.47 }));
      for (const side of [-1, 1]) parts.push(part(new TorusGeometry(radius * 0.45, radius * 0.18, 5, 10), capital, { x: side * radius * 1.2, y: height * 0.92, }));
      parts.push(part(new BoxGeometry(radius * 2.8, height * 0.04, radius * 1.6), stone, { y: height * 0.98 }));
      break;
    case 'corinthian':
      parts.push(part(new CylinderGeometry(radius * 0.85, radius * 0.95, height * 0.82, 12), stone, { y: height * 0.43 }));
      parts.push(part(new ConeGeometry(radius * 1.5, height * 0.14, 10, 1, true), capital, { y: height * 0.9, rx: Math.PI }));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push(part(new SphereGeometry(radius * 0.35, 5, 4), capital, { x: Math.cos(a) * radius, y: height * 0.88, z: Math.sin(a) * radius }));
      }
      parts.push(part(new BoxGeometry(radius * 2.8, height * 0.04, radius * 2.8), stone, { y: height * 0.98 }));
      break;
    case 'square':
      parts.push(part(new BoxGeometry(radius * 1.8, height * 0.92, radius * 1.8), stone, { y: height * 0.46 }));
      parts.push(part(new BoxGeometry(radius * 2.4, height * 0.08, radius * 2.4), capital, { y: height * 0.96 }));
      break;
    case 'wooden':
      parts.push(part(new CylinderGeometry(radius * 0.8, radius * 0.8, height * 0.9, 8), k.color.wood, { y: height * 0.45 }));
      parts.push(part(new BoxGeometry(radius * 3, height * 0.06, radius * 1.2), k.color.woodDark, { y: height * 0.93 }));
      parts.push(part(new BoxGeometry(radius * 1.8, height * 0.04, radius * 1.8), capital, { y: height * 0.02 }));
      break;
  }
  return parts;
}

/**
 * Four-sided cone with a w x d base aligned to the axes. It is turned before it
 * is stretched; stretching first skewed wide roofs into diamonds.
 */
function squareCone(w: number, d: number, height: number, open: boolean): ConeGeometry {
  const g = new ConeGeometry(Math.SQRT1_2, height, 4, 1, open);
  g.rotateY(Math.PI / 4);
  g.scale(w, 1, d);
  return g;
}

/** A roof over a w x d footprint whose eaves sit at y = 0. */
export function roof(k: KitStyle, style: RoofStyle, w: number, d: number, tint: Tint = k.tint.roof): Parts {
  const parts: Parts = [];
  const trim = k.color.accent;
  switch (style) {
    case 'flat':
      parts.push(part(new BoxGeometry(w + 0.06, 0.05, d + 0.06), k.color.stone, { y: 0.025 }));
      // Cavetto-like cornice in the trim colour.
      parts.push(part(new BoxGeometry(w + 0.1, 0.025, d + 0.1), tint, { y: 0.06 }));
      break;
    case 'gable': {
      const gable = new Shape();
      gable.moveTo(-d / 2 - 0.05, 0);
      gable.lineTo(d / 2 + 0.05, 0);
      gable.lineTo(0, Math.min(0.32, d * 0.4));
      gable.closePath();
      const geometry = new ExtrudeGeometry(gable, { depth: w + 0.08, bevelEnabled: false });
      geometry.translate(0, 0, -(w + 0.08) / 2);
      geometry.rotateY(Math.PI / 2);
      parts.push(part(geometry, tint));
      parts.push(part(new BoxGeometry(w + 0.1, 0.025, d + 0.1), trim, { y: 0.0125 }));
      break;
    }
    case 'pyramid':
      parts.push(part(squareCone(w * 1.12, d * 1.12, Math.max(w, d) * 0.5, false), tint, { y: Math.max(w, d) * 0.25 }));
      break;
    case 'dome':
      parts.push(part(new SphereGeometry(Math.min(w, d) * 0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tint, { sx: w / Math.min(w, d), sz: d / Math.min(w, d) }));
      parts.push(part(new SphereGeometry(0.03, 8, 6), trim, { y: Math.min(w, d) * 0.5 }));
      break;
    case 'stepped':
      for (let i = 0; i < 3; i++) parts.push(part(new BoxGeometry(w * (1 - i * 0.25), 0.06, d * (1 - i * 0.25)), i === 2 ? tint : k.color.stone, { y: 0.03 + i * 0.06 }));
      break;
    case 'pagoda':
      for (let i = 0; i < 2; i++) {
        const s = 1 - i * 0.35;
        parts.push(part(squareCone(w * 1.1 * s, d * 1.1 * s, 0.14, true), tint, { y: 0.07 + i * 0.2 }));
        parts.push(part(new BoxGeometry(w * 0.6 * s, 0.12, d * 0.6 * s), k.color.wood, { y: 0.12 + i * 0.2 }));
      }
      parts.push(part(new ConeGeometry(0.03, 0.12, 6), trim, { y: 0.48 }));
      break;
    case 'tent':
      parts.push(part(new ConeGeometry(Math.max(w, d) * 0.62, Math.max(w, d) * 0.45, 8), tint, { y: Math.max(w, d) * 0.225, sx: w / Math.max(w, d), sz: d / Math.max(w, d) }));
      break;
    case 'conical':
      parts.push(part(new ConeGeometry(Math.max(w, d) * 0.6, Math.max(w, d) * 0.6, 12), tint, { y: Math.max(w, d) * 0.3, sx: w / Math.max(w, d), sz: d / Math.max(w, d) }));
      break;
  }
  return parts;
}

// ------------------------------------------------------------------ figures

/** Head centre height and radius of a standing figure (scaled by its height). */
export const HEAD_Y = 0.575;
export const HEAD_R = 0.1;
/** Headgear is authored for a 0.085 head; this fits it to HEAD_R. */
export const HEAD_SCALE = HEAD_R / 0.085;

/** Soldiers carry team colour on the tunic; archers wear a hood and a team sash; officers a cape and a gilded sash. */
export type FigureRole = 'soldier' | 'archer' | 'officer';

const EYE = new Color('#16110d');

/** Figure torso and head, standing on y = 0; head centre at HEAD_Y * height. */
export function figureBody(k: KitStyle, height = 1, role: FigureRole = 'soldier'): Parts {
  const h = height;
  const headY = HEAD_Y * h;
  const parts: Parts = [
    part(lathe([[0, 0], [0.15, 0], [0.16, 0.12 * h], [0.13, 0.22 * h], [0.15, 0.32 * h], [0.11, 0.42 * h], [0.07, 0.46 * h], [0, 0.47 * h]], 14), k.tint.cloth),
    part(ring(0.145, 0.014, 0.22 * h), k.color.wood),
    part(new SphereGeometry(0.055, 10, 8), k.tint.cloth, { x: -0.11, y: 0.41 * h }),
    part(new SphereGeometry(0.055, 10, 8), k.tint.cloth, { x: 0.11, y: 0.41 * h }),
    part(new CapsuleGeometry(0.032, 0.13, 3, 6), k.color.skin, { x: -0.15, y: 0.3 * h, rz: 0.25 }),
    part(new CapsuleGeometry(0.032, 0.13, 3, 6), k.color.skin, { x: 0.15, y: 0.3 * h, rz: -0.25 }),
    part(new CylinderGeometry(0.04, 0.05, 0.06, 8), k.color.skin, { y: 0.48 * h }),
    part(new SphereGeometry(HEAD_R, 16, 12), k.color.skin, { y: headY }),
    // A face that still reads from the playing distance: dark eyes and a nose.
    part(new SphereGeometry(0.016, 6, 5), EYE, { x: -0.036, y: headY + 0.012, z: -0.088 }),
    part(new SphereGeometry(0.016, 6, 5), EYE, { x: 0.036, y: headY + 0.012, z: -0.088 }),
    part(new ConeGeometry(0.016, 0.04, 5), k.color.skin.clone().multiplyScalar(0.85), { y: headY - 0.015, z: -0.1, rx: -Math.PI / 2 }),
  ];
  if (role === 'archer') {
    // Hooded mantle in the faction colour, a team sash and a quiver on the back.
    parts.push(part(new SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), k.color.secondary, { y: 0.4 * h, sy: 0.7 }));
    parts.push(part(new BoxGeometry(0.06, 0.36, 0.02), k.tint.trim, { y: 0.29 * h, z: -0.13, rz: 0.7 }));
    parts.push(part(new CylinderGeometry(0.035, 0.03, 0.3, 8), k.color.woodDark, { x: 0.06, y: 0.38 * h, z: 0.12, rz: -0.35 }));
    for (const dx of [-0.015, 0.015]) parts.push(part(new BoxGeometry(0.012, 0.05, 0.03), k.tint.trim, { x: 0.11 + dx, y: 0.52 * h, z: 0.12 }));
  } else if (role === 'officer') {
    // Cape in the dark team tone and a gilded sash: the commander of a crew.
    parts.push(part(new CylinderGeometry(0.17, 0.22, 0.4 * h, 12, 1, true, Math.PI * 0.6, Math.PI * 0.8), 'dark', { y: 0.24 * h, ry: Math.PI }));
    parts.push(part(new BoxGeometry(0.07, 0.38, 0.02), k.color.accent, { y: 0.29 * h, z: -0.135, rz: -0.7 }));
    parts.push(part(new SphereGeometry(0.03, 8, 6), k.color.accent, { x: -0.1, y: 0.44 * h, z: -0.06 }));
  }
  return parts;
}

/** Headgear already moved onto a figure's head (for merged crew meshes). */
export function headOn(k: KitStyle, style: HelmetStyle, height = 1): Parts {
  const s = HEAD_SCALE * height;
  return moved(headgear(k, style), { y: HEAD_Y * height, sx: s, sy: s, sz: s });
}

/** A whole small figure (body, headgear, weapon) as one part list, scaled. */
export function figure(k: KitStyle, scale: number, role: FigureRole = 'soldier', helmet: HelmetStyle = k.params.helmet, arms: WeaponStyle | null = k.params.weapon): Parts {
  return moved([...figureBody(k, 1, role), ...headOn(k, helmet), ...(arms ? weapon(k, arms) : [])], { sx: scale, sy: scale, sz: scale });
}

/** Headgear centred on the head (head radius 0.085), for a separate mesh. */
export function headgear(k: KitStyle, style: HelmetStyle): Parts {
  const metal = k.color.metal;
  const trim = k.tint.trim;
  // Headgear keeps the faction's own cloth so the head reads apart from the team-coloured tunic.
  const cloth = k.color.cloth;
  const dome = (r: number, tint: Tint, at?: Placement) => part(new SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), tint, at);
  switch (style) {
    case 'crested':
      return [
        dome(0.095, metal),
        part(new CylinderGeometry(0.1, 0.1, 0.012, 16), metal),
        part(new BoxGeometry(0.025, 0.07, 0.17), trim, { y: 0.11 }),
        part(new BoxGeometry(0.02, 0.06, 0.03), metal, { x: -0.07, y: -0.04, z: -0.05 }),
        part(new BoxGeometry(0.02, 0.06, 0.03), metal, { x: 0.07, y: -0.04, z: -0.05 }),
      ];
    case 'corinthian':
      return [
        dome(0.097, metal),
        part(new CylinderGeometry(0.097, 0.09, 0.09, 14, 1, true, Math.PI * 0.15, Math.PI * 1.7), metal, { y: -0.045, ry: Math.PI / 2 }),
        part(new BoxGeometry(0.012, 0.07, 0.008), metal, { y: -0.04, z: -0.095 }),
        part(new BoxGeometry(0.03, 0.05, 0.22), trim, { y: 0.12 }),
        part(new BoxGeometry(0.03, 0.03, 0.18), trim, { y: 0.085, z: 0.04 }),
      ];
    case 'khat':
      return [
        dome(0.092, cloth),
        ...[0.03, 0.055].map((y) => part(ring(0.088 - y * 0.25, 0.006, y), k.color.primary)),
        part(new BoxGeometry(0.2, 0.014, 0.014), k.color.accent, { y: 0.01, z: -0.085 }),
        part(new BoxGeometry(0.03, 0.13, 0.08), cloth, { x: -0.085, y: -0.06, z: 0.02, rz: 0.12 }),
        part(new BoxGeometry(0.03, 0.13, 0.08), cloth, { x: 0.085, y: -0.06, z: 0.02, rz: -0.12 }),
        part(new BoxGeometry(0.12, 0.08, 0.04), cloth, { y: -0.03, z: 0.08 }),
      ];
    case 'conical':
      // Dome with a tall point, so it reads above the skull from far away.
      return [dome(0.098, metal), part(new ConeGeometry(0.075, 0.14, 12), metal, { y: 0.11 }), part(new CylinderGeometry(0.101, 0.101, 0.016, 14), trim)];
    case 'nasal':
      return [
        dome(0.099, metal),
        part(new ConeGeometry(0.06, 0.08, 10), metal, { y: 0.1 }),
        part(new BoxGeometry(0.018, 0.085, 0.014), metal, { y: -0.035, z: -0.1 }),
        part(ring(0.1, 0.009, 0.005), trim),
      ];
    case 'kabuto':
      return [
        dome(0.095, metal),
        part(new ConeGeometry(0.16, 0.06, 12, 1, true), cloth, { y: -0.01 }),
        part(new BoxGeometry(0.012, 0.08, 0.06), k.color.accent, { x: -0.03, y: 0.1, z: -0.07, rz: 0.4 }),
        part(new BoxGeometry(0.012, 0.08, 0.06), k.color.accent, { x: 0.03, y: 0.1, z: -0.07, rz: -0.4 }),
      ];
    case 'turban':
      return [
        part(new TorusGeometry(0.075, 0.035, 6, 14), cloth, { rx: Math.PI / 2, y: 0.02 }),
        part(new TorusGeometry(0.06, 0.03, 6, 14), cloth, { rx: Math.PI / 2, y: 0.06 }),
        dome(0.06, cloth, { y: 0.06 }),
        part(new SphereGeometry(0.015, 6, 4), k.color.accent, { y: 0.05, z: -0.09 }),
      ];
    case 'feather':
      return [
        part(new CylinderGeometry(0.092, 0.092, 0.03, 14), trim),
        ...[-0.5, -0.2, 0.1, 0.4].map((a) => part(new ConeGeometry(0.015, 0.16, 5), k.color.accent, { x: Math.sin(a) * 0.08, y: 0.09, z: 0.04, rz: -a })),
      ];
    case 'cap':
      return [dome(0.093, cloth), part(new CylinderGeometry(0.098, 0.098, 0.02, 14), trim)];
    case 'wrapped':
      return [dome(0.094, cloth), part(new CapsuleGeometry(0.02, 0.1, 3, 6), cloth, { y: -0.04, z: 0.1, rx: 0.5 })];
    case 'bork':
      // Janissary felt hat: tall, folding back down over the neck, a spoon-holder at the brow.
      return [
        part(new CylinderGeometry(0.075, 0.095, 0.14, 12), k.color.cloth, { y: 0.07 }),
        part(new BoxGeometry(0.1, 0.26, 0.04), k.color.cloth, { y: 0.02, z: 0.1, rx: 0.35 }),
        part(new BoxGeometry(0.03, 0.06, 0.02), k.color.accent, { y: 0.06, z: -0.095 }),
        part(ring(0.096, 0.01, 0.005), trim),
      ];
    case 'eagleHelm':
      // Eagle-warrior headdress: the open beak frames the face, feathers behind.
      return [
        dome(0.098, k.color.secondary),
        part(new ConeGeometry(0.05, 0.12, 6), k.color.accent, { y: 0.06, z: -0.11, rx: -Math.PI / 2 - 0.4 }),
        part(new SphereGeometry(0.016, 6, 4), k.color.dark, { x: -0.05, y: 0.07, z: -0.07 }),
        part(new SphereGeometry(0.016, 6, 4), k.color.dark, { x: 0.05, y: 0.07, z: -0.07 }),
        ...[-0.4, -0.15, 0.15, 0.4].map((a) => part(new ConeGeometry(0.018, 0.16, 5), trim, { x: Math.sin(a) * 0.08, y: 0.12, z: 0.06, rx: 0.5, rz: -a })),
      ];
    case 'jaguarHelm':
      // Jaguar-warrior headdress: spotted pelt with the muzzle over the brow.
      return [
        dome(0.1, k.color.secondary),
        part(new BoxGeometry(0.1, 0.04, 0.06), k.color.secondary, { y: 0.04, z: -0.1 }),
        ...[[-0.05, 0.07], [0.04, 0.08], [0, 0.05], [-0.06, 0.03], [0.06, 0.03]].map(([x, y]) => part(new SphereGeometry(0.014, 5, 4), k.color.dark, { x, y, z: -0.075 })),
        part(new ConeGeometry(0.018, 0.04, 4), k.color.secondary, { x: -0.06, y: 0.1, z: -0.02 }),
        part(new ConeGeometry(0.018, 0.04, 4), k.color.secondary, { x: 0.06, y: 0.1, z: -0.02 }),
        part(new ConeGeometry(0.016, 0.12, 5), trim, { y: 0.14, z: 0.05, rx: 0.4 }),
      ];
    case 'phrygian':
      // Macedonian helmet: the crown sweeps forward in a curl, with cheek pieces.
      return [
        dome(0.098, metal),
        part(new ConeGeometry(0.06, 0.14, 10), metal, { y: 0.1, z: -0.03, rx: -0.7 }),
        part(new SphereGeometry(0.03, 8, 6), metal, { y: 0.12, z: -0.11 }),
        part(new BoxGeometry(0.02, 0.07, 0.05), metal, { x: -0.08, y: -0.04, z: -0.05 }),
        part(new BoxGeometry(0.02, 0.07, 0.05), metal, { x: 0.08, y: -0.04, z: -0.05 }),
        part(ring(0.1, 0.009, 0.0), trim),
      ];
    case 'keffiyeh':
      // Head cloth falling to the shoulders, held by a dark cord ring.
      return [
        dome(0.097, cloth),
        part(new CylinderGeometry(0.1, 0.13, 0.16, 12, 1, true, Math.PI * 0.25, Math.PI * 1.5), cloth, { y: -0.07, ry: Math.PI / 2 }),
        part(new TorusGeometry(0.093, 0.012, 5, 14), k.color.dark, { rx: Math.PI / 2, y: 0.03 }),
        part(new TorusGeometry(0.093, 0.008, 5, 14), trim, { rx: Math.PI / 2, y: 0.05 }),
      ];
    case 'kidaris':
      // Tall rounded felt cap with a ribbon tied round it.
      return [
        part(new CylinderGeometry(0.075, 0.095, 0.16, 12), k.color.primary, { y: 0.08 }),
        part(new SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), k.color.primary, { y: 0.16 }),
        part(new SphereGeometry(0.022, 6, 5), k.color.accent, { y: 0.1, z: -0.085 }),
        part(new TorusGeometry(0.093, 0.012, 5, 14), trim, { rx: Math.PI / 2, y: 0.02 }),
        part(new BoxGeometry(0.02, 0.12, 0.01), trim, { y: -0.03, z: 0.095 }),
      ];
    case 'furHat':
      // Steppe hat: pointed crown with a wide fur brim.
      return [
        part(new ConeGeometry(0.085, 0.16, 10), cloth, { y: 0.08 }),
        part(new TorusGeometry(0.095, 0.03, 6, 14), k.color.woodDark, { rx: Math.PI / 2, y: 0.01 }),
        part(new SphereGeometry(0.018, 6, 4), trim, { y: 0.17 }),
      ];
    case 'none':
      return [part(new SphereGeometry(0.087, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), k.color.dark)];
  }
}

/** Shield held on the figure's left (−x), facing −z. */
export function shield(k: KitStyle, style: ShieldStyle): Parts {
  const face = k.tint.shield;
  const rim = k.color.metal;
  const boss = k.color.accent;
  const at = { x: -0.17, y: 0.28, z: -0.06 };
  const facing = { rx: Math.PI / 2 };
  switch (style) {
    case 'round':
      return moved([part(new CylinderGeometry(0.13, 0.13, 0.025, 16), face, facing), part(new TorusGeometry(0.13, 0.01, 4, 16), rim), part(new SphereGeometry(0.03, 8, 6), boss, { z: -0.015 })], at);
    case 'hoplon':
      return moved([part(new CylinderGeometry(0.17, 0.16, 0.035, 18), face, facing), part(new TorusGeometry(0.168, 0.016, 5, 18), boss), part(new CylinderGeometry(0.05, 0.05, 0.01, 10), boss, { ...facing, z: -0.02 })], { ...at, x: -0.19 });
    case 'scutum': {
      const curved = new CylinderGeometry(0.22, 0.22, 0.4, 12, 1, true, -0.55, 1.1);
      return moved([part(curved, face, { z: 0.2, ry: Math.PI }), part(new BoxGeometry(0.03, 0.36, 0.012), boss, { z: -0.022 }), part(new SphereGeometry(0.035, 8, 6), rim, { z: -0.025 })], { ...at, x: -0.19 });
    }
    case 'lambda':
      // A Spartan hoplon: the bronze rim and the painted lambda.
      return moved([
        part(new CylinderGeometry(0.17, 0.16, 0.035, 18), face, facing),
        part(new TorusGeometry(0.168, 0.016, 5, 18), boss),
        part(new BoxGeometry(0.03, 0.22, 0.01), k.color.cloth, { x: -0.04, z: -0.02, rz: -0.35 }),
        part(new BoxGeometry(0.03, 0.22, 0.01), k.color.cloth, { x: 0.04, z: -0.02, rz: 0.35 }),
      ], { ...at, x: -0.19 });
    case 'oval':
      return moved([part(new CylinderGeometry(0.11, 0.11, 0.025, 14), face, { ...facing, sx: 1, sz: 1.5 }), part(new BoxGeometry(0.02, 0.3, 0.01), boss, { z: -0.014 })], at);
    case 'kite': {
      const s = new Shape();
      s.moveTo(-0.11, 0.12);
      s.quadraticCurveTo(0, 0.18, 0.11, 0.12);
      s.lineTo(0, -0.2);
      s.closePath();
      const g = new ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
      return moved([part(g, face, { z: -0.01 }), part(new SphereGeometry(0.025, 8, 6), boss, { y: 0.05, z: -0.015 })], at);
    }
    case 'rectangular':
      return moved([part(new BoxGeometry(0.2, 0.3, 0.025), face), part(new BoxGeometry(0.21, 0.02, 0.03), rim, { y: 0.14 }), part(new BoxGeometry(0.21, 0.02, 0.03), rim, { y: -0.14 })], at);
    case 'none':
      return [];
  }
}

/** Weapon held upright in the right hand (+x). */
export function weapon(k: KitStyle, style: WeaponStyle): Parts {
  const shaft = k.color.wood;
  const blade = k.color.metal;
  const at = { x: 0.17, y: 0.0, z: -0.04 };
  switch (style) {
    case 'spear':
      return moved([part(new CylinderGeometry(0.013, 0.015, 0.86, 6), shaft, { y: 0.43 }), part(new ConeGeometry(0.032, 0.13, 6), blade, { y: 0.92 }), part(new CylinderGeometry(0.02, 0.02, 0.03, 6), k.color.accent, { y: 0.85 })], at);
    case 'sarissa':
      // The Macedonian pike: twice a man's height.
      return moved([part(new CylinderGeometry(0.011, 0.013, 1.5, 6), shaft, { y: 0.75 }), part(new ConeGeometry(0.028, 0.12, 6), blade, { y: 1.55 }), part(new ConeGeometry(0.02, 0.06, 6), blade, { y: -0.02, rx: Math.PI })], at);
    case 'naginata':
      return moved([part(new CylinderGeometry(0.009, 0.011, 0.7, 6), shaft, { y: 0.35 }), part(new BoxGeometry(0.012, 0.16, 0.035), blade, { y: 0.78, rz: 0.12 })], at);
    case 'sword':
      return moved([part(new BoxGeometry(0.022, 0.27, 0.055), blade, { y: 0.41 }), part(new ConeGeometry(0.028, 0.05, 4), blade, { y: 0.565, ry: Math.PI / 4, sz: 0.4 }), part(new BoxGeometry(0.026, 0.022, 0.11), k.color.accent, { y: 0.27 }), part(new CylinderGeometry(0.014, 0.014, 0.07, 6), shaft, { y: 0.23 })], at);
    case 'scimitar':
      return moved([part(new TorusGeometry(0.16, 0.012, 4, 10, 0.9), blade, { x: -0.16, y: 0.3, rz: -0.2 }), part(new CylinderGeometry(0.012, 0.012, 0.07, 6), shaft, { y: 0.24 })], at);
    case 'khopesh':
      return moved([part(new BoxGeometry(0.016, 0.14, 0.03), blade, { y: 0.32 }), part(new TorusGeometry(0.06, 0.013, 4, 10, Math.PI * 0.9), blade, { x: 0.05, y: 0.39, rz: Math.PI * 0.25 }), part(new CylinderGeometry(0.012, 0.012, 0.07, 6), k.color.accent, { y: 0.22 })], at);
    case 'axe':
      return moved([part(new CylinderGeometry(0.012, 0.014, 0.56, 6), shaft, { y: 0.34 }), part(new CylinderGeometry(0.07, 0.07, 0.016, 10, 1, false, Math.PI * 0.6, Math.PI * 0.8), blade, { y: 0.56, z: -0.035, rx: Math.PI / 2 })], at);
    case 'club':
      return moved([part(new CylinderGeometry(0.03, 0.012, 0.36, 7), shaft, { y: 0.32 }), part(new SphereGeometry(0.035, 7, 5), shaft, { y: 0.5 })], at);
    case 'mace':
      return moved([part(new CylinderGeometry(0.01, 0.01, 0.34, 6), shaft, { y: 0.3 }), part(new SphereGeometry(0.04, 8, 6), blade, { y: 0.48 })], at);
  }
}

// ------------------------------------------------------------------ animals and wheels

/** Thin tapered cylinder between two points (limbs, necks). */
export function limb(from: Vector3, to: Vector3, r0: number, r1: number, tint: Tint, segments = 7): BufferGeometry {
  const dir = to.clone().sub(from);
  const g = new CylinderGeometry(r1, r0, dir.length(), segments);
  g.applyMatrix4(new Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()), new Vector3(1, 1, 1)));
  return part(g, tint);
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/**
 * Horse facing −x, hooves on y = 0, about 0.6 long. Body, legs and tail are
 * one list; the head is separate so it can nod from the top of the neck.
 */
export function horse(coat: Color, mane: Color): { body: Parts; head: Parts; headPivot: [number, number, number] } {
  const hoof = mane.clone().multiplyScalar(0.5);
  const body: Parts = [
    part(new SphereGeometry(0.1, 14, 10), coat, { y: 0.34, sx: 2.0, sy: 0.95, sz: 0.85 }),
    part(new SphereGeometry(0.09, 12, 8), coat, { x: -0.15, y: 0.35, sx: 1.1, sz: 0.9 }),
    part(new SphereGeometry(0.095, 12, 8), coat, { x: 0.15, y: 0.355, sz: 0.95 }),
    limb(v(-0.17, 0.37, 0), v(-0.27, 0.53, 0), 0.07, 0.045, coat),
    // Mane along the crest of the neck.
    limb(v(-0.15, 0.43, 0), v(-0.25, 0.58, 0), 0.02, 0.016, mane, 5),
    // Tail: set high, falling in a curve.
    limb(v(0.24, 0.39, 0), v(0.3, 0.28, 0), 0.028, 0.022, mane, 5),
    limb(v(0.3, 0.28, 0), v(0.31, 0.14, 0), 0.022, 0.012, mane, 5),
  ];
  for (const [x, z, back] of [[-0.15, -0.06, false], [-0.15, 0.06, false], [0.15, -0.06, true], [0.15, 0.06, true]] as const) {
    const knee = back ? v(x + 0.03, 0.17, z) : v(x - 0.005, 0.17, z);
    body.push(limb(v(x, 0.3, z), knee, back ? 0.04 : 0.032, 0.022, coat));
    body.push(limb(knee, v(x, 0.035, z), 0.018, 0.016, coat, 6));
    body.push(part(new CylinderGeometry(0.022, 0.026, 0.035, 8), hoof, { x, y: 0.0175, z }));
  }
  const head: Parts = [
    limb(v(0, 0, 0), v(-0.13, -0.07, 0), 0.045, 0.034, coat, 8),
    part(new SphereGeometry(0.036, 10, 8), coat.clone().multiplyScalar(0.9), { x: -0.14, y: -0.075 }),
    part(new SphereGeometry(0.009, 5, 4), hoof, { x: -0.04, y: 0.015, z: 0.032 }),
    part(new SphereGeometry(0.009, 5, 4), hoof, { x: -0.04, y: 0.015, z: -0.032 }),
    part(new ConeGeometry(0.012, 0.045, 5), coat, { x: 0.01, y: 0.045, z: 0.02, rz: 0.2 }),
    part(new ConeGeometry(0.012, 0.045, 5), coat, { x: 0.01, y: 0.045, z: -0.02, rz: 0.2 }),
    part(new BoxGeometry(0.06, 0.03, 0.012), mane, { x: 0.0, y: 0.03 }),
  ];
  return { body, head, headPivot: [-0.27, 0.53, 0] };
}

/** Elephant facing −x, feet on y = 0. */
export function elephant(skin: Color, tusk: Color): Parts {
  const parts: Parts = [part(new SphereGeometry(0.2, 14, 10), skin, { y: 0.38, sx: 1.4, sy: 1, sz: 1 })];
  for (const [x, z] of [[-0.16, -0.1], [-0.16, 0.1], [0.16, -0.1], [0.16, 0.1]] as const) parts.push(part(new CylinderGeometry(0.055, 0.06, 0.28, 8), skin, { x, y: 0.14, z }));
  parts.push(part(new SphereGeometry(0.13, 12, 8), skin, { x: -0.3, y: 0.46 }));
  for (let i = 0; i < 3; i++) parts.push(part(new CylinderGeometry(0.03 - i * 0.006, 0.035 - i * 0.006, 0.12, 6), skin, { x: -0.42 - i * 0.02, y: 0.36 - i * 0.1, rz: -0.15 * i }));
  for (const side of [-1, 1]) {
    parts.push(part(new CylinderGeometry(0.11, 0.11, 0.015, 10), skin, { x: -0.24, y: 0.46, z: side * 0.12, rx: Math.PI / 2, sz: 1.3 }));
    parts.push(part(new ConeGeometry(0.014, 0.14, 6), tusk, { x: -0.42, y: 0.36, z: side * 0.06, rz: Math.PI / 2 + 0.6 }));
  }
  return parts;
}

/** Camel facing −x. */
export function camel(coat: Color): Parts {
  const parts: Parts = [
    part(new CapsuleGeometry(0.07, 0.22, 4, 10), coat, { y: 0.36, rz: Math.PI / 2 }),
    part(new SphereGeometry(0.07, 10, 8), coat, { y: 0.45, sy: 0.9 }),
    part(new CapsuleGeometry(0.03, 0.2, 3, 6), coat, { x: -0.2, y: 0.47, rz: -0.6 }),
    part(new BoxGeometry(0.12, 0.05, 0.05), coat, { x: -0.3, y: 0.56 }),
  ];
  for (const [x, z] of [[-0.11, -0.05], [-0.11, 0.05], [0.12, -0.05], [0.12, 0.05]] as const) parts.push(part(new CylinderGeometry(0.014, 0.012, 0.32, 6), coat, { x, y: 0.16, z }));
  return parts;
}

/** Spoked wheel in the xy plane (axle along z). */
export function wheel(k: KitStyle, radius: number, spokes = 6, rim: Tint = k.color.wood): Parts {
  const parts: Parts = [part(new TorusGeometry(radius, radius * 0.11, 6, 20), rim), part(new CylinderGeometry(radius * 0.2, radius * 0.2, radius * 0.5, 8), k.color.metal, { rx: Math.PI / 2 })];
  for (let i = 0; i < spokes; i++) parts.push(part(new BoxGeometry(radius * 0.08, radius * 1.9, radius * 0.08), k.color.woodDark, { rz: (i / spokes) * Math.PI }));
  return parts;
}

// ------------------------------------------------------------------ boats

/** Hull along x (bow at −x), waterline y = 0, about 1.6 long. */
export function hull(k: KitStyle, style: BoatStyle): Parts {
  const paint = k.tint.shield;
  const wood = k.color.wood;
  const parts: Parts = [];
  const body = (len: number, beam: number, depth: number, tint: Tint) =>
    part(new SphereGeometry(0.5, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), tint, { sx: len, sy: depth * 2, sz: beam, y: 0.06 });
  switch (style) {
    case 'reed': {
      // Bundled papyrus hull with both ends curling up.
      parts.push(body(1.4, 0.36, 0.09, k.color.secondary));
      for (const side of [-1, 1]) {
        parts.push(part(new TorusGeometry(0.16, 0.035, 6, 10, Math.PI * 0.55), k.color.secondary, { x: side * 0.62, y: 0.16, rz: side > 0 ? 0 : Math.PI - Math.PI * 0.55 }));
        parts.push(part(new ConeGeometry(0.04, 0.08, 6), k.color.accent, { x: side * 0.72, y: 0.34, rz: side * 0.6 }));
      }
      for (let i = -3; i <= 3; i++) parts.push(part(ring(0.0001, 0.006, 0), k.color.rope, { x: i * 0.16, y: 0.09, sx: 1, sz: 1 }));
      break;
    }
    case 'longship':
      parts.push(body(1.5, 0.38, 0.1, wood));
      for (const side of [-1, 1]) parts.push(part(new TorusGeometry(0.18, 0.03, 6, 10, Math.PI * 0.6), wood, { x: side * 0.66, y: 0.18, rz: side > 0 ? 0 : Math.PI * 0.4 }));
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) parts.push(part(new CylinderGeometry(0.05, 0.05, 0.012, 10), paint, { x: -0.45 + i * 0.18, y: 0.1, z: s * 0.16, rx: Math.PI / 2 }));
      break;
    case 'trireme':
      parts.push(body(1.55, 0.32, 0.1, paint));
      parts.push(part(new CylinderGeometry(0, 0.04, 0.18, 6), k.color.metal, { x: -0.84, y: 0.03, rz: Math.PI / 2 }));
      parts.push(part(new TorusGeometry(0.12, 0.02, 6, 10, Math.PI * 0.9), paint, { x: 0.72, y: 0.16, rz: 0.4 }));
      for (const s of [-1, 1]) parts.push(part(new SphereGeometry(0.022, 8, 6), new Color('#f1ece0'), { x: -0.66, y: 0.1, z: s * 0.1, sz: 0.4 }));
      break;
    case 'junk':
      parts.push(part(new BoxGeometry(1.3, 0.12, 0.38), wood, { y: 0.05 }));
      parts.push(part(new BoxGeometry(0.3, 0.12, 0.36), paint, { x: 0.55, y: 0.16 }));
      break;
    case 'dhow':
      parts.push(body(1.45, 0.34, 0.1, wood));
      parts.push(part(new ConeGeometry(0.05, 0.22, 6), wood, { x: -0.74, y: 0.12, rz: Math.PI / 2 + 0.5 }));
      parts.push(part(new BoxGeometry(1.1, 0.02, 0.012), paint, { y: 0.1, z: 0.165 }));
      parts.push(part(new BoxGeometry(1.1, 0.02, 0.012), paint, { y: 0.1, z: -0.165 }));
      break;
    case 'canoe':
      parts.push(body(1.5, 0.3, 0.08, wood));
      parts.push(part(new BoxGeometry(1.2, 0.015, 0.012), paint, { y: 0.09, z: 0.14 }));
      parts.push(part(new BoxGeometry(1.2, 0.015, 0.012), paint, { y: 0.09, z: -0.14 }));
      break;
  }
  parts.push(part(new BoxGeometry(1.2, 0.02, 0.24), k.color.woodDark, { y: 0.08 }));
  return parts;
}

// ------------------------------------------------------------------ flames

let flameMaterial: MeshBasicMaterial | null = null;
let flameGeometry: ConeGeometry | null = null;

/** A small bright flame tongue (shared material, HDR so it blooms). */
export function flame(scale = 1): Mesh {
  flameMaterial ??= new MeshBasicMaterial({ color: new Color(3.0, 1.05, 0.18), toneMapped: false });
  flameGeometry ??= new ConeGeometry(0.05, 0.16, 7);
  const m = new Mesh(flameGeometry, flameMaterial);
  m.position.y = 0.08 * scale;
  m.scale.setScalar(scale);
  m.name = 'flame';
  return m;
}

let glowMaterial: MeshBasicMaterial | null = null;

/** Steady bright glow (lighthouse fire, sacred orb). */
export function glowMesh(geometry: BufferGeometry): Mesh {
  glowMaterial ??= new MeshBasicMaterial({ color: new Color(3, 2.2, 1), toneMapped: false });
  const m = new Mesh(geometry, glowMaterial);
  m.name = 'glow';
  return m;
}
