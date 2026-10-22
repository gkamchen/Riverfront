import { CapsuleGeometry, Color, ConeGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { PLATE_HALF_X, RIVER_SWIM_X, RIVER_SWIM_Z, WATER_LEVEL } from '../layout';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext } from './shared';

interface Salamander {
  root: Group;
  spine: Group[];
  from: Vector3;
  to: Vector3;
  t: number;
  duration: number;
  height: number;
  active: boolean;
}

const EMBER = new Color(3.5, 1.3, 0.3);
const EMBER_END = new Color(1.2, 0.15, 0.02);
const TRAIL = new Color(4, 1.6, 0.4);

/** Fire salamanders leaping out of the lava river. */
export class SalamanderModule implements LifeModule {
  readonly group = newGroup('salamanders');
  readonly #ctx: WildlifeContext;
  readonly #lizards: Salamander[] = [];
  #next: number;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const skin = new MeshStandardMaterial({ color: new Color('#2a120a'), emissive: new Color('#ff5a12'), emissiveIntensity: 1.4, roughness: 0.5 });
    const spots = new MeshStandardMaterial({ color: new Color('#ffcf40'), emissive: new Color('#ffb020'), emissiveIntensity: 2.2 });
    const count = ctx.high ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const spine: Group[] = [];
      let parent: Group = root;
      // Head, then three body links that undulate.
      for (let k = 0; k < 4; k++) {
        const link = new Group();
        link.position.x = k === 0 ? 0 : -0.07;
        const seg =
          k === 3
            ? new Mesh(new ConeGeometry(0.022, 0.14, 6), skin)
            : new Mesh(new CapsuleGeometry(k === 0 ? 0.028 : 0.032, 0.04, 3, 8), skin);
        seg.rotation.z = Math.PI / 2;
        if (k === 3) seg.position.x = -0.05;
        link.add(seg);
        if (k === 1 || k === 2) {
          for (const side of [-1, 1]) {
            const spot = new Mesh(new SphereGeometry(0.012, 6, 4), spots);
            spot.position.set(0, 0.024, side * 0.015);
            link.add(spot);
            const leg = new Mesh(new CapsuleGeometry(0.008, 0.035, 2, 4), skin);
            leg.position.set(0, -0.012, side * 0.035);
            leg.rotation.x = side * 1.1;
            link.add(leg);
          }
        }
        parent.add(link);
        spine.push(link);
        parent = link;
      }
      root.scale.setScalar(1.6);
      root.visible = false;
      this.group.add(root);
      this.#lizards.push({ root, spine, from: new Vector3(), to: new Vector3(), t: 0, duration: 1, height: 0.4, active: false });
    }
    this.#next = ctx.rng.range(2, 5);
  }

  trigger(event: string): boolean {
    if (event !== 'salamander') return false;
    this.#leap();
    return true;
  }

  onExplosion(at: Vector3): void {
    if (Math.abs(at.z) < 6) {
      this.#leap(at);
      this.#leap(at);
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    this.#next -= dt;
    if (this.#next <= 0) {
      this.#next = ctx.rng.range(3.5, 8) * (ctx.high ? 1 : 1.5);
      this.#leap();
    }
    for (const s of this.#lizards) {
      if (!s.active) continue;
      s.t += dt;
      const u = Math.min(1, s.t / s.duration);
      s.root.position.lerpVectors(s.from, s.to, u);
      s.root.position.y = WATER_LEVEL + 4 * s.height * u * (1 - u);
      const dir = Math.atan2(-(s.to.z - s.from.z), s.to.x - s.from.x);
      s.root.rotation.set(0, dir, Math.atan2(4 * s.height * (1 - 2 * u), flatDistance(s.from, s.to)));
      s.spine.forEach((link, k) => {
        if (k > 0) link.rotation.y = Math.sin(ctx.time * 14 - k * 1.2) * 0.35;
      });
      if (ctx.rng.chance(0.6)) {
        ctx.glow.emit({
          origin: s.root.position,
          count: 1,
          radius: 0.03,
          speed: [0.05, 0.2],
          spread: 1,
          life: [0.3, 0.6],
          size: [0.05, 0.09],
          color: TRAIL,
          colorEnd: EMBER_END,
          drag: 2,
        });
      }
      if (u >= 1) {
        s.active = false;
        s.root.visible = false;
        ctx.splash(s.to, 0.9);
        ctx.sound('sizzle', s.to);
      }
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #leap(near?: Vector3): void {
    const ctx = this.#ctx;
    const s = this.#lizards.find((l) => !l.active);
    if (!s) return;
    const x = near ? near.x + ctx.rng.range(-2, 2) : ctx.rng.range(-RIVER_SWIM_X, RIVER_SWIM_X);
    s.from.set(Math.max(-RIVER_SWIM_X, Math.min(RIVER_SWIM_X, x)), WATER_LEVEL, ctx.rng.range(-RIVER_SWIM_Z, RIVER_SWIM_Z));
    const angle = ctx.rng.range(0, Math.PI * 2);
    const distance = ctx.rng.range(0.7, 1.2);
    s.to.set(s.from.x + Math.cos(angle) * distance, WATER_LEVEL, Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, s.from.z + Math.sin(angle) * distance * 0.6)));
    s.t = 0;
    s.duration = ctx.rng.range(0.8, 1.1);
    s.height = ctx.rng.range(0.35, 0.6);
    s.active = true;
    s.root.visible = true;
    ctx.splash(s.from, 0.7);
  }
}

/** Sparks rising off the lava all along the river. */
export class EmbersModule implements LifeModule {
  readonly group = newGroup('embers');
  readonly #ctx: WildlifeContext;
  #carry = 0;
  #burst = 0;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
  }

  onExplosion(at: Vector3, power: number): void {
    this.#burst = 1.5;
    this.#ctx.glow.emit({
      origin: at,
      count: Math.round(40 * power * (this.#ctx.high ? 1 : 0.5)),
      radius: 0.4,
      speed: [0.6, 2],
      spread: 0.5,
      lift: 1,
      life: [1, 2.2],
      size: [0.03, 0.06],
      color: EMBER,
      colorEnd: EMBER_END,
      gravity: -0.4,
      drag: 1.2,
    });
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    this.#burst = Math.max(0, this.#burst - dt);
    this.#carry += dt * (ctx.high ? 26 : 10) * (1 + this.#burst);
    const origin = new Vector3();
    while (this.#carry >= 1) {
      this.#carry -= 1;
      origin.set(ctx.rng.range(-PLATE_HALF_X, PLATE_HALF_X), WATER_LEVEL + 0.02, ctx.rng.range(-RIVER_SWIM_Z - 0.2, RIVER_SWIM_Z + 0.2));
      ctx.glow.emit({
        origin,
        count: 1,
        speed: [0.05, 0.25],
        spread: 0.3,
        lift: ctx.rng.range(0.25, 0.7),
        life: [1.5, 3.2],
        size: [0.025, 0.05],
        color: EMBER,
        colorEnd: EMBER_END,
        gravity: -0.05,
        drag: 0.4,
      });
    }
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
