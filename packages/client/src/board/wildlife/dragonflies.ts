import {
  CapsuleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { RIVER_SWIM_X, WATER_LEVEL } from '../layout';
import { disposeGroup, newGroup, type LifeModule, type WildlifeContext, type WildlifeQuality } from './shared';

const IDLE_TO_LAND = 20;

interface Fly {
  root: Group;
  wings: Mesh[];
  centre: Vector3;
  ax: number;
  az: number;
  fx: number;
  fz: number;
  phase: number;
  scatter: number;
  landing: 'none' | 'in' | 'landed' | 'out';
  t: number;
  from: Vector3;
}

/**
 * Dragonflies tracing Lissajous loops over the river. If the aim cursor rests
 * on a cell for 20 seconds, one of them comes down and perches on it.
 */
export class DragonflyModule implements LifeModule {
  readonly group = newGroup('dragonflies');
  readonly #ctx: WildlifeContext;
  readonly #body = new MeshStandardMaterial({ color: new Color('#1f8fa8'), emissive: new Color('#0a3a46'), metalness: 0.6, roughness: 0.25 });
  readonly #wing = new MeshStandardMaterial({ color: new Color('#e8f6ff'), transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false, roughness: 0.1 });
  #flies: Fly[] = [];
  #hover: Vector3 | null = null;
  #idle = 0;
  #lander: Fly | null = null;
  readonly #geometry = (() => {
    const body = new CapsuleGeometry(0.008, 0.11, 3, 6);
    body.rotateZ(Math.PI / 2);
    const wing = new PlaneGeometry(0.075, 0.016);
    wing.rotateX(-Math.PI / 2);
    wing.translate(0, 0, 0.04);
    return { body, head: new SphereGeometry(0.014, 8, 6), wing };
  })();

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    this.#build(ctx.quality);
  }

  setQuality(quality: WildlifeQuality): void {
    this.#build(quality);
  }

  trigger(event: string): boolean {
    if (event !== 'land') return false;
    this.#idle = IDLE_TO_LAND;
    return true;
  }

  /** Call whenever the hovered cell changes (null when the cursor leaves the board). */
  onHoverIdle(at: Vector3 | null): void {
    const moved = !at || !this.#hover || at.distanceToSquared(this.#hover) > 0.01;
    if (!moved) return;
    this.#hover = at ? at.clone() : null;
    this.#idle = 0;
    this.#release();
  }

  onExplosion(): void {
    for (const fly of this.#flies) fly.scatter = 2.5;
    this.#release();
  }

  update(dt: number): void {
    const time = this.#ctx.time;
    if (this.#hover) {
      this.#idle += dt;
      if (this.#idle >= IDLE_TO_LAND && !this.#lander && this.#flies.length > 0) {
        const fly = this.#flies[0]!;
        fly.landing = 'in';
        fly.t = 0;
        fly.from.copy(fly.root.position);
        this.#lander = fly;
      }
    }

    for (const fly of this.#flies) {
      fly.scatter = Math.max(0, fly.scatter - dt);
      const speed = 1 + fly.scatter * 1.5;
      fly.phase += dt * speed;
      const p = fly.phase;
      const path = new Vector3(
        fly.centre.x + Math.sin(p * fly.fx) * fly.ax * (1 + fly.scatter * 0.3),
        WATER_LEVEL + 0.45 + Math.sin(p * 2.3) * 0.12 + fly.scatter * 0.3,
        fly.centre.z + Math.sin(p * fly.fz + 1.3) * fly.az,
      );
      const flutter = Math.sin(time * 70 + fly.phase * 10);

      if (fly.landing === 'none') {
        this.#moveTo(fly, path);
      } else if (fly.landing === 'in' && this.#hover) {
        fly.t += dt;
        const u = Math.min(1, fly.t / 1.6);
        const e = u * u * (3 - 2 * u);
        const perch = this.#hover.clone().setY(this.#hover.y + 0.03);
        const target = fly.from.clone().lerp(perch, e);
        target.y += Math.sin(Math.PI * u) * 0.25;
        this.#moveTo(fly, target);
        if (u >= 1) fly.landing = 'landed';
      } else if (fly.landing === 'out') {
        fly.t += dt;
        const u = Math.min(1, fly.t / 1.2);
        const target = fly.from.clone().lerp(path, u * u);
        this.#moveTo(fly, target);
        if (u >= 1) fly.landing = 'none';
      }

      const resting = fly.landing === 'landed';
      fly.wings.forEach((wing, i) => {
        const side = i % 2 === 0 ? 1 : -1;
        wing.rotation.x = side * (resting ? 0.05 : 0.25 + flutter * 0.6);
      });
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #release(): void {
    const fly = this.#lander;
    if (!fly) return;
    fly.landing = 'out';
    fly.t = 0;
    fly.from.copy(fly.root.position);
    this.#lander = null;
  }

  #moveTo(fly: Fly, target: Vector3): void {
    const dx = target.x - fly.root.position.x;
    const dz = target.z - fly.root.position.z;
    if (dx * dx + dz * dz > 1e-6) fly.root.rotation.y = Math.atan2(-dz, dx);
    fly.root.position.copy(target);
  }

  #build(quality: WildlifeQuality): void {
    for (const fly of this.#flies) fly.root.removeFromParent();
    this.#flies = [];
    this.#lander = null;
    const rng = this.#ctx.rng;
    const count = quality === 'high' ? 4 : 1;
    const { body, head, wing } = this.#geometry;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const torso = new Mesh(body, this.#body);
      const eyes = new Mesh(head, this.#body);
      eyes.position.x = 0.065;
      root.add(torso, eyes);
      const wings: Mesh[] = [];
      for (const [x, side] of [
        [0.025, 1],
        [0.025, -1],
        [0.0, 1],
        [0.0, -1],
      ] as const) {
        const pivot = new Mesh(wing, this.#wing);
        pivot.position.set(x, 0.008, 0);
        pivot.scale.z = side;
        root.add(pivot);
        wings.push(pivot);
      }
      root.scale.setScalar(1.6);
      this.group.add(root);
      this.#flies.push({
        root,
        wings,
        centre: new Vector3(rng.range(-RIVER_SWIM_X + 3, RIVER_SWIM_X - 3), 0, rng.range(-0.6, 0.6)),
        ax: rng.range(1.5, 3.5),
        az: rng.range(0.6, 1.4),
        fx: rng.range(0.25, 0.45),
        fz: rng.range(0.5, 0.9),
        phase: rng.range(0, 20),
        scatter: 0,
        landing: 'none',
        t: 0,
        from: new Vector3(),
      });
    }
  }
}
