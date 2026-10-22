import { CapsuleGeometry, Color, ConeGeometry, DodecahedronGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { FIELD_OUTER_Z, PLATE_HALF_X, RIVER_SWIM_X, WATER_LEVEL } from '../layout';
import { Swarm } from './ambient';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext, type WildlifeQuality } from './shared';

type SealState = 'rest' | 'dive' | 'under' | 'surface';

interface Seal {
  root: Group;
  head: Group;
  hole: number;
  home: Vector3;
  state: SealState;
  t: number;
  timer: number;
}

/** Height of a seal's resting spot on its rock above the water. */
const ROCK_TOP = 0.07;

const HOLES: Array<[number, number]> = [
  [-8.5, 0.35],
  [-2.2, -0.45],
  [4.6, 0.25],
  [9.8, -0.3],
];

/** Seals lounging on the frozen river, diving through breathing holes. */
export class SealsModule implements LifeModule {
  readonly group = newGroup('seals');
  readonly #ctx: WildlifeContext;
  readonly #seals: Seal[] = [];

  readonly #rocks: boolean;

  /** On ice they use breathing holes; on open water (fjords) they haul out on rocks. */
  constructor(ctx: WildlifeContext, options: { onRocks?: boolean } = {}) {
    this.#ctx = ctx;
    this.#rocks = options.onRocks ?? false;
    const fur = new MeshStandardMaterial({ color: new Color('#7b8088'), roughness: 0.55 });
    const belly = new MeshStandardMaterial({ color: new Color('#b9bcc0'), roughness: 0.6 });
    const eye = new MeshStandardMaterial({ color: new Color('#050505'), roughness: 0.2 });
    if (this.#rocks) {
      const stone = new MeshStandardMaterial({ color: new Color('#6e6c68'), roughness: 0.9, flatShading: true });
      HOLES.forEach(([x, z]) => {
        const rock = new Mesh(new DodecahedronGeometry(0.32, 0), stone);
        rock.position.set(x + 0.45, WATER_LEVEL - 0.08, z + 0.15);
        rock.scale.set(1.5, 0.45, 1.1);
        rock.castShadow = true;
        rock.receiveShadow = true;
        this.group.add(rock);
      });
    } else HOLES.forEach(([x, z], i) => ctx.lake.setHole(i, x, z, 0.2));
    const count = ctx.high ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const body = new Mesh(new CapsuleGeometry(0.08, 0.22, 4, 10), fur);
      body.rotation.z = Math.PI / 2;
      body.scale.set(1, 1, 0.9);
      body.position.y = 0.07;
      body.castShadow = true;
      const under = new Mesh(new SphereGeometry(0.075, 10, 6), belly);
      under.scale.set(2, 0.6, 0.9);
      under.position.y = 0.035;
      const tail = new Mesh(new ConeGeometry(0.05, 0.1, 6), fur);
      tail.rotation.z = Math.PI / 2;
      tail.position.set(-0.22, 0.04, 0);
      tail.scale.set(1, 1, 0.4);
      const head = new Group();
      head.position.set(0.17, 0.11, 0);
      const skull = new Mesh(new SphereGeometry(0.065, 12, 10), fur);
      skull.castShadow = true;
      const snout = new Mesh(new SphereGeometry(0.035, 8, 6), belly);
      snout.position.set(0.055, -0.01, 0);
      head.add(skull, snout);
      for (const side of [-1, 1]) {
        const e = new Mesh(new SphereGeometry(0.012, 6, 4), eye);
        e.position.set(0.045, 0.02, side * 0.03);
        head.add(e);
        const flipper = new Mesh(new SphereGeometry(0.035, 6, 4), fur);
        flipper.scale.set(1.4, 0.3, 0.8);
        flipper.position.set(0.06, 0.02, side * 0.08);
        root.add(flipper);
      }
      root.add(body, under, tail, head);
      root.scale.setScalar(1.4);
      const hole = i % HOLES.length;
      const [hx, hz] = HOLES[hole]!;
      const home = this.#rocks ? new Vector3(hx + 0.45, WATER_LEVEL + ROCK_TOP, hz + 0.15) : new Vector3(hx + (i % 2 === 0 ? 0.45 : -0.45), WATER_LEVEL, hz + 0.15);
      root.position.copy(home);
      root.rotation.y = Math.atan2(-(hz - home.z), hx - home.x) + Math.PI;
      this.group.add(root);
      this.#seals.push({ root, head, hole, home, state: 'rest', t: 0, timer: ctx.rng.range(8, 20) });
    }
  }

  trigger(event: string): boolean {
    if (event !== 'seal') return false;
    for (const seal of this.#seals) if (seal.state === 'rest') seal.timer = 0;
    return true;
  }

  onExplosion(at: Vector3): void {
    for (const seal of this.#seals) {
      if (seal.state === 'rest' && flatDistance(seal.root.position, at) < 5) {
        seal.timer = 0;
        this.#ctx.sound('seal', seal.root.position);
      }
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    const time = ctx.time;
    for (const seal of this.#seals) {
      seal.t += dt;
      const [hx, hz] = HOLES[seal.hole]!;
      const hole = new Vector3(hx, WATER_LEVEL, hz);
      switch (seal.state) {
        case 'rest':
          seal.head.rotation.z = 0.25 + Math.sin(time * 0.6 + seal.hole) * 0.2;
          seal.head.rotation.y = Math.sin(time * 0.4 + seal.hole * 2) * 0.5;
          seal.timer -= dt;
          if (seal.timer <= 0) {
            seal.state = 'dive';
            seal.t = 0;
            seal.root.rotation.y = Math.atan2(-(hole.z - seal.root.position.z), hole.x - seal.root.position.x);
          }
          break;
        case 'dive': {
          const u = Math.min(1, seal.t / 0.9);
          seal.root.position.lerpVectors(seal.home, hole, Math.min(1, u * 1.4));
          seal.root.position.y = seal.home.y + (WATER_LEVEL - seal.home.y) * Math.min(1, u * 1.4) - Math.max(0, u - 0.6) * 0.8;
          seal.root.rotation.z = -Math.max(0, u - 0.55) * 2;
          if (u >= 1) {
            seal.state = 'under';
            seal.t = 0;
            seal.timer = ctx.rng.range(5, 10);
            seal.root.visible = false;
            ctx.sound('plop', hole);
          }
          break;
        }
        case 'under':
          if (seal.t > seal.timer) {
            seal.hole = (seal.hole + 1 + ctx.rng.int(HOLES.length - 1)) % HOLES.length;
            const [nx, nz] = HOLES[seal.hole]!;
            if (this.#rocks) seal.home.set(nx + 0.45, WATER_LEVEL + ROCK_TOP, nz + 0.15);
            else seal.home.set(nx + ctx.rng.range(-0.5, 0.5), WATER_LEVEL, nz + (nz > 0 ? -0.4 : 0.4));
            seal.root.position.set(nx, WATER_LEVEL - 0.3, nz);
            seal.root.rotation.set(0, Math.atan2(-(seal.home.z - nz), seal.home.x - nx), 0.9);
            seal.root.visible = true;
            seal.state = 'surface';
            seal.t = 0;
          }
          break;
        case 'surface': {
          const [nx, nz] = HOLES[seal.hole]!;
          const u = Math.min(1, seal.t / 1.2);
          const start = new Vector3(nx, WATER_LEVEL - 0.3, nz);
          seal.root.position.lerpVectors(start, seal.home, u);
          seal.root.position.y = seal.home.y - (seal.home.y - WATER_LEVEL + 0.3) * (1 - Math.min(1, u * 2));
          seal.root.rotation.z = 0.9 * (1 - u);
          if (u >= 1) {
            seal.state = 'rest';
            seal.timer = ctx.rng.range(10, 25);
            ctx.sound('seal', seal.home);
          }
          break;
        }
      }
    }
  }

  dispose(): void {
    if (!this.#rocks) for (let i = 0; i < HOLES.length; i++) this.#ctx.lake.setHole(i, 0, 0, 0);
    disposeGroup(this.group);
  }
}

interface Penguin {
  root: Group;
  offset: number;
  slide: number;
  slideDir: Vector3;
}

/** A little column of penguins waddling along the near edge of the ice. */
export class PenguinsModule implements LifeModule {
  readonly group = newGroup('penguins');
  readonly #ctx: WildlifeContext;
  readonly #penguins: Penguin[] = [];
  #leaderX = 0;
  #targetX = 0;
  #pause = 0;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const black = new MeshStandardMaterial({ color: new Color('#16181c'), roughness: 0.45 });
    const white = new MeshStandardMaterial({ color: new Color('#f1f2f0'), roughness: 0.5 });
    const orange = new MeshStandardMaterial({ color: new Color('#f08a1c'), roughness: 0.4 });
    const count = ctx.high ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const body = new Mesh(new SphereGeometry(0.06, 12, 10), black);
      body.scale.set(0.85, 1.35, 0.85);
      body.position.y = 0.08;
      body.castShadow = true;
      const front = new Mesh(new SphereGeometry(0.052, 12, 10), white);
      front.scale.set(0.7, 1.25, 0.8);
      front.position.set(0.02, 0.075, 0);
      const head = new Mesh(new SphereGeometry(0.038, 10, 8), black);
      head.position.set(0.005, 0.17, 0);
      const beak = new Mesh(new ConeGeometry(0.012, 0.04, 6), orange);
      beak.rotation.z = -Math.PI / 2;
      beak.position.set(0.045, 0.165, 0);
      const feet = new Mesh(new SphereGeometry(0.025, 6, 4), orange);
      feet.scale.set(1.4, 0.3, 1.6);
      feet.position.set(0.015, 0.005, 0);
      root.add(body, front, head, beak, feet);
      root.scale.setScalar(1.5 - (i === count - 1 ? 0.4 : 0));
      this.group.add(root);
      this.#penguins.push({ root, offset: i * 0.24, slide: 0, slideDir: new Vector3() });
    }
    this.#leaderX = ctx.rng.range(-6, 6);
    this.#targetX = this.#leaderX + 4;
  }

  onExplosion(at: Vector3): void {
    for (const p of this.#penguins) {
      if (flatDistance(p.root.position, at) < 6) {
        p.slide = 2.2;
        p.slideDir.copy(p.root.position).sub(at).setY(0).normalize();
        p.slideDir.z *= 0.2;
      }
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    const time = ctx.time;
    const z = 1.05;
    if (this.#pause > 0) this.#pause -= dt;
    else {
      const dir = Math.sign(this.#targetX - this.#leaderX);
      this.#leaderX += dir * 0.22 * dt;
      if (Math.abs(this.#targetX - this.#leaderX) < 0.05) {
        this.#pause = ctx.rng.range(2, 5);
        this.#targetX = Math.max(-RIVER_SWIM_X + 1, Math.min(RIVER_SWIM_X - 1, this.#leaderX + ctx.rng.range(-5, 5)));
      }
    }
    const heading = Math.sign(this.#targetX - this.#leaderX) || 1;
    for (const p of this.#penguins) {
      if (p.slide > 0) {
        p.slide -= dt;
        p.root.position.addScaledVector(p.slideDir, dt * 1.6 * Math.min(1, p.slide));
        p.root.position.x = Math.max(-PLATE_HALF_X + 0.3, Math.min(PLATE_HALF_X - 0.3, p.root.position.x));
        p.root.rotation.set(0, Math.atan2(-p.slideDir.z, p.slideDir.x), -1.35);
        p.root.position.y = WATER_LEVEL;
        continue;
      }
      const targetX = this.#leaderX - heading * p.offset;
      const walking = this.#pause <= 0 || Math.abs(p.root.position.x - targetX) > 0.05;
      p.root.position.x += (targetX - p.root.position.x) * Math.min(1, dt * 2);
      p.root.position.z += (z - p.root.position.z) * Math.min(1, dt * 1.5);
      const waddle = walking ? Math.sin(time * 9 + p.offset * 5) : 0;
      p.root.position.y = WATER_LEVEL + Math.abs(waddle) * 0.012;
      p.root.rotation.set(waddle * 0.18, heading > 0 ? 0 : Math.PI, p.root.rotation.z * Math.exp(-dt * 5));
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }
}

/** Light snowfall over the whole table. */
export class SnowModule implements LifeModule {
  readonly group = newGroup('snow');
  readonly #ctx: WildlifeContext;
  #swarm: Swarm;
  #vel: Float32Array = new Float32Array(0);

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
      p[i * 3] = p[i * 3]! + (Math.sin(time * 0.7 + i) * 0.15 + 0.12) * dt;
      p[i * 3 + 1] = p[i * 3 + 1]! - this.#vel[i]! * dt;
      p[i * 3 + 2] = p[i * 3 + 2]! + Math.cos(time * 0.5 + i * 1.3) * 0.08 * dt;
      if (p[i * 3 + 1]! < 0) this.#respawn(i, 7);
    }
    this.#swarm.commit(time);
  }

  dispose(): void {
    this.#swarm.dispose();
    this.group.removeFromParent();
  }

  #respawn(i: number, y: number): void {
    const p = this.#swarm.positions;
    const rng = this.#ctx.rng;
    p[i * 3] = rng.range(-PLATE_HALF_X - 2, PLATE_HALF_X + 2);
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = rng.range(-FIELD_OUTER_Z - 1, FIELD_OUTER_Z + 1);
    this.#vel[i] = rng.range(0.35, 0.7);
  }

  #build(quality: WildlifeQuality): Swarm {
    const count = quality === 'high' ? 700 : 220;
    const swarm = new Swarm(count, new Color(0.95, 0.97, 1), 0.05, false, 1);
    this.#swarm = swarm;
    this.#vel = new Float32Array(count);
    for (let i = 0; i < count; i++) this.#respawn(i, this.#ctx.rng.range(0, 7));
    this.group.add(swarm.points);
    return swarm;
  }
}
