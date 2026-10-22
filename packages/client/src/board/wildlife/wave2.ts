import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { FIELD_OUTER_Z, OUTER_HALF_X, PLATE_HALF_X, RIVER_SWIM_X, RIVER_SWIM_Z, TABLE_Y, WATER_LEVEL } from '../layout';
import { Swarm } from './ambient';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext, type WildlifeQuality } from './shared';

function mesh(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const tmp = new Vector3();

// ------------------------------------------------------------------ fjord mist

/** Low banks of mist drifting over the water (fjords). */
export class MistModule implements LifeModule {
  readonly group = newGroup('mist');
  readonly #ctx: WildlifeContext;
  #swarm: Swarm;
  #speed = new Float32Array(0);

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    this.#swarm = this.#build(ctx.quality);
  }

  setQuality(quality: WildlifeQuality): void {
    this.#swarm.dispose();
    this.#swarm = this.#build(quality);
  }

  setScale(scale: number): void {
    this.#swarm.setScale(scale);
  }

  onExplosion(at: Vector3, power: number): void {
    // A blast parts the mist for a moment.
    const p = this.#swarm.positions;
    for (let i = 0; i < this.#swarm.count; i++) {
      const dx = p[i * 3]! - at.x;
      const dz = p[i * 3 + 2]! - at.z;
      const d = Math.hypot(dx, dz);
      if (d < 3) {
        p[i * 3] = p[i * 3]! + (dx / (d + 0.01)) * (3 - d) * 0.5 * power;
      }
    }
  }

  update(dt: number): void {
    const p = this.#swarm.positions;
    const time = this.#ctx.time;
    for (let i = 0; i < this.#swarm.count; i++) {
      p[i * 3] = p[i * 3]! + this.#speed[i]! * dt;
      p[i * 3 + 1] = 0.22 + Math.sin(time * 0.3 + i) * 0.06;
      if (p[i * 3]! > PLATE_HALF_X + 1) p[i * 3] = -PLATE_HALF_X - 1;
    }
    this.#swarm.commit(time);
  }

  dispose(): void {
    this.#swarm.dispose();
    this.group.removeFromParent();
  }

  #build(quality: WildlifeQuality): Swarm {
    const count = quality === 'high' ? 46 : 18;
    // Large, faint sprites (the swarm shader draws them at ~40% size between twinkles).
    const swarm = new Swarm(count, new Color(1.5, 1.6, 1.7), 7, false, 1);
    swarm.intensity = 0.16;
    const rng = this.#ctx.rng;
    this.#speed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      swarm.positions[i * 3] = rng.range(-PLATE_HALF_X - 1, PLATE_HALF_X + 1);
      swarm.positions[i * 3 + 1] = 0.22;
      swarm.positions[i * 3 + 2] = rng.range(-1.7, 1.7);
      this.#speed[i] = rng.range(0.05, 0.16);
    }
    this.group.add(swarm.points);
    return swarm;
  }
}

// ------------------------------------------------------------------ koi

interface Koi {
  root: Group;
  angle: number;
  radius: number;
  centre: Vector3;
  speed: number;
  leap: number;
  from: Vector3;
  to: Vector3;
}

/** Koi circling just under the surface; now and then one leaps. */
export class KoiModule implements LifeModule {
  readonly group = newGroup('koi');
  readonly #ctx: WildlifeContext;
  readonly #fish: Koi[] = [];
  #next: number;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const orange = new MeshStandardMaterial({ color: new Color('#f0661c'), roughness: 0.35 });
    const white = new MeshStandardMaterial({ color: new Color('#f4f0e6'), roughness: 0.35 });
    const black = new MeshStandardMaterial({ color: new Color('#1a1614'), roughness: 0.4 });
    const looks: Array<[Material, Material]> = [
      [orange, white],
      [white, orange],
      [orange, black],
      [white, black],
    ];
    const count = ctx.high ? 6 : 3;
    for (let i = 0; i < count; i++) {
      const [skin, patch] = looks[i % looks.length]!;
      const root = new Group();
      const body = mesh(new SphereGeometry(0.05, 12, 8), skin);
      body.scale.set(2.6, 0.75, 0.9);
      const spot = mesh(new SphereGeometry(0.035, 10, 6), patch, 0.02, 0.018, 0);
      spot.scale.set(1.6, 0.5, 1);
      const head = mesh(new SphereGeometry(0.035, 10, 6), patch === black ? skin : patch, 0.1, 0.005, 0);
      const tail = mesh(new ConeGeometry(0.04, 0.09, 6), skin, -0.16, 0, 0);
      tail.rotation.z = Math.PI / 2;
      tail.scale.set(1, 1, 0.25);
      root.add(body, spot, head, tail);
      root.scale.setScalar(1.5);
      this.group.add(root);
      this.#fish.push({
        root,
        angle: ctx.rng.range(0, 6),
        radius: ctx.rng.range(0.4, 0.9),
        centre: new Vector3(ctx.rng.range(-RIVER_SWIM_X + 2, RIVER_SWIM_X - 2), 0, ctx.rng.range(-0.5, 0.5)),
        speed: ctx.rng.range(0.4, 0.7) * (ctx.rng.chance(0.5) ? 1 : -1),
        leap: -1,
        from: new Vector3(),
        to: new Vector3(),
      });
    }
    this.#next = ctx.rng.range(3, 7);
  }

  trigger(event: string): boolean {
    if (event !== 'koi' && event !== 'jump') return false;
    this.#jump();
    return true;
  }

  onExplosion(at: Vector3): void {
    for (const f of this.#fish) if (flatDistance(f.root.position, at) < 3) f.speed *= 2.5;
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    this.#next -= dt;
    if (this.#next <= 0) {
      this.#next = ctx.rng.range(4, 9);
      this.#jump();
    }
    for (const f of this.#fish) {
      f.speed += (Math.sign(f.speed) * 0.55 - f.speed) * dt * 0.5;
      if (f.leap >= 0) {
        f.leap += dt / 0.8;
        const u = Math.min(1, f.leap);
        f.root.position.lerpVectors(f.from, f.to, u);
        f.root.position.y = WATER_LEVEL - 0.05 + Math.sin(Math.PI * u) * 0.38;
        f.root.rotation.set(0, Math.atan2(-(f.to.z - f.from.z), f.to.x - f.from.x), Math.cos(Math.PI * u) * 0.9);
        if (u >= 1) {
          f.leap = -1;
          ctx.splash(tmp.copy(f.to).setY(WATER_LEVEL), 0.45);
          ctx.sound('plop', f.to);
        }
        continue;
      }
      f.angle += (f.speed / f.radius) * dt;
      const x = f.centre.x + Math.cos(f.angle) * f.radius;
      const z = Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, f.centre.z + Math.sin(f.angle) * f.radius * 0.6));
      f.root.position.set(x, WATER_LEVEL - 0.06, z);
      f.root.rotation.set(0, -f.angle - Math.sign(f.speed) * Math.PI / 2, Math.sin(ctx.time * 6 + f.angle) * 0.05);
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #jump(): void {
    const f = this.#fish.find((k) => k.leap < 0);
    if (!f) return;
    f.from.copy(f.root.position);
    const dir = this.#ctx.rng.range(0, Math.PI * 2);
    f.to.set(f.from.x + Math.cos(dir) * 0.7, WATER_LEVEL, Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, f.from.z + Math.sin(dir) * 0.4)));
    f.leap = 0;
    this.#ctx.splash(tmp.copy(f.from).setY(WATER_LEVEL), 0.35);
  }
}

// ------------------------------------------------------------------ cherry petals

/** Cherry blossom petals drifting down over the whole table. */
export class PetalsModule implements LifeModule {
  readonly group = newGroup('petals');
  readonly #ctx: WildlifeContext;
  #swarm: Swarm;
  #fall = new Float32Array(0);

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    this.#swarm = this.#build(ctx.quality);
  }

  setQuality(quality: WildlifeQuality): void {
    this.#swarm.dispose();
    this.#swarm = this.#build(quality);
  }

  setScale(scale: number): void {
    this.#swarm.setScale(scale);
  }

  update(dt: number): void {
    const p = this.#swarm.positions;
    const time = this.#ctx.time;
    for (let i = 0; i < this.#swarm.count; i++) {
      p[i * 3] = p[i * 3]! + (Math.sin(time * 0.9 + i) * 0.25 + 0.2) * dt;
      p[i * 3 + 1] = p[i * 3 + 1]! - this.#fall[i]! * dt;
      p[i * 3 + 2] = p[i * 3 + 2]! + Math.cos(time * 0.7 + i * 1.3) * 0.12 * dt;
      if (p[i * 3 + 1]! < 0.22) this.#respawn(i, 5);
    }
    this.#swarm.commit(time);
  }

  dispose(): void {
    this.#swarm.dispose();
    this.group.removeFromParent();
  }

  #respawn(i: number, y: number): void {
    const rng = this.#ctx.rng;
    const p = this.#swarm.positions;
    p[i * 3] = rng.range(-PLATE_HALF_X - 2, PLATE_HALF_X + 2);
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = rng.range(-FIELD_OUTER_Z, FIELD_OUTER_Z);
    this.#fall[i] = rng.range(0.18, 0.35);
  }

  #build(quality: WildlifeQuality): Swarm {
    const count = quality === 'high' ? 180 : 60;
    const swarm = new Swarm(count, new Color(1.5, 0.95, 1.1), 0.06, false, 1);
    this.#swarm = swarm;
    this.#fall = new Float32Array(count);
    for (let i = 0; i < count; i++) this.#respawn(i, this.#ctx.rng.range(0.3, 5));
    this.group.add(swarm.points);
    return swarm;
  }
}

// ------------------------------------------------------------------ paper dragon

/** A long paper dragon kite snaking through the air above the river. */
export class DragonKiteModule implements LifeModule {
  readonly group = newGroup('dragon-kite');
  readonly #ctx: WildlifeContext;
  readonly #segments: Object3D[] = [];
  #gust = 0;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const red = new MeshStandardMaterial({ color: new Color('#c8281e'), roughness: 0.7 });
    const gold = new MeshStandardMaterial({ color: new Color('#e8b33a'), roughness: 0.5 });
    const green = new MeshStandardMaterial({ color: new Color('#2f8a5a'), roughness: 0.7 });
    const count = ctx.high ? 16 : 10;
    const headGroup = new Group();
    const skull = mesh(new BoxGeometry(0.3, 0.2, 0.22), red);
    const jaw = mesh(new BoxGeometry(0.22, 0.06, 0.18), gold, 0.08, -0.1, 0);
    const eyes = [-1, 1].map((s) => mesh(new SphereGeometry(0.04, 8, 6), gold, 0.08, 0.06, s * 0.1));
    const horns = [-1, 1].map((s) => {
      const h = mesh(new ConeGeometry(0.025, 0.18, 5), gold, -0.08, 0.15, s * 0.07);
      h.rotation.z = 0.8;
      return h;
    });
    const beard = mesh(new ConeGeometry(0.04, 0.14, 5), green, 0.12, -0.16, 0);
    beard.rotation.z = Math.PI;
    headGroup.add(skull, jaw, beard, ...eyes, ...horns);
    this.group.add(headGroup);
    this.#segments.push(headGroup);
    for (let i = 1; i < count; i++) {
      const seg = mesh(new CylinderGeometry(0.11 - i * 0.004, 0.11 - i * 0.004, 0.16, 10), i % 2 ? red : gold);
      const ring = new Group();
      ring.add(seg);
      seg.rotation.z = Math.PI / 2;
      if (i % 3 === 0) {
        const fin = mesh(new ConeGeometry(0.04, 0.12, 4), green, 0, 0.12, 0);
        ring.add(fin);
      }
      this.group.add(ring);
      this.#segments.push(ring);
    }
  }

  trigger(event: string): boolean {
    if (event !== 'kite') return false;
    this.#gust = 3;
    return true;
  }

  onExplosion(_at: Vector3, power: number): void {
    this.#gust = Math.min(3, this.#gust + power);
  }

  update(dt: number): void {
    const t = this.#ctx.time;
    this.#gust = Math.max(0, this.#gust - dt);
    const path = (time: number, out: Vector3) =>
      out.set(Math.sin(time * 0.11) * (PLATE_HALF_X - 3), 3.2 + Math.sin(time * 0.7) * 0.35 + this.#gust * 0.2 * Math.sin(time * 4), Math.sin(time * 0.23) * 1.2);
    const prev = new Vector3();
    this.#segments.forEach((seg, i) => {
      path(t - i * 0.16, seg.position);
      seg.position.y += Math.sin(t * 3 - i * 0.6) * 0.08;
      if (i > 0) {
        prev.copy(this.#segments[i - 1]!.position);
        seg.lookAt(prev);
        seg.rotateY(Math.PI / 2);
      } else {
        path(t + 0.16, tmp);
        seg.lookAt(tmp);
        seg.rotateY(-Math.PI / 2);
      }
    });
  }

  dispose(): void {
    disposeGroup(this.group);
  }
}

// ------------------------------------------------------------------ bank walkers

export type WalkerStyle = 'camels' | 'wolves' | 'llamas' | 'dogs' | 'jaguars' | 'lions' | 'tigers' | 'horses' | 'peacocks';

interface Walker {
  root: Group;
  offset: number;
  head: Group;
}

interface Quad {
  coat: string;
  belly?: string;
  spots?: string;
  /** Dark bands across the back (tigers). */
  stripes?: string;
  /** A ruff round the neck (lions) or a crest along it (horses). */
  mane?: string;
  /** Body length and height of the back above the ground. */
  length: number;
  height: number;
  neck: number;
  neckTilt: number;
  head: number;
  tail: number;
  ears: number;
}

const QUADS: Record<Exclude<WalkerStyle, 'camels' | 'peacocks'>, Quad> = {
  lions: { coat: '#c8a062', belly: '#e0c898', mane: '#7a4e26', length: 0.5, height: 0.32, neck: 0.1, neckTilt: -0.8, head: 0.15, tail: 0.32, ears: 0.035 },
  tigers: { coat: '#d8782a', belly: '#f0e4d0', stripes: '#1e1410', length: 0.52, height: 0.3, neck: 0.1, neckTilt: -0.9, head: 0.14, tail: 0.34, ears: 0.035 },
  horses: { coat: '#7a4e30', belly: '#8a5e3c', mane: '#2a1c14', length: 0.46, height: 0.46, neck: 0.26, neckTilt: -0.45, head: 0.17, tail: 0.24, ears: 0.045 },
  wolves: { coat: '#7a7670', belly: '#b8b2a8', length: 0.42, height: 0.32, neck: 0.12, neckTilt: -0.5, head: 0.14, tail: 0.22, ears: 0.05 },
  llamas: { coat: '#e8e0d0', belly: '#a8784a', length: 0.4, height: 0.46, neck: 0.36, neckTilt: -0.1, head: 0.12, tail: 0.08, ears: 0.07 },
  dogs: { coat: '#8a5a32', belly: '#d8c0a0', length: 0.3, height: 0.24, neck: 0.1, neckTilt: -0.6, head: 0.11, tail: 0.14, ears: 0.04 },
  jaguars: { coat: '#d8a040', belly: '#f0e0c0', spots: '#2a1c12', length: 0.48, height: 0.28, neck: 0.1, neckTilt: -0.9, head: 0.13, tail: 0.34, ears: 0.035 },
};

/** A generic four-legged animal facing −x, feet on y = 0. */
function quadruped(q: Quad, materials: Map<string, MeshStandardMaterial>): { root: Group; head: Group } {
  const mat = (c: string) => {
    let m = materials.get(c);
    if (!m) {
      m = new MeshStandardMaterial({ color: new Color(c), roughness: 0.8 });
      materials.set(c, m);
    }
    return m;
  };
  const root = new Group();
  const coat = mat(q.coat);
  const body = mesh(new CapsuleGeometry(q.height * 0.32, q.length, 4, 10), coat, 0, q.height, 0);
  body.rotation.z = Math.PI / 2;
  root.add(body);
  if (q.belly) {
    const belly = mesh(new SphereGeometry(q.height * 0.28, 10, 6), mat(q.belly), 0, q.height - q.height * 0.12, 0);
    belly.scale.set((q.length / q.height) * 1.6, 0.6, 0.9);
    root.add(belly);
  }
  if (q.stripes) {
    for (let i = 0; i < 6; i++) {
      const band = mesh(new BoxGeometry(0.025, 0.012, q.height * 0.62), mat(q.stripes), -q.length / 2 + 0.04 + (i / 5) * (q.length - 0.08), q.height + q.height * 0.24, 0);
      band.rotation.y = (i % 2 ? 1 : -1) * 0.25;
      root.add(band);
    }
  }
  if (q.mane && q.neck < 0.2) {
    // A full ruff round the head and neck.
    const ruff = mesh(new SphereGeometry(q.head * 0.62, 10, 8), mat(q.mane), -q.length / 2 - q.neck * 0.3, q.height + q.neck * 0.7, 0);
    ruff.scale.set(0.8, 1, 1.1);
    root.add(ruff);
  } else if (q.mane) {
    const crest = mesh(new BoxGeometry(0.03, q.neck * 1.1, 0.02), mat(q.mane), -q.length / 2 - q.neck * 0.22, q.height + q.neck * 0.5, 0);
    crest.rotation.z = q.neckTilt;
    root.add(crest);
  }
  if (q.spots) for (let i = 0; i < 7; i++) root.add(mesh(new SphereGeometry(0.02, 6, 4), mat(q.spots), -q.length / 2 + (i / 6) * q.length, q.height + q.height * 0.27, ((i % 3) - 1) * 0.05));
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) root.add(mesh(new CylinderGeometry(0.022, 0.018, q.height, 6), coat, x * q.length * 0.38, q.height / 2, z * q.height * 0.18));
  const neck = mesh(new CapsuleGeometry(q.height * 0.13, q.neck, 3, 6), coat, -q.length / 2 - q.neck * 0.3, q.height + q.neck * 0.4, 0);
  neck.rotation.z = q.neckTilt;
  root.add(neck);
  const head = new Group();
  head.position.set(-q.length / 2 - q.neck * 0.55, q.height + q.neck * 0.85, 0);
  head.add(mesh(new BoxGeometry(q.head, q.head * 0.5, q.head * 0.55), coat));
  for (const s of [-1, 1]) head.add(mesh(new ConeGeometry(q.ears * 0.45, q.ears, 4), coat, q.head * 0.25, q.head * 0.35, s * q.head * 0.2));
  root.add(head);
  const tail = mesh(new CylinderGeometry(0.012, 0.02, q.tail, 5), coat, q.length / 2 + q.tail * 0.35, q.height + 0.02, 0);
  tail.rotation.z = -1.0;
  root.add(tail);
  return { root, head };
}

/** A peacock facing −x; the first of a group walks with its train fanned. */
function peacock(materials: Map<string, MeshStandardMaterial>, fanned: boolean): { root: Group; head: Group } {
  const mat = (c: string) => {
    let m = materials.get(c);
    if (!m) {
      m = new MeshStandardMaterial({ color: new Color(c), roughness: 0.55 });
      materials.set(c, m);
    }
    return m;
  };
  const root = new Group();
  const blue = mat('#1e4aa8');
  const green = mat('#2a7a5a');
  const eye = mat('#d8b040');
  const body = mesh(new SphereGeometry(0.07, 10, 8), blue, 0, 0.16, 0);
  body.scale.set(1.4, 1, 0.9);
  const neck = mesh(new CapsuleGeometry(0.025, 0.1, 3, 6), blue, -0.07, 0.24, 0);
  neck.rotation.z = -0.3;
  root.add(body, neck);
  for (const z of [-0.025, 0.025]) root.add(mesh(new CylinderGeometry(0.007, 0.006, 0.12, 4), mat('#8a7a6a'), 0, 0.06, z));
  const head = new Group();
  head.position.set(-0.1, 0.31, 0);
  head.add(mesh(new SphereGeometry(0.028, 8, 6), blue));
  head.add(mesh(new ConeGeometry(0.008, 0.03, 4), mat('#c8b490'), -0.03, 0, 0));
  for (let i = -1; i <= 1; i++) head.add(mesh(new SphereGeometry(0.008, 4, 3), eye, 0.005 + i * 0.008, 0.05, 0));
  root.add(head);
  if (fanned) {
    // The train raised in a half wheel with a ring of eyes.
    const fan = mesh(new CylinderGeometry(0.3, 0.3, 0.012, 20, 1, false, 0, Math.PI), green, 0.09, 0.2, 0);
    fan.rotation.set(0, 0, Math.PI / 2 - 0.25);
    root.add(fan);
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI;
      const spot = mesh(new SphereGeometry(0.022, 6, 4), i % 2 ? blue : eye, 0.1 + Math.sin(a) * 0.06, 0.2 + Math.sin(a) * 0.24, Math.cos(a) * 0.24);
      spot.scale.set(0.4, 1, 1);
      root.add(spot);
    }
  } else {
    const train = mesh(new BoxGeometry(0.34, 0.015, 0.09), green, 0.22, 0.12, 0);
    train.rotation.z = 0.12;
    root.add(train);
  }
  return { root, head };
}

/**
 * Animals walking along the table beyond one end of the board: a camel
 * caravan, a wolf pack, llamas, hunting dogs, horses, peacocks or a
 * prowling big cat.
 */
export class CaravanModule implements LifeModule {
  readonly group: Group;
  readonly #ctx: WildlifeContext;
  readonly #walkers: Walker[] = [];
  readonly #style: WalkerStyle;
  #z = -4;
  #dir = 1;

  constructor(ctx: WildlifeContext, style: WalkerStyle = 'camels') {
    this.#ctx = ctx;
    this.#style = style;
    this.group = newGroup(`walkers-${style}`);
    const count = style === 'jaguars' || style === 'tigers' ? 1 : style === 'lions' ? 2 : ctx.high ? (style === 'peacocks' ? 3 : 4) : 2;
    const materials = new Map<string, MeshStandardMaterial>();
    for (let i = 0; i < count; i++) {
      let root: Group;
      let head: Group;
      if (style === 'camels') {
        const coat = new MeshStandardMaterial({ color: new Color('#c49a62'), roughness: 0.8 });
        const cloth = new MeshStandardMaterial({ color: new Color('#8a2f3a'), roughness: 0.8 });
        const pack = new MeshStandardMaterial({ color: new Color('#d8c49a'), roughness: 0.9 });
        root = new Group();
        const body = mesh(new CapsuleGeometry(0.11, 0.3, 4, 10), coat, 0, 0.55, 0);
        body.rotation.z = Math.PI / 2;
        const hump = mesh(new SphereGeometry(0.1, 10, 8), coat, 0.02, 0.68, 0);
        const neck = mesh(new CapsuleGeometry(0.045, 0.28, 3, 6), coat, -0.27, 0.68, 0);
        neck.rotation.z = -0.7;
        head = new Group();
        head.position.set(-0.4, 0.82, 0);
        head.add(mesh(new BoxGeometry(0.16, 0.07, 0.07), coat));
        root.add(body, hump, neck, head);
        for (const [x, z] of [[-0.15, -0.07], [-0.15, 0.07], [0.15, -0.07], [0.15, 0.07]] as const) root.add(mesh(new CylinderGeometry(0.022, 0.018, 0.48, 6), coat, x, 0.24, z));
        root.add(mesh(new BoxGeometry(0.26, 0.12, 0.3), i === 0 ? cloth : pack, 0.06, 0.74, 0));
      } else if (style === 'peacocks') {
        ({ root, head } = peacock(materials, i === 0));
      } else {
        ({ root, head } = quadruped(QUADS[style], materials));
      }
      root.scale.setScalar(1.2);
      this.group.add(root);
      this.#walkers.push({ root, offset: i * (style === 'camels' ? 0.9 : 0.7), head });
    }
  }

  update(dt: number): void {
    const t = this.#ctx.time;
    const speed = this.#style === 'jaguars' || this.#style === 'tigers' || this.#style === 'lions' ? 0.25 : this.#style === 'peacocks' ? 0.15 : this.#style === 'wolves' || this.#style === 'dogs' || this.#style === 'horses' ? 0.5 : 0.35;
    this.#z += this.#dir * speed * dt;
    if (Math.abs(this.#z) > 4.5) this.#dir *= -1;
    const pace = this.#style === 'camels' ? 3 : 5;
    for (const w of this.#walkers) {
      const z = this.#z - this.#dir * w.offset;
      w.root.position.set(OUTER_HALF_X + 1.3 + (w.offset % 1.4) * 0.3, TABLE_Y + Math.abs(Math.sin(t * pace + w.offset)) * 0.02, z);
      w.root.rotation.set(0, this.#dir > 0 ? -Math.PI / 2 : Math.PI / 2, Math.sin(t * pace + w.offset) * 0.03);
      w.head.rotation.z = Math.sin(t * 1.3 + w.offset * 2) * 0.15;
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }
}
