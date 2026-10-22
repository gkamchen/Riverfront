import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, place, type Placement } from '../util/geometry';
import { FIELD_INNER_Z, FRAME_TOP, OUTER_HALF_X, PLATE_HALF_X, TABLE_Y, WATER_LEVEL } from './layout';
import { CosmeticRng } from './wildlife/shared';

/**
 * Static scenery a river can bring along. Everything stays off the playing
 * cells: low clumps in the shallows, small pieces on the frame at the river
 * mouths and taller ones on the table beyond both ends of the board.
 */
export type BankPropKind =
  | 'reeds'
  | 'papyrus'
  | 'palms'
  | 'dunes'
  | 'obelisks'
  | 'aqueduct'
  | 'cypress'
  | 'temple'
  | 'olives'
  | 'pines'
  | 'boulders'
  | 'columns'
  | 'lanterns'
  | 'bamboo'
  | 'longhouse'
  | 'runestones'
  | 'archBridge'
  | 'sakura'
  | 'pagoda'
  | 'greatWall'
  | 'gardens'
  | 'gers'
  | 'skyline'
  | 'jungle'
  | 'terraces'
  | 'ropeBridge'
  | 'chinampas'
  | 'roundhouses'
  | 'stoneCircle'
  | 'harbor'
  | 'stelae'
  | 'ninevehWall'
  | 'ishtarWall'
  | 'ziggurat'
  | 'tents'
  | 'theodosian'
  | 'ghats'
  | 'shikhara'
  | 'wagons'
  | 'ctesiphon'
  | 'lionStatue'
  | 'stoa';


/** Where the props of each kind may go. */
const MOUTH_X = (PLATE_HALF_X + OUTER_HALF_X) / 2;
const SHALLOW_Z = FIELD_INNER_Z - 0.2;
const TABLE_NEAR = OUTER_HALF_X + 0.7;

const C = (hex: string) => new Color(hex);
const COLORS = {
  palmTrunk: C('#8a6a44'),
  palmRing: C('#6b4f30'),
  frond: C('#4f7d34'),
  frondDark: C('#3d6428'),
  papyrus: C('#6f9a3a'),
  umbel: C('#9ab84e'),
  reed: C('#7d8a46'),
  reedTip: C('#6a4a2a'),
  cypress: C('#2f4a2a'),
  olive: C('#7d8c66'),
  oliveTrunk: C('#6b5a48'),
  pine: C('#2c4a34'),
  bark: C('#5a4030'),
  marble: C('#e8e2d6'),
  marbleShade: C('#c9c2b4'),
  terracotta: C('#b4643c'),
  sand: C('#d8bd86'),
  sandDark: C('#c4a46c'),
  aqueduct: C('#c9b79a'),
  sandstone: C('#d6b98a'),
  gold: C('#e0b04a'),
  boulder: C('#8a8580'),
  water: C('#7fb6c8'),
  lanternWood: C('#6a3a22'),
  lanternPaper: C('#f2d8a0'),
  bamboo: C('#8aa04a'),
  turf: C('#5f7a38'),
  runestone: C('#8a8884'),
  runeRed: C('#a8322a'),
  vermilion: C('#d0402a'),
  blossom: C('#f2b6c8'),
  blossomDeep: C('#e48ca8'),
  pagodaRoof: C('#3a4a42'),
  wallStone: C('#9a9284'),
  pool: C('#3a8aa0'),
  flowers: C('#d84a6a'),
  felt: C('#ece4d2'),
  feltBand: C('#b8322a'),
  lead: C('#7a8088'),
  jungle: C('#2f5a2a'),
  jungleLight: C('#4a7a32'),
  terrace: C('#6a8a3a'),
  terraceWall: C('#8a8478'),
  rope: C('#b49a6a'),
  thatch: C('#a8884a'),
  daub: C('#c8b48e'),
  amphora: C('#b4643c'),
  stela: C('#b8ae9c'),
  mudbrick: C('#c49a6a'),
  glaze: C('#2a5aa8'),
  glazeLight: C('#3a76c4'),
  tentBlack: C('#2e2622'),
  tentStripe: C('#a8843a'),
  rug: C('#9a2a2a'),
  redStone: C('#b0603a'),
  hide: C('#b49a72'),
  brick: C('#a88458'),
};

const tmp = new Color();

/** Paints a primitive and records how far up the plant it is (for wind sway). */
function bit(source: BufferGeometry, color: Color, at?: Placement, sway = 0, shade = 1): BufferGeometry {
  let geometry = source.index ? source.toNonIndexed() : source;
  if (at) geometry = place(geometry, at);
  paint(geometry, tmp.copy(color).multiplyScalar(shade));
  const position = geometry.getAttribute('position');
  const swayValues = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) swayValues[i] = Math.max(0, position.getY(i)) * sway;
  geometry.setAttribute('aSway', new Float32BufferAttribute(swayValues, 1));
  if (geometry.getAttribute('uv')) geometry.deleteAttribute('uv');
  return geometry;
}

/** A drooping, tapering leaf strip pointing along +x from the origin. */
function frond(length: number, width: number, droop: number, segments = 6): BufferGeometry {
  const positions: number[] = [];
  const point = (t: number, side: number): [number, number, number] => {
    const w = width * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (1 - t * 0.4);
    return [t * length, -droop * t * t + side * w * 0.25, side * w];
  };
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    const mid0: [number, number, number] = [t0 * length, -droop * t0 * t0 + width * 0.08, 0];
    const mid1: [number, number, number] = [t1 * length, -droop * t1 * t1 + width * 0.08, 0];
    for (const side of [-1, 1]) {
      const a = point(t0, side);
      const b = point(t1, side);
      positions.push(...mid0, ...a, ...b, ...mid0, ...b, ...mid1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

type Builder = (rng: CosmeticRng, foliage: BufferGeometry[], solid: BufferGeometry[]) => void;

/** Moves a list of freshly built prop parts into the world. */
function put(parts: BufferGeometry[], target: BufferGeometry[], at: Placement): void {
  for (const g of parts) target.push(place(g, at));
}

function palm(rng: CosmeticRng, height: number): { foliage: BufferGeometry[]; solid: BufferGeometry[] } {
  const foliage: BufferGeometry[] = [];
  const segments = 6;
  const lean = rng.range(0.12, 0.3);
  let x = 0;
  let y = 0;
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const h = height / segments;
    const r = 0.07 * (1 - t * 0.45);
    const dx = lean * h * (0.4 + t * 1.2);
    // Trunk segments sway too, a little, so the crown does not detach from them.
    foliage.push(bit(new CylinderGeometry(r * 0.9, r, h * 1.04, 7), i % 2 ? COLORS.palmTrunk : COLORS.palmRing, { x: x + dx / 2, y: y + h / 2, rz: -Math.atan2(dx, h) }, 0.15));
    x += dx;
    y += h;
  }
  const fronds = 8;
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const leaf = frond(rng.range(0.55, 0.8) * (height / 2), 0.12, rng.range(0.25, 0.4));
    place(leaf, { rz: rng.range(0.05, 0.35), ry: a, x, y, z: 0 });
    foliage.push(bit(leaf, k % 2 ? COLORS.frond : COLORS.frondDark, undefined, 0.5));
  }
  foliage.push(bit(new SphereGeometry(0.07, 6, 4), COLORS.palmRing, { x, y }, 0.4));
  return { foliage, solid: [] };
}

function papyrusClump(rng: CosmeticRng, height: number, stalks: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < stalks; i++) {
    const h = height * rng.range(0.7, 1.1);
    const x = rng.range(-0.12, 0.12) * (height + 0.3);
    const z = rng.range(-0.12, 0.12) * (height + 0.3);
    const tiltX = rng.range(-0.18, 0.18);
    const tiltZ = rng.range(-0.18, 0.18);
    parts.push(bit(new CylinderGeometry(0.008 + height * 0.008, 0.012 + height * 0.01, h, 4), COLORS.papyrus, { x, y: h / 2, z, rx: tiltX, rz: tiltZ }, 0.6));
    // The umbrella-like head: an open cone of fine rays.
    const head = new ConeGeometry(0.05 + height * 0.06, 0.05 + height * 0.04, 7, 1, true);
    head.rotateX(Math.PI);
    parts.push(bit(head, COLORS.umbel, { x: x - tiltZ * h, y: h + 0.02, z: z + tiltX * h, rx: tiltX, rz: tiltZ }, 0.6));
  }
  return parts;
}

function reedClump(rng: CosmeticRng, height: number, stalks: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < stalks; i++) {
    const h = height * rng.range(0.6, 1.1);
    const x = rng.range(-0.1, 0.1);
    const z = rng.range(-0.1, 0.1);
    const rx = rng.range(-0.2, 0.2);
    const rz = rng.range(-0.2, 0.2);
    parts.push(bit(new CylinderGeometry(0.005, 0.009, h, 3), COLORS.reed, { x, y: h / 2, z, rx, rz }, 0.7));
    if (i % 3 === 0) parts.push(bit(new CylinderGeometry(0.014, 0.014, 0.07, 5), COLORS.reedTip, { x: x - rz * h, y: h - 0.02, z: z + rx * h, rx, rz }, 0.7));
  }
  return parts;
}

function cypress(rng: CosmeticRng, height: number): BufferGeometry[] {
  return [
    bit(new CylinderGeometry(0.04, 0.05, height * 0.15, 6), COLORS.bark, { y: height * 0.075 }),
    bit(new ConeGeometry(height * 0.13, height * 0.92, 9), COLORS.cypress, { y: height * 0.55 }, 0.06, rng.range(0.9, 1.1)),
    bit(new SphereGeometry(height * 0.13, 9, 6), COLORS.cypress, { y: height * 0.22, sy: 0.9 }, 0.06, 0.92),
  ];
}

function olive(rng: CosmeticRng, height: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const twist = rng.range(-0.3, 0.3);
  parts.push(bit(new CylinderGeometry(0.06, 0.11, height * 0.45, 7), COLORS.oliveTrunk, { y: height * 0.22, rz: twist }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.range(0, 1);
    const r = height * rng.range(0.22, 0.32);
    parts.push(
      bit(new IcosahedronGeometry(r, 1), COLORS.olive, { x: Math.cos(a) * height * 0.22, y: height * rng.range(0.62, 0.8), z: Math.sin(a) * height * 0.22, sy: 0.7 }, 0.08, rng.range(0.85, 1.1)),
    );
  }
  return parts;
}

function pine(rng: CosmeticRng, height: number): BufferGeometry[] {
  const parts = [bit(new CylinderGeometry(0.035, 0.05, height * 0.25, 6), COLORS.bark, { y: height * 0.12 })];
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    parts.push(bit(new ConeGeometry(height * (0.28 - t * 0.05), height * 0.35, 8), COLORS.pine, { y: height * (0.3 + t * 0.18) }, 0.05, 0.9 + t * 0.15));
  }
  void rng;
  return parts;
}

function boulder(rng: CosmeticRng, size: number): BufferGeometry {
  return bit(new DodecahedronGeometry(size, 0), COLORS.boulder, { y: size * 0.4, sx: rng.range(1, 1.5), sy: rng.range(0.55, 0.8), sz: rng.range(0.9, 1.3), ry: rng.range(0, 6) }, 0, rng.range(0.8, 1.15));
}

function obelisk(height: number): BufferGeometry[] {
  const w = height * 0.11;
  return [
    bit(new BoxGeometry(w * 1.9, height * 0.06, w * 1.9), COLORS.sandstone, { y: height * 0.03 }, 0, 0.85),
    bit(new CylinderGeometry(w * 0.68, w, height * 0.86, 4, 1), COLORS.sandstone, { y: height * 0.49, ry: Math.PI / 4 }),
    bit(new ConeGeometry(w * 0.68, height * 0.1, 4), COLORS.gold, { y: height * 0.97, ry: Math.PI / 4 }),
  ];
}

function column(height: number, broken: boolean): BufferGeometry[] {
  const h = broken ? height * 0.55 : height;
  const parts = [
    bit(new BoxGeometry(0.2, 0.05, 0.2), COLORS.marbleShade, { y: 0.025 }),
    bit(new CylinderGeometry(0.065, 0.075, h, 10), COLORS.marble, { y: 0.05 + h / 2 }),
  ];
  if (!broken) parts.push(bit(new BoxGeometry(0.2, 0.05, 0.2), COLORS.marbleShade, { y: 0.05 + h + 0.025 }));
  return parts;
}

/** Greek temple facing the board (long axis along z). */
function temple(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const w = 1.5;
  const d = 2.4;
  for (let s = 0; s < 3; s++) parts.push(bit(new BoxGeometry(w + 0.36 - s * 0.12, 0.07, d + 0.36 - s * 0.12), COLORS.marbleShade, { y: 0.035 + s * 0.07 }));
  const base = 0.21;
  const ch = 0.95;
  const cols = 4;
  const rows = 6;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (i > 0 && i < cols - 1 && j > 0 && j < rows - 1) continue;
      const x = -w / 2 + (i / (cols - 1)) * w;
      const z = -d / 2 + (j / (rows - 1)) * d;
      parts.push(bit(new CylinderGeometry(0.075, 0.085, ch, 12), COLORS.marble, { x, y: base + ch / 2, z }));
      parts.push(bit(new BoxGeometry(0.2, 0.05, 0.2), COLORS.marbleShade, { x, y: base + ch + 0.025, z }));
    }
  }
  parts.push(bit(new BoxGeometry(w * 0.7, ch, d * 0.75), COLORS.marbleShade, { y: base + ch / 2 }, 0, 0.8));
  parts.push(bit(new BoxGeometry(w + 0.22, 0.16, d + 0.22), COLORS.marble, { y: base + ch + 0.13 }));
  parts.push(bit(new BoxGeometry(w + 0.24, 0.04, d + 0.24), COLORS.terracotta, { y: base + ch + 0.23 }));
  const gable = new Shape();
  gable.moveTo(-(w + 0.22) / 2, 0);
  gable.lineTo((w + 0.22) / 2, 0);
  gable.lineTo(0, 0.32);
  gable.closePath();
  const roof = new ExtrudeGeometry(gable, { depth: d + 0.22, bevelEnabled: false });
  roof.translate(0, 0, -(d + 0.22) / 2);
  parts.push(bit(roof, COLORS.terracotta, { y: base + ch + 0.25 }));
  return parts;
}

/** A run of arches along z with a water channel on top. */
function aqueduct(length: number, height: number): BufferGeometry[] {
  const arches = 6;
  const span = length / arches;
  const outline = new Shape();
  outline.moveTo(-length / 2, 0);
  outline.lineTo(length / 2, 0);
  outline.lineTo(length / 2, height);
  outline.lineTo(-length / 2, height);
  outline.closePath();
  for (let i = 0; i < arches; i++) {
    const cx = -length / 2 + span * (i + 0.5);
    const r = span * 0.32;
    const hole = new Path();
    hole.moveTo(cx - r, 0);
    hole.lineTo(cx + r, 0);
    hole.lineTo(cx + r, height * 0.62);
    hole.absarc(cx, height * 0.62, r, 0, Math.PI, false);
    hole.lineTo(cx - r, 0);
    outline.holes.push(hole);
  }
  const wall = new ExtrudeGeometry(outline, { depth: 0.32, bevelEnabled: false, curveSegments: 8 });
  wall.translate(0, 0, -0.16);
  wall.rotateY(Math.PI / 2);
  return [
    bit(wall, COLORS.aqueduct),
    bit(new BoxGeometry(0.44, 0.08, length + 0.1), COLORS.aqueduct, { y: height + 0.04 }, 0, 0.9),
    bit(new BoxGeometry(0.2, 0.03, length + 0.1), COLORS.water, { y: height + 0.085 }),
  ];
}

function lantern(): BufferGeometry[] {
  return [
    bit(new CylinderGeometry(0.03, 0.04, 0.5, 6), COLORS.lanternWood, { y: 0.25 }),
    bit(new BoxGeometry(0.16, 0.18, 0.16), COLORS.lanternPaper, { y: 0.58 }),
    bit(new ConeGeometry(0.15, 0.1, 4), COLORS.lanternWood, { y: 0.72, ry: Math.PI / 4 }),
  ];
}

function bambooGrove(rng: CosmeticRng, height: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const h = height * rng.range(0.7, 1.05);
    const x = rng.range(-0.3, 0.3);
    const z = rng.range(-0.3, 0.3);
    parts.push(bit(new CylinderGeometry(0.025, 0.03, h, 6), COLORS.bamboo, { x, y: h / 2, z, rx: rng.range(-0.08, 0.08) }, 0.15));
    const leaf = frond(0.35, 0.06, 0.15);
    place(leaf, { x, y: h * 0.92, z, ry: rng.range(0, 6), rz: 0.4 });
    parts.push(bit(leaf, COLORS.frond, undefined, 0.3));
  }
  return parts;
}

function longhouse(rng: CosmeticRng): BufferGeometry[] {
  const parts = [bit(new BoxGeometry(1.3, 0.32, 0.55), COLORS.palmTrunk, { y: 0.16 })];
  const gable = new Shape();
  gable.moveTo(-0.36, 0);
  gable.lineTo(0.36, 0);
  gable.lineTo(0, 0.34);
  gable.closePath();
  const roofGeometry = new ExtrudeGeometry(gable, { depth: 1.42, bevelEnabled: false });
  roofGeometry.translate(0, 0, -0.71);
  roofGeometry.rotateY(Math.PI / 2);
  parts.push(bit(roofGeometry, COLORS.turf, { y: 0.32 }, 0, rng.range(0.9, 1.05)));
  parts.push(bit(new BoxGeometry(0.16, 0.22, 0.02), COLORS.lanternWood, { y: 0.11, z: -0.28 }));
  for (const s of [-1, 1]) parts.push(bit(new ConeGeometry(0.03, 0.22, 5), COLORS.lanternWood, { x: s * 0.72, y: 0.72, rz: -s * 0.5 }));
  return parts;
}

function runestone(): BufferGeometry[] {
  return [
    bit(new BoxGeometry(0.2, 0.5, 0.08), COLORS.runestone, { y: 0.25 }),
    bit(new SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.runestone, { y: 0.48, sz: 0.4 }),
    bit(new TorusGeometry(0.07, 0.008, 4, 12), COLORS.runeRed, { y: 0.3, z: -0.042 }),
    bit(new BoxGeometry(0.012, 0.24, 0.004), COLORS.runeRed, { x: 0.06, y: 0.28, z: -0.042 }),
  ];
}

function archBridge(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const span = 3.4;
  const steps = 18;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const y0 = Math.sin(Math.PI * t0) * 0.45;
    const y1 = Math.sin(Math.PI * t1) * 0.45;
    const z0 = -span / 2 + span * t0;
    const z1 = -span / 2 + span * t1;
    parts.push(bit(new BoxGeometry(0.3, 0.03, Math.hypot(z1 - z0, y1 - y0) + 0.01), COLORS.palmTrunk, { y: (y0 + y1) / 2, z: (z0 + z1) / 2, rx: -Math.atan2(y1 - y0, z1 - z0) }));
    if (i % 3 === 0) for (const s of [-1, 1]) parts.push(bit(new CylinderGeometry(0.012, 0.012, 0.16, 5), COLORS.vermilion, { x: s * 0.14, y: y0 + 0.08, z: z0 }));
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const y0 = Math.sin(Math.PI * t0) * 0.45 + 0.16;
      const y1 = Math.sin(Math.PI * t1) * 0.45 + 0.16;
      const z0 = -span / 2 + span * t0;
      const z1 = -span / 2 + span * t1;
      parts.push(bit(new BoxGeometry(0.02, 0.02, Math.hypot(z1 - z0, y1 - y0) + 0.01), COLORS.vermilion, { x: s * 0.14, y: (y0 + y1) / 2, z: (z0 + z1) / 2, rx: -Math.atan2(y1 - y0, z1 - z0) }));
    }
  }
  return parts;
}

function sakura(rng: CosmeticRng, height: number): BufferGeometry[] {
  const parts = [bit(new CylinderGeometry(0.05, 0.08, height * 0.5, 7), COLORS.bark, { y: height * 0.25, rz: rng.range(-0.15, 0.15) })];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng.range(0, 1);
    parts.push(bit(new IcosahedronGeometry(height * rng.range(0.2, 0.28), 1), i % 2 ? COLORS.blossom : COLORS.blossomDeep, { x: Math.cos(a) * height * 0.2, y: height * rng.range(0.6, 0.78), z: Math.sin(a) * height * 0.2, sy: 0.75 }, 0.08));
  }
  return parts;
}

function pagodaTower(): BufferGeometry[] {
  const parts: BufferGeometry[] = [bit(new BoxGeometry(0.6, 0.08, 0.6), COLORS.wallStone, { y: 0.04 })];
  for (let i = 0; i < 5; i++) {
    const s = 1 - i * 0.14;
    const y = 0.08 + i * 0.28;
    parts.push(bit(new BoxGeometry(0.36 * s, 0.2, 0.36 * s), COLORS.lanternWood, { y: y + 0.1 }));
    parts.push(bit(new ConeGeometry(0.42 * s, 0.12, 4, 1, true), COLORS.pagodaRoof, { y: y + 0.24, ry: Math.PI / 4 }));
  }
  parts.push(bit(new ConeGeometry(0.03, 0.3, 6), COLORS.gold, { y: 1.6 }));
  return parts;
}

function wallSegment(length: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [bit(new BoxGeometry(0.5, 0.6, length), COLORS.wallStone, { y: 0.3 })];
  for (let i = 0; i < length / 0.22; i++) for (const s of [-1, 1]) parts.push(bit(new BoxGeometry(0.08, 0.1, 0.12), COLORS.wallStone, { x: s * 0.21, y: 0.65, z: -length / 2 + 0.1 + i * 0.22 }, 0, 0.92));
  parts.push(bit(new BoxGeometry(0.7, 0.9, 0.7), COLORS.wallStone, { y: 0.45 }, 0, 0.95));
  parts.push(bit(new ConeGeometry(0.62, 0.3, 4), COLORS.pagodaRoof, { y: 1.05, ry: Math.PI / 4 }));
  return parts;
}

function garden(rng: CosmeticRng): BufferGeometry[] {
  const parts: BufferGeometry[] = [
    bit(new BoxGeometry(1.6, 0.06, 1.6), COLORS.sandDark, { y: 0.03 }),
    bit(new BoxGeometry(1.5, 0.02, 0.18), COLORS.pool, { y: 0.07 }),
    bit(new BoxGeometry(0.18, 0.02, 1.5), COLORS.pool, { y: 0.07 }),
    bit(new CylinderGeometry(0.14, 0.16, 0.08, 10), COLORS.marble, { y: 0.08 }),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(bit(new BoxGeometry(0.5, 0.06, 0.5), COLORS.flowers, { x: sx * 0.42, y: 0.08, z: sz * 0.42 }, 0, rng.range(0.8, 1.1)));
      parts.push(...cypress(rng, 1.1).map((g) => place(g, { x: sx * 0.72, z: sz * 0.72 })));
    }
  }
  return parts;
}

function ger(rng: CosmeticRng): BufferGeometry[] {
  const r = rng.range(0.32, 0.42);
  return [
    bit(new CylinderGeometry(r, r, 0.28, 14), COLORS.felt, { y: 0.14 }),
    bit(new CylinderGeometry(r + 0.005, r + 0.005, 0.03, 14), COLORS.feltBand, { y: 0.24 }),
    bit(new ConeGeometry(r + 0.04, 0.2, 14), COLORS.felt, { y: 0.38 }, 0, 0.94),
    bit(new CylinderGeometry(0.06, 0.06, 0.03, 10), COLORS.lanternWood, { y: 0.49 }),
    bit(new BoxGeometry(0.12, 0.18, 0.02), COLORS.feltBand, { y: 0.09, z: -r - 0.005 }),
  ];
}

/** A distant city on the far bank: domes and slender towers, as scenery only. */
function skyline(rng: CosmeticRng): BufferGeometry[] {
  const parts: BufferGeometry[] = [bit(new BoxGeometry(1.6, 0.4, 1.6), COLORS.marbleShade, { y: 0.2 })];
  parts.push(bit(new SphereGeometry(0.55, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.lead, { y: 0.4 }));
  for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) parts.push(bit(new SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.lead, { x, y: 0.4, z }));
  for (const [x, z] of [[-0.95, -0.95], [0.95, 0.95]] as const) {
    const h = rng.range(1.6, 1.9);
    parts.push(bit(new CylinderGeometry(0.06, 0.07, h, 10), COLORS.marble, { x, y: h / 2, z }));
    parts.push(bit(new CylinderGeometry(0.1, 0.08, 0.05, 10), COLORS.marbleShade, { x, y: h * 0.75, z }));
    parts.push(bit(new ConeGeometry(0.07, 0.3, 10), COLORS.lead, { x, y: h + 0.15, z }));
  }
  return parts;
}

function jungleTree(rng: CosmeticRng, height: number): BufferGeometry[] {
  const parts = [bit(new CylinderGeometry(0.05, 0.08, height * 0.6, 7), COLORS.bark, { y: height * 0.3 })];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng.range(0, 1);
    parts.push(bit(new IcosahedronGeometry(height * rng.range(0.24, 0.32), 1), i % 2 ? COLORS.jungle : COLORS.jungleLight, { x: Math.cos(a) * height * 0.22, y: height * rng.range(0.62, 0.85), z: Math.sin(a) * height * 0.22, sy: 0.7 }, 0.07));
  }
  return parts;
}

function terraces(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    parts.push(bit(new BoxGeometry(1.4 - i * 0.22, 0.16, 2.4), COLORS.terraceWall, { x: i * 0.11, y: 0.08 + i * 0.16 }));
    parts.push(bit(new BoxGeometry(1.36 - i * 0.22, 0.02, 2.36), COLORS.terrace, { x: i * 0.11, y: 0.17 + i * 0.16 }));
  }
  return parts;
}

/** A sagging rope bridge across the river with rope hand rails. */
function ropeBridge(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const span = 3.4;
  const steps = 16;
  const sag = (t: number) => 0.42 - Math.sin(Math.PI * t) * 0.22;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    parts.push(bit(new BoxGeometry(0.32, 0.02, span / steps - 0.03), COLORS.palmTrunk, { y: sag(t), z: -span / 2 + span * t }));
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      const y0 = sag(t0) + 0.2;
      const y1 = sag(t1) + 0.2;
      const z0 = -span / 2 + span * t0;
      const z1 = -span / 2 + span * t1;
      parts.push(bit(new BoxGeometry(0.012, 0.012, Math.hypot(z1 - z0, y1 - y0) + 0.01), COLORS.rope, { x: s * 0.16, y: (y0 + y1) / 2, z: (z0 + z1) / 2, rx: -Math.atan2(y1 - y0, z1 - z0) }));
    }
    for (const z of [-span / 2, span / 2]) parts.push(bit(new CylinderGeometry(0.03, 0.035, 0.7, 6), COLORS.palmTrunk, { x: s * 0.18, y: 0.35, z }));
  }
  return parts;
}

function chinampa(rng: CosmeticRng): BufferGeometry[] {
  const parts = [bit(new BoxGeometry(0.9, 0.05, 0.22), COLORS.terrace, { y: 0.0 })];
  for (let i = 0; i < 5; i++) parts.push(bit(new ConeGeometry(0.035, 0.12, 5), COLORS.jungleLight, { x: -0.36 + i * 0.18, y: 0.08 }, 0.5, rng.range(0.85, 1.1)));
  return parts;
}

function roundhouse(rng: CosmeticRng): BufferGeometry[] {
  const r = rng.range(0.38, 0.48);
  return [
    bit(new CylinderGeometry(r, r, 0.24, 14), COLORS.daub, { y: 0.12 }),
    bit(new ConeGeometry(r + 0.1, 0.5, 14), COLORS.thatch, { y: 0.49 }),
    bit(new BoxGeometry(0.12, 0.18, 0.02), COLORS.lanternWood, { y: 0.09, z: -r - 0.005 }),
  ];
}

function stoneRing(rng: CosmeticRng, radius: number, count: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const h = rng.range(0.4, 0.62);
    parts.push(bit(new BoxGeometry(0.14, h, 0.08), COLORS.runestone, { x: Math.cos(a) * radius, y: h / 2, z: Math.sin(a) * radius, ry: -a + Math.PI / 2 }, 0, rng.range(0.85, 1.1)));
  }
  return parts;
}

function quay(rng: CosmeticRng): BufferGeometry[] {
  const parts: BufferGeometry[] = [bit(new BoxGeometry(1.4, 0.3, 3.2), COLORS.marbleShade, { y: 0.15 })];
  for (let i = 0; i < 9; i++) {
    const x = rng.range(-0.5, 0.5);
    const z = rng.range(-1.3, 1.3);
    parts.push(bit(new CylinderGeometry(0.05, 0.07, 0.22, 8), COLORS.amphora, { x, y: 0.41, z }));
  }
  parts.push(bit(new BoxGeometry(0.06, 1.1, 0.06), COLORS.lanternWood, { x: 0.45, y: 0.85, z: 0.9 }));
  parts.push(bit(new BoxGeometry(0.7, 0.05, 0.05), COLORS.lanternWood, { x: 0.2, y: 1.38, z: 0.9, rz: 0.3 }));
  return parts;
}

function stela(): BufferGeometry[] {
  return [
    bit(new BoxGeometry(0.22, 0.6, 0.12), COLORS.stela, { y: 0.3 }),
    bit(new BoxGeometry(0.16, 0.04, 0.125), COLORS.runeRed, { y: 0.45 }),
    bit(new BoxGeometry(0.16, 0.04, 0.125), COLORS.runeRed, { y: 0.3 }),
    bit(new CylinderGeometry(0.14, 0.16, 0.08, 10), COLORS.stela, { y: 0.04, z: -0.2 }),
  ];
}

/** A crenellated city wall along z with two towers; an optional frieze of beasts. */
function cityWall(length: number, body: Color, trim: Color, frieze: Color | null): BufferGeometry[] {
  const parts: BufferGeometry[] = [bit(new BoxGeometry(0.4, 0.7, length), body, { y: 0.35 })];
  // Stepped merlons along the top.
  for (let i = 0; i < length / 0.16; i++) {
    const z = -length / 2 + 0.08 + i * 0.16;
    parts.push(bit(new BoxGeometry(0.4, 0.06, 0.1), body, { y: 0.73, z }, 0, 0.95));
    parts.push(bit(new BoxGeometry(0.4, 0.05, 0.05), body, { y: 0.78, z }, 0, 0.9));
  }
  for (const z of [-length / 2 + 0.3, length / 2 - 0.3]) {
    parts.push(bit(new BoxGeometry(0.6, 0.95, 0.5), body, { y: 0.475, z }, 0, 0.94));
    parts.push(bit(new BoxGeometry(0.62, 0.05, 0.52), trim, { y: 0.92, z }));
  }
  if (frieze) {
    // Rows of striding animals in raised glazed brick (seen from the board).
    for (const y of [0.28, 0.52]) {
      parts.push(bit(new BoxGeometry(0.01, 0.025, length - 1.2), trim, { x: -0.205, y: y - 0.08 }));
      for (let i = 0; i < (length - 1.4) / 0.32; i++) {
        const z = -length / 2 + 0.85 + i * 0.32;
        parts.push(bit(new BoxGeometry(0.012, 0.06, 0.16), frieze, { x: -0.205, y, z }));
        parts.push(bit(new BoxGeometry(0.012, 0.05, 0.04), frieze, { x: -0.205, y: y + 0.04, z: z - 0.09 }));
        for (const dz of [-0.06, 0.06]) parts.push(bit(new BoxGeometry(0.012, 0.05, 0.015), frieze, { x: -0.205, y: y - 0.05, z: z + dz }));
      }
    }
  }
  return parts;
}

function ziggurat(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const w = 1.6 - i * 0.34;
    parts.push(bit(new BoxGeometry(w, 0.3, w), COLORS.mudbrick, { y: 0.15 + i * 0.3 }, 0, 1 - i * 0.04));
    parts.push(bit(new BoxGeometry(w + 0.01, 0.03, w + 0.01), COLORS.brick, { y: 0.29 + i * 0.3 }));
  }
  // Central stair rising from the river side, and the small shrine on top (scenery only).
  parts.push(bit(new BoxGeometry(0.9, 0.04, 0.24), COLORS.brick, { x: -0.75, y: 0.45, rz: 0.62 }));
  parts.push(bit(new BoxGeometry(0.34, 0.24, 0.34), COLORS.glaze, { y: 1.32 }));
  return parts;
}

function bedouinTent(rng: CosmeticRng): BufferGeometry[] {
  const w = rng.range(0.9, 1.2);
  const parts: BufferGeometry[] = [
    bit(new CylinderGeometry(0.34, 0.34, w, 8, 1, true, Math.PI / 2, Math.PI), COLORS.tentBlack, { y: 0.0, rx: Math.PI / 2 }),
    bit(new BoxGeometry(0.02, 0.03, w), COLORS.tentStripe, { y: 0.32 }),
    bit(new BoxGeometry(0.5, 0.01, w * 0.7), COLORS.rug, { x: -0.5, y: 0.005 }),
  ];
  for (const z of [-w / 2, 0, w / 2]) parts.push(bit(new CylinderGeometry(0.012, 0.012, 0.42, 5), COLORS.lanternWood, { x: -0.36, y: 0.2, z, rz: 0.25 }));
  return parts.map((g) => place(g, { sy: 0.85 }));
}

function byzantineCity(rng: CosmeticRng): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  // Two wall lines in front, the domed church behind (scenery only).
  for (const [x, h] of [[-0.7, 0.45], [-0.3, 0.7]] as const) {
    parts.push(bit(new BoxGeometry(0.22, h, 3.2), COLORS.marbleShade, { x, y: h / 2 }));
    for (let i = 0; i < 4; i++) parts.push(bit(new BoxGeometry(0.34, h + 0.25, 0.34), COLORS.marbleShade, { x, y: (h + 0.25) / 2, z: -1.35 + i * 0.9 }, 0, 0.93));
    parts.push(bit(new BoxGeometry(0.23, 0.04, 3.2), COLORS.brick, { x, y: h * 0.6 }));
  }
  parts.push(bit(new BoxGeometry(1.0, 0.6, 1.2), COLORS.marble, { x: 0.5, y: 0.3 }));
  parts.push(bit(new CylinderGeometry(0.42, 0.42, 0.14, 20), COLORS.marbleShade, { x: 0.5, y: 0.67 }));
  parts.push(bit(new SphereGeometry(0.42, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.lead, { x: 0.5, y: 0.74 }));
  parts.push(bit(new BoxGeometry(0.02, 0.18, 0.02), COLORS.gold, { x: 0.5, y: 1.25 }));
  parts.push(bit(new BoxGeometry(0.02, 0.02, 0.1), COLORS.gold, { x: 0.5, y: 1.29 }));
  for (const z of [-0.75, 0.75]) parts.push(bit(new SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.lead, { x: 0.5, y: 0.6, z }, 0, rng.range(0.95, 1.05)));
  return parts;
}

function ghat(rng: CosmeticRng): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) parts.push(bit(new BoxGeometry(0.2, 0.08 + i * 0.08, 1.6), COLORS.redStone, { x: -0.4 + i * 0.2, y: (0.08 + i * 0.08) / 2 }, 0, 1 - i * 0.03));
  // A chhatri pavilion at the top of the steps.
  const top = 0.44;
  parts.push(bit(new BoxGeometry(0.5, 0.06, 0.5), COLORS.sandstone, { x: 0.5, y: top + 0.03 }));
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) parts.push(bit(new CylinderGeometry(0.025, 0.025, 0.36, 6), COLORS.sandstone, { x: 0.5 + dx * 0.18, y: top + 0.24, z: dz * 0.18 }));
  parts.push(bit(new BoxGeometry(0.5, 0.04, 0.5), COLORS.sandstone, { x: 0.5, y: top + 0.44 }));
  parts.push(bit(new SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), COLORS.marble, { x: 0.5, y: top + 0.46 }));
  parts.push(bit(new ConeGeometry(0.03, 0.1, 6), COLORS.gold, { x: 0.5, y: top + 0.7 }));
  for (let i = 0; i < 4; i++) parts.push(bit(new CylinderGeometry(0.03, 0.035, 0.03, 8), COLORS.lanternPaper, { x: -0.38 + rng.range(0, 0.6), y: 0.17 + i * 0.08, z: rng.range(-0.6, 0.6) }));
  return parts;
}

/** A curvilinear temple tower, as distant scenery only. */
function shikhara(): BufferGeometry[] {
  const parts: BufferGeometry[] = [bit(new BoxGeometry(1.2, 0.2, 1.2), COLORS.redStone, { y: 0.1 }), bit(new BoxGeometry(0.8, 0.4, 0.8), COLORS.sandstone, { y: 0.4 })];
  for (let i = 0; i < 8; i++) {
    const t = i / 8;
    const w = 0.7 * Math.cos(t * 1.25) + 0.08;
    parts.push(bit(new BoxGeometry(w, 0.15, w), COLORS.sandstone, { y: 0.67 + i * 0.15, ry: i % 2 ? Math.PI / 4 : 0, sy: 1 }, 0, 0.92 + (i % 2) * 0.08));
  }
  parts.push(bit(new CylinderGeometry(0.16, 0.16, 0.06, 14), COLORS.sandstone, { y: 1.9 }));
  parts.push(bit(new ConeGeometry(0.05, 0.16, 8), COLORS.gold, { y: 2.0 }));
  return parts;
}

function campWagon(rng: CosmeticRng): BufferGeometry[] {
  const parts: BufferGeometry[] = [
    bit(new BoxGeometry(0.6, 0.12, 0.34), COLORS.lanternWood, { y: 0.22 }),
    bit(new CylinderGeometry(0.17, 0.17, 0.56, 10, 1, true, 0, Math.PI), COLORS.hide, { y: 0.28, rz: Math.PI / 2 }, 0, rng.range(0.9, 1.05)),
    bit(new BoxGeometry(0.5, 0.025, 0.025), COLORS.lanternWood, { x: -0.5, y: 0.16, rz: 0.15 }),
  ];
  for (const x of [-0.2, 0.2]) for (const z of [-0.18, 0.18]) parts.push(bit(new TorusGeometry(0.1, 0.018, 5, 12), COLORS.bark, { x, y: 0.11, z }));
  return parts;
}

/** The great vaulted arch of a royal hall with arcaded wings. */
function greatArch(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const span = 1.1;
  const rise = 1.5;
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI;
    const a1 = ((i + 1) / steps) * Math.PI;
    const z0 = Math.cos(a0) * span * 0.5;
    const z1 = Math.cos(a1) * span * 0.5;
    const y0 = Math.sin(a0) * rise;
    const y1 = Math.sin(a1) * rise;
    const len = Math.hypot(z1 - z0, y1 - y0);
    parts.push(bit(new BoxGeometry(0.9, 0.16, len + 0.02), COLORS.brick, { y: (y0 + y1) / 2 + 0.05, z: (z0 + z1) / 2, rx: Math.atan2(y1 - y0, z1 - z0) }));
  }
  for (const s of [-1, 1]) {
    parts.push(bit(new BoxGeometry(0.9, 0.05, 0.16), COLORS.brick, { z: s * span * 0.5, y: 0.03 }));
    parts.push(bit(new BoxGeometry(0.2, 1.4, 1.1), COLORS.mudbrick, { x: -0.35, y: 0.7, z: s * (span * 0.5 + 0.6) }));
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) parts.push(bit(new BoxGeometry(0.01, 0.2, 0.16), COLORS.bark, { x: -0.455, y: 0.2 + r * 0.32, z: s * (span * 0.5 + 0.25 + c * 0.32) }));
  }
  return parts;
}

/** A seated lion on a stepped plinth, the memorial on the hill. */
function lionMonument(): BufferGeometry[] {
  const stone = COLORS.marbleShade;
  return [
    bit(new BoxGeometry(0.9, 0.18, 0.9), COLORS.boulder, { y: 0.09 }),
    bit(new BoxGeometry(0.7, 0.3, 0.7), COLORS.marble, { y: 0.33 }),
    bit(new BoxGeometry(0.42, 0.2, 0.22), stone, { x: 0.08, y: 0.6 }),
    bit(new SphereGeometry(0.15, 12, 8), stone, { x: -0.12, y: 0.72, sy: 1.2 }),
    bit(new SphereGeometry(0.11, 10, 8), stone, { x: -0.2, y: 0.88 }),
    bit(new BoxGeometry(0.1, 0.07, 0.1), stone, { x: -0.3, y: 0.85 }),
    bit(new CylinderGeometry(0.035, 0.035, 0.24, 6), stone, { x: -0.18, y: 0.6, z: -0.07 }),
    bit(new CylinderGeometry(0.035, 0.035, 0.24, 6), stone, { x: -0.18, y: 0.6, z: 0.07 }),
    bit(new SphereGeometry(0.08, 8, 6), stone, { x: 0.2, y: 0.55, z: -0.06 }),
    bit(new SphereGeometry(0.08, 8, 6), stone, { x: 0.2, y: 0.55, z: 0.06 }),
    bit(new CylinderGeometry(0.015, 0.02, 0.26, 5), stone, { x: 0.32, y: 0.55, z: 0.1, rz: 0.5 }),
  ];
}

function stoa(): BufferGeometry[] {
  const parts: BufferGeometry[] = [bit(new BoxGeometry(0.8, 0.1, 3.0), COLORS.marbleShade, { y: 0.05 }), bit(new BoxGeometry(0.2, 0.6, 3.0), COLORS.marble, { x: 0.3, y: 0.4 })];
  for (let i = 0; i < 9; i++) parts.push(...column(0.52, false).map((g) => place(g, { x: -0.28, y: 0.1, z: -1.35 + i * 0.34 })));
  parts.push(bit(new BoxGeometry(0.84, 0.08, 3.04), COLORS.marble, { y: 0.74 }));
  parts.push(bit(new BoxGeometry(0.6, 0.12, 3.04), COLORS.terracotta, { y: 0.82, rz: 0.12 }));
  return parts;
}

/** Slots on the table beyond each end of the board: [x offset from the frame, z]. */
const TABLE_SLOTS: ReadonlyArray<[number, number]> = [
  [0.2, -3.6],
  [0.9, -1.6],
  [0.1, 0.4],
  [1.0, 2.2],
  [0.3, 4.1],
  [1.6, -4.6],
  [1.8, 3.6],
];

const BUILDERS: Record<BankPropKind, Builder> = {
  reeds: (rng, foliage) => {
    for (let i = 0; i < 16; i++) {
      const sign = i % 2 ? 1 : -1;
      const x = rng.range(-PLATE_HALF_X + 0.6, PLATE_HALF_X - 0.6);
      put(reedClump(rng, rng.range(0.16, 0.26), 5), foliage, { x, y: WATER_LEVEL - 0.05, z: sign * SHALLOW_Z });
    }
  },
  papyrus: (rng, foliage) => {
    // Short clumps in the shallows (they must not hide the first row of tiles).
    for (let i = 0; i < 14; i++) {
      const sign = i % 2 ? 1 : -1;
      put(papyrusClump(rng, rng.range(0.17, 0.25), 4), foliage, { x: rng.range(-PLATE_HALF_X + 0.6, PLATE_HALF_X - 0.6), y: WATER_LEVEL - 0.05, z: sign * SHALLOW_Z });
    }
    // Tall stands at the mouths and on the table.
    for (const side of [-1, 1]) {
      for (const z of [-1.2, 1.2]) put(papyrusClump(rng, 0.7, 9), foliage, { x: side * MOUTH_X, y: FRAME_TOP, z });
      put(papyrusClump(rng, 1.0, 14), foliage, { x: side * (TABLE_NEAR + 0.3), y: TABLE_Y, z: rng.range(-0.6, 0.6) });
    }
  },
  palms: (rng, foliage) => {
    for (const side of [-1, 1]) {
      for (const [dx, z] of TABLE_SLOTS.slice(0, 4)) {
        const tree = palm(rng, rng.range(1.7, 2.5));
        put(tree.foliage, foliage, { x: side * (TABLE_NEAR + dx + 0.4), y: TABLE_Y, z: z + rng.range(-0.3, 0.3), ry: rng.range(0, 6) });
      }
    }
  },
  dunes: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        solid.push(bit(new SphereGeometry(1, 14, 8), i % 2 ? COLORS.sand : COLORS.sandDark, { x: side * (TABLE_NEAR + rng.range(0.4, 2.4)), y: TABLE_Y - 0.05, z: rng.range(-5, 5), sx: rng.range(1, 1.8), sy: rng.range(0.15, 0.3), sz: rng.range(1, 2) }));
      }
    }
  },
  obelisks: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) {
      for (const z of [-1.3, 1.3]) put(obelisk(0.95), solid, { x: side * (MOUTH_X + 0.35), y: FRAME_TOP, z });
    }
  },
  aqueduct: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) put(aqueduct(9, 1.6), solid, { x: side * (TABLE_NEAR + 1.2), y: TABLE_Y });
  },
  cypress: (rng, foliage) => {
    for (const side of [-1, 1]) {
      for (const [dx, z] of TABLE_SLOTS) put(cypress(rng, rng.range(1.3, 2.2)), foliage, { x: side * (TABLE_NEAR + dx), y: TABLE_Y, z });
    }
  },
  temple: (_rng, _foliage, solid) => {
    put(temple(), solid, { x: TABLE_NEAR + 1.2, y: TABLE_Y, z: 0.6 });
    for (const z of [-1.2, 1.2]) put(column(0.7, z > 0), solid, { x: -(MOUTH_X + 0.3), y: FRAME_TOP, z });
  },
  olives: (rng, foliage) => {
    for (const side of [-1, 1]) {
      for (const [dx, z] of TABLE_SLOTS.slice(side > 0 ? 4 : 0, side > 0 ? 7 : 4)) put(olive(rng, rng.range(0.8, 1.2)), foliage, { x: side * (TABLE_NEAR + dx + 0.2), y: TABLE_Y, z, ry: rng.range(0, 6) });
    }
  },
  pines: (rng, foliage) => {
    for (const side of [-1, 1]) {
      for (const [dx, z] of TABLE_SLOTS) put(pine(rng, rng.range(1.2, 2)), foliage, { x: side * (TABLE_NEAR + dx), y: TABLE_Y, z });
    }
  },
  boulders: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) solid.push(place(boulder(rng, rng.range(0.25, 0.6)), { x: side * (TABLE_NEAR + rng.range(0, 2.5)), y: TABLE_Y, z: rng.range(-4.5, 4.5) }));
      solid.push(place(boulder(rng, 0.18), { x: side * MOUTH_X, y: FRAME_TOP, z: rng.range(-1.2, 1.2) }));
    }
  },
  columns: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) {
      for (const z of [-1.25, 1.25]) put(column(0.65, rng.chance(0.5)), solid, { x: side * (MOUTH_X + 0.3), y: FRAME_TOP, z });
    }
  },
  lanterns: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const z of [-1.3, 1.3]) put(lantern(), solid, { x: side * (MOUTH_X + 0.3), y: FRAME_TOP, z });
  },
  longhouse: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) put(longhouse(rng), solid, { x: side * (TABLE_NEAR + 1.0), y: TABLE_Y, z: side * 1.6, ry: Math.PI / 2 });
  },
  runestones: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const z of [-1.25, 1.25]) put(runestone(), solid, { x: side * (MOUTH_X + 0.3), y: FRAME_TOP, z, ry: side * 0.3 });
  },
  archBridge: (_rng, _foliage, solid) => {
    put(archBridge(), solid, { x: PLATE_HALF_X - 0.33, y: 0.12 });
  },
  sakura: (rng, foliage) => {
    for (const side of [-1, 1]) for (const [dx, z] of TABLE_SLOTS.slice(0, 5)) put(sakura(rng, rng.range(1.1, 1.6)), foliage, { x: side * (TABLE_NEAR + dx), y: TABLE_Y, z });
  },
  pagoda: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) put(pagodaTower(), solid, { x: side * (TABLE_NEAR + 1.4), y: TABLE_Y, z: side * -2.4 });
  },
  greatWall: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) put(wallSegment(8), solid, { x: side * (TABLE_NEAR + 2.4), y: TABLE_Y });
  },
  gardens: (rng, foliage) => {
    for (const side of [-1, 1]) put(garden(rng), foliage, { x: side * (TABLE_NEAR + 1.3), y: TABLE_Y, z: side * 2.2 });
  },
  gers: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const [dx, z] of TABLE_SLOTS.slice(1, 5)) put(ger(rng), solid, { x: side * (TABLE_NEAR + dx + 0.3), y: TABLE_Y, z, ry: rng.range(0, 6) });
  },
  skyline: (rng, _foliage, solid) => {
    put(skyline(rng), solid, { x: TABLE_NEAR + 1.6, y: TABLE_Y, z: -1.4 });
  },
  jungle: (rng, foliage) => {
    for (const side of [-1, 1]) for (const [dx, z] of TABLE_SLOTS) put(jungleTree(rng, rng.range(1.3, 2)), foliage, { x: side * (TABLE_NEAR + dx), y: TABLE_Y, z });
  },
  terraces: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) put(terraces(), solid, { x: side * (TABLE_NEAR + 1.2), y: TABLE_Y, z: side * 1.5, ry: side > 0 ? 0 : Math.PI });
  },
  ropeBridge: (_rng, _foliage, solid) => {
    put(ropeBridge(), solid, { x: -(PLATE_HALF_X - 0.33), y: 0 });
  },
  chinampas: (rng, foliage) => {
    for (let i = 0; i < 6; i++) {
      const sign = i % 2 ? 1 : -1;
      put(chinampa(rng), foliage, { x: -10 + i * 4 + rng.range(-0.5, 0.5), y: WATER_LEVEL + 0.01, z: sign * (SHALLOW_Z - 0.08) });
    }
  },
  roundhouses: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const [dx, z] of TABLE_SLOTS.slice(0, 3)) put(roundhouse(rng), solid, { x: side * (TABLE_NEAR + dx + 0.5), y: TABLE_Y, z: z + side });
  },
  stoneCircle: (rng, _foliage, solid) => {
    put(stoneRing(rng, 1.1, 12), solid, { x: TABLE_NEAR + 1.6, y: TABLE_Y, z: 0 });
  },
  harbor: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) put(quay(rng), solid, { x: side * (TABLE_NEAR + 0.9), y: TABLE_Y, ry: side > 0 ? 0 : Math.PI });
  },
  stelae: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const z of [-1.25, 1.25]) put(stela(), solid, { x: side * (MOUTH_X + 0.3), y: FRAME_TOP, z, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
  },
  ninevehWall: (_rng, _foliage, solid) => {
    for (const side of [-1, 1]) put(cityWall(3.4, COLORS.mudbrick, COLORS.brick, null), solid, { x: side * (TABLE_NEAR + 1.4), y: TABLE_Y, ry: side > 0 ? 0 : Math.PI });
  },
  ishtarWall: (_rng, _foliage, solid) => {
    put(cityWall(3.4, COLORS.glaze, COLORS.gold, COLORS.sand), solid, { x: TABLE_NEAR + 1.3, y: TABLE_Y });
  },
  ziggurat: (_rng, _foliage, solid) => {
    put(ziggurat(), solid, { x: -(TABLE_NEAR + 1.4), y: TABLE_Y, z: -0.6, ry: Math.PI });
  },
  tents: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const [dx, z] of TABLE_SLOTS.slice(1, 4)) put(bedouinTent(rng), solid, { x: side * (TABLE_NEAR + dx + 0.4), y: TABLE_Y, z: z + side * 0.4, ry: side > 0 ? 0 : Math.PI });
  },
  theodosian: (rng, _foliage, solid) => {
    put(byzantineCity(rng), solid, { x: TABLE_NEAR + 1.3, y: TABLE_Y });
  },
  ghats: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const z of [-1.4, 1.4]) put(ghat(rng), solid, { x: side * (TABLE_NEAR + 0.7), y: TABLE_Y, z, ry: side > 0 ? 0 : Math.PI });
  },
  shikhara: (_rng, _foliage, solid) => {
    put(shikhara(), solid, { x: -(TABLE_NEAR + 1.8), y: TABLE_Y, z: 0 });
  },
  wagons: (rng, _foliage, solid) => {
    for (const side of [-1, 1]) for (const [dx, z] of TABLE_SLOTS.slice(0, 4)) put(campWagon(rng), solid, { x: side * (TABLE_NEAR + dx + 0.3), y: TABLE_Y, z, ry: rng.range(0, 6) });
  },
  ctesiphon: (_rng, _foliage, solid) => {
    put(greatArch(), solid, { x: TABLE_NEAR + 1.4, y: TABLE_Y, z: 0 });
  },
  lionStatue: (_rng, _foliage, solid) => {
    put(lionMonument(), solid, { x: -(TABLE_NEAR + 1.0), y: TABLE_Y, z: 1.2 });
  },
  stoa: (_rng, _foliage, solid) => {
    put(stoa(), solid, { x: TABLE_NEAR + 1.3, y: TABLE_Y });
  },
  bamboo: (rng, foliage) => {
    for (const side of [-1, 1]) for (const [dx, z] of TABLE_SLOTS.slice(0, 5)) put(bambooGrove(rng, rng.range(1.4, 2.1)), foliage, { x: side * (TABLE_NEAR + dx), y: TABLE_Y, z });
  },
};

/**
 * The scenery of the current river. Plants share one wind-swayed material and
 * stone pieces another; each list becomes a single merged mesh.
 */
export class BankProps {
  readonly group = new Group();
  readonly #wind: IUniform<number> = { value: 0 };
  readonly #gust: IUniform<number> = { value: 0 };
  readonly #foliageMaterial: MeshStandardMaterial;
  readonly #solidMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  #kinds: readonly BankPropKind[] = [];

  constructor() {
    this.group.name = 'bank-props';
    this.#foliageMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: DoubleSide });
    this.#foliageMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = this.#wind;
      shader.uniforms.uGust = this.#gust;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uWind;\nuniform float uGust;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          float swayPhase = position.x * 0.7 + position.z * 1.3;
          float swayAmp = aSway * (0.05 + uGust * 0.12);
          transformed.x += sin(uWind * 1.4 + swayPhase) * swayAmp;
          transformed.z += cos(uWind * 1.1 + swayPhase * 1.3) * swayAmp * 0.6;`,
        );
    };
    this.#foliageMaterial.customProgramCacheKey = () => 'bank-foliage';
  }

  get kinds(): readonly BankPropKind[] {
    return this.#kinds;
  }

  setKinds(kinds: readonly BankPropKind[]): void {
    this.#clear();
    this.#kinds = kinds;
    const rng = new CosmeticRng(0xba4c);
    const foliage: BufferGeometry[] = [];
    const solid: BufferGeometry[] = [];
    for (const kind of kinds) BUILDERS[kind](rng, foliage, solid);
    for (const [list, material, name] of [
      [foliage, this.#foliageMaterial, 'bank-foliage'],
      [solid, this.#solidMaterial, 'bank-stone'],
    ] as const) {
      if (list.length === 0) continue;
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new Mesh(merged, material);
      mesh.name = name;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  /** Bends the plants for a moment (explosions nearby). */
  gust(power: number): void {
    this.#gust.value = Math.min(2, this.#gust.value + power);
  }

  update(dt: number): void {
    this.#wind.value += dt * (1 + this.#gust.value * 2);
    this.#gust.value = Math.max(0, this.#gust.value - dt * 0.8);
  }

  dispose(): void {
    this.#clear();
    this.#foliageMaterial.dispose();
    this.#solidMaterial.dispose();
    this.group.removeFromParent();
  }

  #clear(): void {
    for (const child of [...this.group.children]) {
      (child as Mesh).geometry.dispose();
      child.removeFromParent();
    }
  }
}
