import { BoxGeometry, Color, ConeGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import { PLATE_HALF_X, RIVER_SWIM_X, RIVER_SWIM_Z, WATER_LEVEL } from '../layout';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext } from './shared';

function mesh(geometry: BufferGeometry, material: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

const tmp = new Vector3();

// ------------------------------------------------------------------ dolphins

interface Dolphin {
  root: Group;
  from: Vector3;
  to: Vector3;
  t: number;
  delay: number;
  duration: number;
  height: number;
  active: boolean;
  splashedOut: boolean;
  splashedIn: boolean;
}

/** A small pod that breaks the surface in staggered leaps along the sea. */
export class DolphinModule implements LifeModule {
  readonly group = newGroup('dolphins');
  readonly #ctx: WildlifeContext;
  readonly #pod: Dolphin[] = [];
  #next: number;
  #runLeft = 0;
  readonly #origin = new Vector3();
  #heading = 1;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const back = new MeshStandardMaterial({ color: new Color('#6f8090'), roughness: 0.28, metalness: 0.05 });
    const belly = new MeshStandardMaterial({ color: new Color('#d4dbe0'), roughness: 0.35 });
    const count = ctx.high ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const body = mesh(new SphereGeometry(0.08, 16, 10), back);
      body.scale.set(3.2, 0.9, 0.9);
      const under = mesh(new SphereGeometry(0.07, 12, 8), belly, 0.02, -0.025, 0);
      under.scale.set(3, 0.6, 0.85);
      const beak = mesh(new ConeGeometry(0.025, 0.1, 8), back, 0.29, -0.01, 0);
      beak.rotation.z = -Math.PI / 2;
      const fin = mesh(new ConeGeometry(0.04, 0.09, 6), back, -0.03, 0.09, 0);
      fin.scale.set(1, 1, 0.25);
      fin.rotation.z = 0.5;
      const flukes = mesh(new BoxGeometry(0.06, 0.012, 0.18), back, -0.3, 0, 0);
      const pecs = [-1, 1].map((side) => {
        const pec = mesh(new BoxGeometry(0.07, 0.008, 0.04), back, 0.08, -0.04, side * 0.07);
        pec.rotation.x = side * 0.4;
        return pec;
      });
      root.add(body, under, beak, fin, flukes, ...pecs);
      root.scale.setScalar(1.35);
      root.visible = false;
      this.group.add(root);
      this.#pod.push({ root, from: new Vector3(), to: new Vector3(), t: 0, delay: 0, duration: 1, height: 0.5, active: false, splashedOut: false, splashedIn: false });
    }
    this.#next = ctx.rng.range(2, 5);
  }

  trigger(event: string): boolean {
    if (event !== 'dolphins') return false;
    this.#startRun();
    return true;
  }

  onExplosion(at: Vector3, power: number): void {
    if (power < 0.5 || this.#pod.some((d) => d.active)) return;
    this.#origin.set(at.x + (at.x > 0 ? -3 : 3), WATER_LEVEL, 0);
    this.#heading = at.x > 0 ? -1 : 1;
    this.#runLeft = 2;
    this.#leap();
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    if (!this.#pod.some((d) => d.active)) {
      if (this.#runLeft > 0) this.#leap();
      else {
        this.#next -= dt;
        if (this.#next <= 0) this.#startRun();
      }
    }
    for (const d of this.#pod) {
      if (!d.active) continue;
      d.t += dt;
      const u = (d.t - d.delay) / d.duration;
      if (u < 0) continue;
      if (u >= 1) {
        d.active = false;
        d.root.visible = false;
        continue;
      }
      d.root.visible = true;
      d.root.position.lerpVectors(d.from, d.to, u);
      d.root.position.y = WATER_LEVEL - 0.12 + 4 * d.height * u * (1 - u);
      const climb = (4 * d.height * (1 - 2 * u)) / Math.max(0.1, flatDistance(d.from, d.to));
      d.root.rotation.set(0, Math.atan2(-(d.to.z - d.from.z), d.to.x - d.from.x), Math.atan(climb));
      if (!d.splashedOut && u > 0.1) {
        d.splashedOut = true;
        ctx.splash(tmp.copy(d.root.position).setY(WATER_LEVEL), 0.6);
      }
      if (!d.splashedIn && u > 0.88) {
        d.splashedIn = true;
        ctx.splash(tmp.copy(d.root.position).setY(WATER_LEVEL), 0.8);
        ctx.sound('splash', d.root.position);
      }
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #startRun(): void {
    const rng = this.#ctx.rng;
    this.#heading = rng.chance(0.5) ? 1 : -1;
    this.#origin.set(-this.#heading * rng.range(2, RIVER_SWIM_X - 2), WATER_LEVEL, rng.range(-0.5, 0.5));
    this.#runLeft = rng.int(2) + 2;
    this.#next = rng.range(6, 12);
    this.#leap();
  }

  #leap(): void {
    const rng = this.#ctx.rng;
    this.#runLeft--;
    this.#pod.forEach((d, i) => {
      const lane = (i - (this.#pod.length - 1) / 2) * 0.32;
      const length = rng.range(1.1, 1.5);
      d.from.set(this.#origin.x - this.#heading * i * 0.35, WATER_LEVEL, Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, this.#origin.z + lane)));
      d.to.copy(d.from).setX(d.from.x + this.#heading * length);
      d.t = 0;
      d.delay = i * 0.28 + rng.range(0, 0.1);
      d.duration = rng.range(0.85, 1.05);
      d.height = rng.range(0.4, 0.62);
      d.active = true;
      d.splashedOut = false;
      d.splashedIn = false;
    });
    this.#origin.x += this.#heading * 1.8;
    if (Math.abs(this.#origin.x) > RIVER_SWIM_X - 1.5) this.#runLeft = 0;
  }
}

// ------------------------------------------------------------------ seagulls

interface Gull {
  root: Group;
  wings: Group[];
  centre: Vector3;
  radius: number;
  speed: number;
  angle: number;
  height: number;
  flap: number;
  dive: number;
}

/** Colours, size and flight of a soaring bird. */
export interface BirdLook {
  body: string;
  wing: string;
  tip: string;
  beak: string;
  scale: number;
  height: readonly [number, number];
  /** Fraction of the time spent flapping (gulls glide, macaws flap a lot). */
  flapping: number;
}

export const GULL_LOOK: BirdLook = { body: '#f1f1ee', wing: '#a7adb3', tip: '#22252a', beak: '#e8b83a', scale: 1.4, height: [1.9, 3.2], flapping: 0.15 };
export const EAGLE_LOOK: BirdLook = { body: '#5a3e26', wing: '#4a3220', tip: '#2a1c12', beak: '#e0b43a', scale: 2.0, height: [3.0, 4.2], flapping: 0.05 };
export const CONDOR_LOOK: BirdLook = { body: '#1e1c1c', wing: '#262424', tip: '#e8e4dc', beak: '#c8a890', scale: 2.4, height: [3.4, 4.6], flapping: 0.03 };
export const MACAW_LOOK: BirdLook = { body: '#d02a22', wing: '#2a5ad0', tip: '#f0c020', beak: '#e8e4dc', scale: 1.2, height: [1.6, 2.6], flapping: 0.5 };
export const FALCON_LOOK: BirdLook = { body: '#8a6a4a', wing: '#6a5444', tip: '#2a221c', beak: '#e8c040', scale: 1.4, height: [2.4, 3.6], flapping: 0.25 };
export const CROW_LOOK: BirdLook = { body: '#18181c', wing: '#202026', tip: '#0e0e12', beak: '#2a2a2e', scale: 1.15, height: [1.4, 2.4], flapping: 0.35 };

/** Gulls (or eagles, condors, macaws, crows, falcons) wheeling over the water; one sometimes drops to the surface. */
export class SeagullModule implements LifeModule {
  readonly group = newGroup('seagulls');
  readonly #ctx: WildlifeContext;
  readonly #gulls: Gull[] = [];
  #nextCry: number;
  #nextDive: number;

  readonly #look: BirdLook;

  constructor(ctx: WildlifeContext, look: BirdLook = GULL_LOOK) {
    this.#ctx = ctx;
    this.#look = look;
    const white = new MeshStandardMaterial({ color: new Color(look.body), roughness: 0.6 });
    const grey = new MeshStandardMaterial({ color: new Color(look.wing), roughness: 0.6 });
    const black = new MeshStandardMaterial({ color: new Color(look.tip), roughness: 0.6 });
    const yellow = new MeshStandardMaterial({ color: new Color(look.beak), roughness: 0.4 });
    const count = ctx.high ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const body = mesh(new SphereGeometry(0.04, 10, 8), white);
      body.scale.set(2.3, 0.9, 0.9);
      const head = mesh(new SphereGeometry(0.03, 8, 6), white, 0.09, 0.025, 0);
      const beak = mesh(new ConeGeometry(0.008, 0.04, 5), yellow, 0.13, 0.02, 0);
      beak.rotation.z = -Math.PI / 2;
      const tail = mesh(new BoxGeometry(0.06, 0.008, 0.05), white, -0.1, 0.005, 0);
      root.add(body, head, beak, tail);
      const wings = [-1, 1].map((side) => {
        const pivot = new Group();
        pivot.position.set(0.01, 0.015, side * 0.025);
        const inner = mesh(new BoxGeometry(0.08, 0.006, 0.14), grey, 0, 0, side * 0.07);
        const outer = mesh(new BoxGeometry(0.06, 0.005, 0.12), grey, -0.012, 0, side * 0.19);
        outer.rotation.y = side * 0.25;
        const tip = mesh(new BoxGeometry(0.04, 0.005, 0.05), black, -0.025, 0, side * 0.26);
        pivot.add(inner, outer, tip);
        root.add(pivot);
        return pivot;
      });
      root.scale.setScalar(look.scale);
      this.group.add(root);
      this.#gulls.push({
        root,
        wings,
        centre: new Vector3(ctx.rng.range(-8, 8), 0, ctx.rng.range(-1, 1)),
        radius: ctx.rng.range(1.2, 3),
        speed: ctx.rng.range(0.35, 0.55) * (ctx.rng.chance(0.5) ? 1 : -1),
        angle: ctx.rng.range(0, Math.PI * 2),
        height: ctx.rng.range(look.height[0], look.height[1]),
        flap: 0,
        dive: -1,
      });
    }
    this.#nextCry = ctx.rng.range(4, 10);
    this.#nextDive = ctx.rng.range(8, 16);
  }

  trigger(event: string): boolean {
    if (event !== 'gulls') return false;
    this.#startDive();
    return true;
  }

  onExplosion(at: Vector3): void {
    for (const gull of this.#gulls) {
      if (flatDistance(gull.root.position, at) < 6) {
        gull.flap = 2;
        gull.height = Math.min(4.2, gull.height + 0.8);
      }
    }
    if (this.#look === GULL_LOOK) this.#ctx.sound('gull', at);
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    this.#nextCry -= dt;
    if (this.#nextCry <= 0) {
      this.#nextCry = ctx.rng.range(6, 14);
      const gull = ctx.rng.pick(this.#gulls);
      if (this.#look === GULL_LOOK) ctx.sound('gull', gull.root.position);
    }
    this.#nextDive -= dt;
    if (this.#nextDive <= 0) this.#startDive();

    for (const gull of this.#gulls) {
      gull.angle += (gull.speed / gull.radius) * dt;
      gull.height += ((this.#look.height[0] + this.#look.height[1]) / 2 - gull.height) * dt * 0.05;
      const x = gull.centre.x + Math.cos(gull.angle) * gull.radius;
      const z = gull.centre.z + Math.sin(gull.angle) * gull.radius * 0.45;
      let y = gull.height + Math.sin(ctx.time * 0.6 + gull.angle) * 0.15;
      if (gull.dive >= 0) {
        gull.dive += dt / 2.2;
        const u = Math.min(1, gull.dive);
        y = gull.height - (gull.height - WATER_LEVEL - 0.05) * Math.sin(Math.PI * u);
        if (u > 0.5 && u - dt / 2.2 <= 0.5) ctx.splash(tmp.set(x, WATER_LEVEL, z), 0.35);
        if (u >= 1) gull.dive = -1;
        gull.flap = Math.max(gull.flap, u > 0.5 ? 1 : 0);
      }
      gull.root.position.set(Math.max(-PLATE_HALF_X - 2, Math.min(PLATE_HALF_X + 2, x)), y, z);
      // Face along the circle and bank into the turn.
      const heading = gull.angle + (gull.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      gull.root.rotation.set(-Math.sign(gull.speed) * 0.35, Math.atan2(-Math.sin(heading) * 0.45, Math.cos(heading)), 0);
      gull.flap = Math.max(0, gull.flap - dt);
      const flapping = gull.flap > 0 || Math.sin(ctx.time * 0.4 + gull.angle * 3) > 1 - this.#look.flapping * 2;
      const a = flapping ? Math.sin(ctx.time * 14 + gull.angle) * 0.7 : 0.12;
      gull.wings[0]!.rotation.x = -a;
      gull.wings[1]!.rotation.x = a;
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #startDive(): void {
    this.#nextDive = this.#ctx.rng.range(10, 20);
    const gull = this.#gulls.find((g) => g.dive < 0);
    if (gull) gull.dive = 0;
  }
}

// ------------------------------------------------------------------ ducks

interface Duck {
  root: Group;
  wings: Mesh[];
  offset: number;
  dabble: number;
  flee: Vector3;
  fleeTime: number;
}

/** A family of mallards paddling along the bank, tipping up to feed. */
export class DuckModule implements LifeModule {
  readonly group = newGroup('ducks');
  readonly #ctx: WildlifeContext;
  readonly #ducks: Duck[] = [];
  #leader = new Vector3();
  #target = new Vector3();

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const drake = new MeshStandardMaterial({ color: new Color('#8a8478'), roughness: 0.6 });
    const hen = new MeshStandardMaterial({ color: new Color('#8a6a48'), roughness: 0.65 });
    const green = new MeshStandardMaterial({ color: new Color('#1f5a32'), roughness: 0.3, metalness: 0.2 });
    const bill = new MeshStandardMaterial({ color: new Color('#e2b23a'), roughness: 0.4 });
    const count = ctx.high ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const isDrake = i % 2 === 0;
      const root = new Group();
      const body = mesh(new SphereGeometry(0.045, 12, 8), isDrake ? drake : hen);
      body.scale.set(1.6, 0.75, 1);
      const head = mesh(new SphereGeometry(0.026, 10, 8), isDrake ? green : hen, 0.06, 0.05, 0);
      const beak = mesh(new BoxGeometry(0.035, 0.008, 0.02), bill, 0.09, 0.045, 0);
      const tail = mesh(new ConeGeometry(0.015, 0.04, 5), isDrake ? drake : hen, -0.075, 0.025, 0);
      tail.rotation.z = 1.9;
      const wings = [-1, 1].map((side) => {
        const wing = mesh(new BoxGeometry(0.06, 0.006, 0.04), isDrake ? drake : hen, -0.005, 0.02, side * 0.045);
        return wing;
      });
      root.add(body, head, beak, tail, ...wings);
      root.scale.setScalar(i === 0 ? 1.5 : 1.25);
      this.group.add(root);
      this.#ducks.push({ root, wings, offset: i * 0.22, dabble: 0, flee: new Vector3(), fleeTime: 0 });
    }
    this.#leader.set(ctx.rng.range(-6, 6), WATER_LEVEL, 1.05);
    this.#target.copy(this.#leader).setX(this.#leader.x + 3);
  }

  trigger(event: string): boolean {
    if (event !== 'ducks') return false;
    for (const duck of this.#ducks) duck.dabble = 1.4;
    return true;
  }

  onExplosion(at: Vector3): void {
    for (const duck of this.#ducks) {
      if (flatDistance(duck.root.position, at) > 6) continue;
      duck.flee.copy(duck.root.position).sub(at).setY(0).normalize();
      duck.flee.z *= 0.3;
      duck.fleeTime = 1.6;
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    const toTarget = this.#target.x - this.#leader.x;
    if (Math.abs(toTarget) < 0.1) {
      this.#target.set(Math.max(-RIVER_SWIM_X + 1, Math.min(RIVER_SWIM_X - 1, this.#leader.x + ctx.rng.range(-5, 5))), WATER_LEVEL, ctx.rng.chance(0.5) ? 1.05 : -1.05);
    }
    this.#leader.x += Math.sign(toTarget) * 0.16 * dt;
    this.#leader.z += (this.#target.z - this.#leader.z) * dt * 0.3;
    const heading = Math.sign(toTarget) || 1;
    for (const duck of this.#ducks) {
      const p = duck.root.position;
      if (duck.fleeTime > 0) {
        duck.fleeTime -= dt;
        p.addScaledVector(duck.flee, dt * 1.2);
        p.z = Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, p.z));
        duck.wings.forEach((w, i) => (w.rotation.x = (i ? 1 : -1) * Math.sin(ctx.time * 30) * 0.9));
        if (ctx.rng.chance(dt * 6)) ctx.lake.addRipple(p.x, p.z, 0.12);
      } else {
        duck.wings.forEach((w) => (w.rotation.x *= Math.exp(-dt * 8)));
        p.x += (this.#leader.x - heading * duck.offset - p.x) * Math.min(1, dt * 1.5);
        p.z += (this.#leader.z + Math.sin(duck.offset * 9) * 0.08 - p.z) * Math.min(1, dt * 1.2);
        if (duck.dabble <= 0 && ctx.rng.chance(dt * 0.06)) duck.dabble = 1.4;
      }
      duck.dabble = Math.max(0, duck.dabble - dt);
      const tip = duck.dabble > 0 ? Math.sin((1 - duck.dabble / 1.4) * Math.PI) : 0;
      p.y = ctx.lake.surfaceY(p.x, p.z) + 0.005 + Math.sin(ctx.time * 2 + duck.offset * 7) * 0.004;
      duck.root.rotation.set(0, heading > 0 ? 0 : Math.PI, -tip * 1.25);
      if (tip > 0.95 && ctx.rng.chance(dt * 4)) ctx.lake.addRipple(p.x, p.z, 0.1);
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }
}
