import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  CylinderGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { FIELD_OUTER_Z, FRAME_TOP, PLATE_HALF_X, PLATE_HALF_Z, TILE_TOP } from '../board/layout';
import { flagGeometry, flagMaterial } from '../units/flag';
import type { TeamId } from '../units/roles';
import { rand } from '../util/random';
import { ParticleSystem } from './particles';

const RAIN_TOP = 9;
const SPLASH = new Color('#c6d4dc');

/** Streaks of rain with little splashes on the board (defeat mood). */
export class Rain {
  readonly group = new Group();
  readonly #lines: LineSegments<BufferGeometry, LineBasicMaterial>;
  readonly #positions: Float32Array;
  readonly #speeds: Float32Array;
  readonly #splashes = new ParticleSystem(400, false);
  readonly #count: number;
  #target = 0;
  #level = 0;
  #active = 0;

  constructor(count = 900) {
    this.#count = count;
    this.#positions = new Float32Array(count * 6);
    this.#speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) this.#respawn(i, rand(0, RAIN_TOP));
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.#positions, 3).setUsage(DynamicDrawUsage));
    this.#lines = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: new Color('#a9bccb'), transparent: true, opacity: 0, depthWrite: false }),
    );
    this.#lines.frustumCulled = false;
    this.#lines.visible = false;
    this.group.add(this.#lines, this.#splashes.points);
    this.group.name = 'rain';
  }

  get level(): number {
    return this.#level;
  }

  setViewport(heightPx: number, fov: number): void {
    this.#splashes.setScale(heightPx, fov);
  }

  /** Fraction of drops in use (quality). */
  setDensity(density: number): void {
    this.#active = Math.max(1, Math.round(this.#count * Math.min(1, density)));
  }

  start(): void {
    this.#target = 1;
  }

  stop(): void {
    this.#target = 0;
  }

  update(dt: number): void {
    this.#level += (this.#target - this.#level) * Math.min(1, dt * 1.2);
    const visible = this.#level > 0.01;
    this.#lines.visible = visible;
    this.#lines.material.opacity = 0.38 * this.#level;
    if (visible) {
      const active = this.#active || this.#count;
      const p = this.#positions;
      for (let i = 0; i < this.#count; i++) {
        const fall = this.#speeds[i]! * dt;
        p[i * 6 + 1] = p[i * 6 + 1]! - fall;
        p[i * 6 + 4] = p[i * 6 + 4]! - fall;
        p[i * 6] = p[i * 6]! - fall * 0.12;
        p[i * 6 + 3] = p[i * 6 + 3]! - fall * 0.12;
        if (p[i * 6 + 4]! < TILE_TOP) {
          if (i < active && Math.random() < 0.25 * this.#level) {
            this.#splashes.emit({
              origin: new Vector3(p[i * 6]!, TILE_TOP + 0.01, p[i * 6 + 2]!),
              count: 2,
              speed: [0.4, 0.9],
              spread: 0.3,
              life: [0.15, 0.3],
              size: [0.025, 0.04],
              color: SPLASH,
              opacity: 0.6,
              gravity: 6,
            });
          }
          this.#respawn(i, RAIN_TOP);
        }
        if (i >= active) {
          // Parked out of sight when the quality tier asks for fewer drops.
          p[i * 6 + 1] = -50;
          p[i * 6 + 4] = -50;
        }
      }
      this.#lines.geometry.setDrawRange(0, active * 2);
      (this.#lines.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    }
    this.#splashes.update(dt);
  }

  clear(): void {
    this.#target = 0;
    this.#level = 0;
    this.#lines.visible = false;
    this.#splashes.clear();
  }

  dispose(): void {
    this.#lines.geometry.dispose();
    this.#lines.material.dispose();
    this.#splashes.dispose();
    this.group.removeFromParent();
  }

  #respawn(i: number, top: number): void {
    const x = rand(-PLATE_HALF_X - 3, PLATE_HALF_X + 3);
    const z = rand(-FIELD_OUTER_Z - 2, FIELD_OUTER_Z + 3);
    const y = top + rand(0, 1.5);
    const p = this.#positions;
    p[i * 6] = x;
    p[i * 6 + 1] = y;
    p[i * 6 + 2] = z;
    p[i * 6 + 3] = x + 0.035;
    p[i * 6 + 4] = y - 0.32;
    p[i * 6 + 5] = z;
    this.#speeds[i] = rand(8, 11);
  }
}

interface Banner {
  root: Group;
  flag: Mesh;
  top: number;
  lowered: number;
  target: number;
}

const POLE_HEIGHT = 2.6;

/**
 * A tall flagpole for each team on the frame corners. The loser's flag is
 * lowered at the end of a match; `raise` brings both back up.
 */
export class Banners {
  readonly group = new Group();
  readonly #banners: Record<TeamId, Banner>;

  constructor() {
    const pole = new MeshStandardMaterial({ color: new Color('#c9a75a'), metalness: 0.8, roughness: 0.3 });
    const make = (team: TeamId, x: number, z: number): Banner => {
      const root = new Group();
      root.position.set(x, FRAME_TOP, z);
      const shaft = new Mesh(new CylinderGeometry(0.025, 0.035, POLE_HEIGHT, 10), pole);
      shaft.position.y = POLE_HEIGHT / 2;
      shaft.castShadow = true;
      const knob = new Mesh(new SphereGeometry(0.06, 12, 8), pole);
      knob.position.y = POLE_HEIGHT + 0.04;
      const flag = new Mesh(flagGeometry(), flagMaterial(team));
      flag.scale.set(3.2, 3.2, 3.2);
      flag.castShadow = true;
      const top = POLE_HEIGHT - 0.05;
      flag.position.set(0.03, top, 0);
      // Fly away from the board so the flag never hangs over the play area.
      flag.rotation.y = x < 0 ? Math.PI : 0;
      root.add(shaft, knob, flag);
      this.group.add(root);
      return { root, flag, top, lowered: 0, target: 0 };
    };
    this.#banners = {
      blue: make('blue', -PLATE_HALF_X - 0.75, PLATE_HALF_Z + 0.75),
      red: make('red', PLATE_HALF_X + 0.75, -PLATE_HALF_Z - 0.75),
    };
    this.group.name = 'banners';
  }

  /** Frees poles and knobs; the flag cloth is shared with the units and stays. */
  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh && object.geometry !== flagGeometry()) {
        object.geometry.dispose();
        (object.material as MeshStandardMaterial).dispose();
      }
    });
    this.group.removeFromParent();
  }

  lower(team: TeamId): void {
    this.#banners[team].target = 1;
  }

  raise(team?: TeamId): void {
    for (const id of ['blue', 'red'] as const) if (!team || team === id) this.#banners[id].target = 0;
  }

  update(dt: number): void {
    for (const banner of Object.values(this.#banners)) {
      // Lowered slowly, like a ceremony; raised briskly.
      const speed = banner.target > banner.lowered ? 0.3 : 1.2;
      banner.lowered += Math.sign(banner.target - banner.lowered) * Math.min(Math.abs(banner.target - banner.lowered), dt * speed);
      banner.flag.position.y = banner.top - banner.lowered * (banner.top - 0.75);
    }
  }
}
