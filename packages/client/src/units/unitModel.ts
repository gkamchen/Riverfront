import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type Material, type Object3D } from 'three';
import type { Tweens } from '../anim/tweens';
import type { UnitRole, TeamId } from './roles';
import type { UnitBodyMaterial } from './unitMaterial';

export type UnitEmitKind = 'sparks' | 'smoke' | 'steam' | 'splash' | 'dust' | 'arc';

export interface WreckContext {
  tweens: Tweens;
  /** Cosmetic random in [0, 1). */
  random: () => number;
  /** Asks the effects layer for a puff at a world position (optional). */
  emit: (kind: UnitEmitKind, world: Vector3) => void;
}

export interface UnitFactoryOptions {
  team: TeamId;
  /** Per-unit body material (flash, scorch, char live in its uniforms). */
  body: UnitBodyMaterial;
}

/**
 * A unit's visual rig. Built in a canonical frame: x = column, z = row (row 0
 * towards the river), centred on the footprint centroid, front facing -z.
 * Factories fill in `idle` and `wreck` with role specific motion.
 */
export class UnitModel extends Group {
  readonly role: UnitRole;
  readonly body: UnitBodyMaterial;
  /** Optional mount point for a pennant. */
  flagAnchor: Object3D | null = null;
  idle: (time: number, dt: number) => void = () => undefined;
  wreck: (ctx: WreckContext) => Promise<void> = async () => undefined;

  constructor(role: UnitRole, body: UnitBodyMaterial) {
    super();
    this.role = role;
    this.body = body;
    this.name = `unit-model-${role}`;
  }

  /** World position of a point given in this model's local frame. */
  worldOf(local: Vector3, target = new Vector3()): Vector3 {
    this.updateWorldMatrix(true, false);
    return target.copy(local).applyMatrix4(this.matrixWorld);
  }
}

/** A pivot group placed at `at` holding `child` offset so it rotates around `at`. */
export function pivot(child: Object3D, at: Vector3): Group {
  const group = new Group();
  group.position.copy(at);
  child.position.sub(at);
  group.add(child);
  return group;
}

const puffGeometry = new SphereGeometry(1, 10, 8);
let puffMaterial: Material | null = null;

/**
 * Tiny self-contained steam/smoke puffs for idle loops (chimneys, exhausts).
 * Puffs rise, swell and shrink away; no transparency sorting needed.
 */
export class Puffs {
  readonly group = new Group();
  readonly #puffs: { mesh: Mesh; age: number; life: number; drift: number }[] = [];
  readonly #rate: number;
  readonly #size: number;
  #carry = 0;
  enabled = true;

  constructor(origin: Vector3, count = 5, rate = 1.6, size = 0.05) {
    puffMaterial ??= new MeshStandardMaterial({ color: 0xe8e4de, roughness: 1, transparent: true, opacity: 0.38, depthWrite: false });
    this.group.position.copy(origin);
    this.#rate = rate;
    this.#size = size;
    for (let i = 0; i < count; i++) {
      const mesh = new Mesh(puffGeometry, puffMaterial);
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.#puffs.push({ mesh, age: 0, life: 0, drift: 0 });
    }
  }

  update(dt: number): void {
    if (this.enabled) this.#carry += dt * this.#rate;
    while (this.#carry >= 1) {
      this.#carry -= 1;
      const free = this.#puffs.find((p) => !p.mesh.visible);
      if (!free) break;
      free.age = 0;
      free.life = 1.4 + Math.random() * 0.8;
      free.drift = (Math.random() - 0.5) * 0.12;
      free.mesh.visible = true;
    }
    for (const p of this.#puffs) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.set(p.drift * t * 3, t * 0.55, -t * 0.08);
      p.mesh.scale.setScalar(this.#size * (0.6 + t * 2.2) * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    }
  }
}
