import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Shape,
  Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { easeOutBack } from '../anim/easing';
import { COLS, ROWS, TILE_TOP, cellCenter, type Side } from './layout';

export type ResultKind = 'earth' | 'rock' | 'unit';

interface Placed {
  mesh: InstancedMesh;
  index: number;
  position: Vector3;
  spin: number;
  age: number;
}

const CAPACITY = COLS * ROWS * 2;
const hidden = new Matrix4().makeScale(0, 0, 0);
const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);

function crossGeometry(): BufferGeometry {
  const a = new BoxGeometry(0.5, 0.03, 0.1);
  a.rotateY(Math.PI / 4);
  const b = new BoxGeometry(0.5, 0.03, 0.1);
  b.rotateY(-Math.PI / 4);
  const merged = mergeGeometries([a, b]);
  merged.translate(0, 0.015, 0);
  return merged;
}

function burstGeometry(): BufferGeometry {
  const shape = new Shape();
  const points = 8;
  for (let i = 0; i <= points * 2; i++) {
    const a = (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.15 : 0.065;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const geometry = new ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function diamondGeometry(): BufferGeometry {
  const geometry = new OctahedronGeometry(0.1, 0);
  geometry.scale(1, 1.5, 1);
  geometry.translate(0, 0.15, 0);
  return geometry;
}

/**
 * Small persistent symbols on revealed cells so the board reads at a glance:
 * an X on plain earth, a floating diamond on rock and a burst on hit units.
 */
export class ResultMarkers {
  readonly group = new Group();
  readonly #meshes: Record<ResultKind, InstancedMesh>;
  readonly #used: Record<ResultKind, number> = { earth: 0, rock: 0, unit: 0 };
  readonly #placed: Placed[] = [];
  readonly #cells = new Set<string>();
  #time = 0;

  constructor() {
    const make = (geometry: BufferGeometry, color: string, emissive: string, intensity: number) => {
      const material = new MeshStandardMaterial({ color: new Color(color), emissive: new Color(emissive), emissiveIntensity: intensity, roughness: 0.45, metalness: 0.1 });
      const mesh = new InstancedMesh(geometry, material, CAPACITY);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      return mesh;
    };
    this.#meshes = {
      earth: make(crossGeometry(), '#f3e9d2', '#3a2c1a', 0.25),
      rock: make(diamondGeometry(), '#9cc3ea', '#2a5d9c', 0.55),
      unit: make(burstGeometry(), '#ff7a2a', '#ff4a10', 0.9),
    };
    this.group.name = 'result-markers';
  }

  /** Adds (once) the marker for a revealed cell. */
  mark(side: Side, col: number, row: number, kind: ResultKind): void {
    const key = `${side}:${col}:${row}`;
    if (this.#cells.has(key)) return;
    const mesh = this.#meshes[kind];
    const index = this.#used[kind]++;
    if (index >= CAPACITY) return;
    this.#cells.add(key);
    mesh.count = this.#used[kind];

    const position = cellCenter(side, col, row, TILE_TOP + 0.004);
    // Earth gets a centred X; rocks and units keep the centre for their piece.
    if (kind !== 'earth') position.add(new Vector3(0.3, 0, 0.3));
    this.#placed.push({ mesh, index, position, spin: kind === 'earth' ? 0 : (col * 7 + row * 3) % 6, age: 0 });
    mesh.setMatrixAt(index, hidden);
    mesh.instanceMatrix.needsUpdate = true;
  }

  has(side: Side, col: number, row: number): boolean {
    return this.#cells.has(`${side}:${col}:${row}`);
  }

  clear(): void {
    for (const kind of ['earth', 'rock', 'unit'] as const) {
      this.#used[kind] = 0;
      this.#meshes[kind].count = 0;
    }
    this.#placed.length = 0;
    this.#cells.clear();
  }

  update(dt: number): void {
    this.#time += dt;
    const rock = this.#meshes.rock;
    let rockDirty = false;
    for (const placed of this.#placed) {
      const popping = placed.age < 0.45;
      const isRock = placed.mesh === rock;
      if (!popping && !isRock) continue;
      placed.age += dt;
      const s = Math.max(0.001, easeOutBack(Math.min(1, placed.age / 0.45)));
      const bob = isRock ? Math.sin(this.#time * 1.6 + placed.spin) * 0.02 : 0;
      tmpQuat.setFromAxisAngle(Y_AXIS, placed.spin + (isRock ? this.#time * 0.8 : 0));
      tmpScale.setScalar(s);
      tmpMatrix.compose(placed.position.clone().setY(placed.position.y + bob), tmpQuat, tmpScale);
      placed.mesh.setMatrixAt(placed.index, tmpMatrix);
      placed.mesh.instanceMatrix.needsUpdate = true;
      if (isRock) rockDirty = true;
    }
    if (rockDirty) rock.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of Object.values(this.#meshes)) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    this.group.removeFromParent();
  }
}
