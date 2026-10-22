import { BoxGeometry, Color, ConeGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';
import { RIVER_SWIM_X, RIVER_SWIM_Z, WATER_LEVEL } from '../layout';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext } from './shared';

const tmp = new Vector3();

function mesh(geometry: SphereGeometry | BoxGeometry | ConeGeometry, material: MeshStandardMaterial, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------ crocodiles

type CrocState = 'glide' | 'snap' | 'dive';

interface Croc {
  root: Group;
  head: Group;
  upper: Group;
  lower: Group;
  tail: Group[];
  heading: number;
  target: Vector3;
  state: CrocState;
  t: number;
  timer: number;
  depth: number;
  snapped: boolean;
}

/** Floats with only eyes and back ridge above the surface. */
const GLIDE_DEPTH = -0.06;

/**
 * Nile crocodiles gliding low in the water. Now and then one lifts its head
 * and snaps its jaws shut with a splash; explosions send them under.
 */
export class CrocodileModule implements LifeModule {
  readonly group = newGroup('crocodiles');
  readonly #ctx: WildlifeContext;
  readonly #crocs: Croc[] = [];

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const hide = new MeshStandardMaterial({ color: new Color('#3f4a2c'), roughness: 0.62 });
    const belly = new MeshStandardMaterial({ color: new Color('#7d7a52'), roughness: 0.7 });
    const eye = new MeshStandardMaterial({ color: new Color('#c8b040'), roughness: 0.3, emissive: new Color('#3a3000') });
    const tooth = new MeshStandardMaterial({ color: new Color('#e8e2cc'), roughness: 0.4 });
    const count = ctx.high ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const body = mesh(new SphereGeometry(0.1, 14, 8), hide);
      body.scale.set(2.6, 0.55, 1);
      root.add(body);
      const under = mesh(new SphereGeometry(0.09, 10, 6), belly, 0, -0.02, 0);
      under.scale.set(2.5, 0.4, 0.95);
      root.add(under);
      for (let k = 0; k < 8; k++) {
        for (const side of [-1, 1]) root.add(mesh(new ConeGeometry(0.012, 0.03, 4), hide, -0.2 + k * 0.055, 0.055, side * 0.03));
      }
      for (const [x, side] of [[0.14, 1], [0.14, -1], [-0.14, 1], [-0.14, -1]] as const) {
        const leg = mesh(new SphereGeometry(0.03, 6, 4), hide, x, -0.03, side * 0.1);
        leg.scale.set(1.6, 0.5, 1);
        root.add(leg);
      }

      // Head: the upper and lower jaws hinge at the back of the skull.
      const head = new Group();
      head.position.set(0.24, 0.005, 0);
      const upper = new Group();
      upper.add(mesh(new BoxGeometry(0.2, 0.045, 0.1), hide, 0.1, 0.012, 0));
      upper.add(mesh(new BoxGeometry(0.14, 0.035, 0.075), hide, 0.26, 0.006, 0));
      upper.add(mesh(new SphereGeometry(0.018, 6, 4), hide, 0.33, 0.016, 0));
      for (const side of [-1, 1]) {
        upper.add(mesh(new SphereGeometry(0.016, 8, 6), eye, 0.03, 0.04, side * 0.032));
        for (let k = 0; k < 4; k++) {
          const fang = mesh(new ConeGeometry(0.006, 0.02, 3), tooth, 0.08 + k * 0.07, -0.016, side * 0.035);
          fang.rotation.z = Math.PI;
          upper.add(fang);
        }
      }
      const lower = new Group();
      lower.position.y = -0.015;
      lower.add(mesh(new BoxGeometry(0.33, 0.025, 0.085), belly, 0.16, -0.01, 0));
      for (const side of [-1, 1]) for (let k = 0; k < 4; k++) lower.add(mesh(new ConeGeometry(0.006, 0.02, 3), tooth, 0.06 + k * 0.07, 0.008, side * 0.03));
      head.add(upper, lower);
      root.add(head);

      const tail: Group[] = [];
      let parent: Group = root;
      for (let k = 0; k < 3; k++) {
        const link = new Group();
        link.position.x = k === 0 ? -0.24 : -0.16;
        const seg = mesh(new ConeGeometry(0.07 - k * 0.018, 0.2, 8), hide, -0.08, 0, 0);
        seg.rotation.z = Math.PI / 2;
        seg.scale.set(1, 1, 0.6);
        link.add(seg);
        link.add(mesh(new ConeGeometry(0.01, 0.03, 4), hide, -0.05, 0.035 - k * 0.008, 0));
        parent.add(link);
        tail.push(link);
        parent = link;
      }

      root.scale.setScalar(1.5);
      const start = new Vector3(ctx.rng.range(-RIVER_SWIM_X + 2, RIVER_SWIM_X - 2), WATER_LEVEL, ctx.rng.range(-0.6, 0.6));
      root.position.copy(start);
      this.group.add(root);
      this.#crocs.push({
        root,
        head,
        upper,
        lower,
        tail,
        heading: ctx.rng.range(0, Math.PI * 2),
        target: this.#pickTarget(new Vector3()),
        state: 'glide',
        t: 0,
        timer: ctx.rng.range(6, 14),
        depth: GLIDE_DEPTH,
        snapped: false,
      });
    }
  }

  trigger(event: string): boolean {
    if (event !== 'crocSnap') return false;
    const croc = this.#crocs.find((c) => c.state === 'glide');
    if (croc) this.#startSnap(croc);
    return true;
  }

  onExplosion(at: Vector3, power: number): void {
    for (const croc of this.#crocs) {
      if (croc.state === 'dive' || flatDistance(croc.root.position, at) > 4 + power * 2) continue;
      croc.state = 'dive';
      croc.t = 0;
      croc.timer = this.#ctx.rng.range(3, 6);
      this.#ctx.splash(croc.root.position, 0.5);
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    for (const croc of this.#crocs) {
      croc.t += dt;
      let speed = 0.16;
      let targetDepth = GLIDE_DEPTH;
      switch (croc.state) {
        case 'glide':
          croc.timer -= dt;
          if (croc.timer <= 0) this.#startSnap(croc);
          break;
        case 'snap': {
          speed = 0.04;
          const t = croc.t;
          // Rise and open, slam shut, settle.
          const open = t < 0.45 ? Math.sin((t / 0.45) * Math.PI * 0.5) : t < 0.58 ? 1 - (t - 0.45) / 0.13 : 0;
          croc.upper.rotation.z = open * 0.75;
          croc.lower.rotation.z = -open * 0.22;
          croc.head.rotation.z = (t < 0.9 ? Math.sin(Math.min(1, t / 0.9) * Math.PI) : 0) * 0.28;
          targetDepth = GLIDE_DEPTH + (t < 0.9 ? Math.sin(Math.min(1, t / 0.9) * Math.PI) * 0.06 : 0);
          if (!croc.snapped && t > 0.58) {
            croc.snapped = true;
            const tip = croc.head.localToWorld(tmp.set(0.3, 0, 0));
            tip.y = WATER_LEVEL;
            ctx.splash(tip, 0.55);
            ctx.sound('snap', tip);
          }
          if (t > 1.3) {
            croc.state = 'glide';
            croc.timer = ctx.rng.range(10, 20);
          }
          break;
        }
        case 'dive':
          speed = 0.3;
          targetDepth = -0.32;
          if (croc.t > croc.timer) {
            croc.state = 'glide';
            croc.timer = ctx.rng.range(6, 12);
          }
          break;
      }
      croc.depth += (targetDepth - croc.depth) * Math.min(1, dt * 3);

      // Steer gently towards a wandering target inside the river.
      const pos = croc.root.position;
      if (flatDistance(pos, croc.target) < 0.6) this.#pickTarget(croc.target);
      const want = Math.atan2(-(croc.target.z - pos.z), croc.target.x - pos.x);
      let turn = want - croc.heading;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      croc.heading += Math.max(-0.5 * dt, Math.min(0.5 * dt, turn));
      pos.x += Math.cos(croc.heading) * speed * dt;
      pos.z -= Math.sin(croc.heading) * speed * dt;
      pos.z = Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, pos.z));
      pos.y = ctx.lake.surfaceY(pos.x, pos.z) + croc.depth;
      croc.root.rotation.y = croc.heading;
      const swish = ctx.time * (2 + speed * 10);
      croc.tail.forEach((link, k) => (link.rotation.y = Math.sin(swish - k * 0.9) * (0.18 + k * 0.08)));
      if (croc.state === 'glide' && ctx.rng.chance(dt * 0.5)) ctx.lake.addRipple(pos.x, pos.z, 0.15);
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #startSnap(croc: Croc): void {
    croc.state = 'snap';
    croc.t = 0;
    croc.snapped = false;
  }

  #pickTarget(out: Vector3): Vector3 {
    const rng = this.#ctx.rng;
    return out.set(rng.range(-RIVER_SWIM_X + 1, RIVER_SWIM_X - 1), WATER_LEVEL, rng.range(-RIVER_SWIM_Z + 0.2, RIVER_SWIM_Z - 0.2));
  }
}

// ------------------------------------------------------------------ hippos

type HippoState = 'under' | 'rise' | 'idle' | 'yawn' | 'sink';

interface Hippo {
  root: Group;
  head: Group;
  jaw: Group;
  ears: Mesh[];
  state: HippoState;
  t: number;
  timer: number;
  depth: number;
}

const HIPPO_UP = -0.2;
const HIPPO_DOWN = -0.6;

/** Hippos that surface, flick their ears, yawn wide and sink again. */
export class HippoModule implements LifeModule {
  readonly group = newGroup('hippos');
  readonly #ctx: WildlifeContext;
  readonly #hippos: Hippo[] = [];

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const skin = new MeshStandardMaterial({ color: new Color('#6d5a5e'), roughness: 0.45 });
    const pink = new MeshStandardMaterial({ color: new Color('#c08a86'), roughness: 0.5 });
    const mouth = new MeshStandardMaterial({ color: new Color('#a4505a'), roughness: 0.6 });
    const ivory = new MeshStandardMaterial({ color: new Color('#efe6cf'), roughness: 0.35 });
    const dark = new MeshStandardMaterial({ color: new Color('#1a1414'), roughness: 0.3 });
    const count = ctx.high ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const root = new Group();
      const body = mesh(new SphereGeometry(0.22, 16, 10), skin);
      body.scale.set(1.5, 0.85, 1);
      root.add(body);
      const head = new Group();
      head.position.set(0.3, 0.06, 0);
      const skull = mesh(new SphereGeometry(0.12, 14, 10), skin);
      skull.scale.set(1.1, 0.8, 1);
      const muzzle = mesh(new SphereGeometry(0.11, 14, 10), pink, 0.14, -0.02, 0);
      muzzle.scale.set(0.9, 0.62, 1.25);
      head.add(skull, muzzle);
      const ears: Mesh[] = [];
      for (const side of [-1, 1]) {
        head.add(mesh(new SphereGeometry(0.018, 8, 6), dark, 0.05, 0.085, side * 0.07));
        head.add(mesh(new SphereGeometry(0.012, 6, 4), dark, 0.22, 0.04, side * 0.04));
        const ear = mesh(new ConeGeometry(0.02, 0.04, 6), skin, -0.04, 0.1, side * 0.065);
        head.add(ear);
        ears.push(ear);
      }
      const jaw = new Group();
      jaw.position.set(0.02, -0.06, 0);
      const lowerJaw = mesh(new SphereGeometry(0.1, 12, 8), pink, 0.12, -0.02, 0);
      lowerJaw.scale.set(1, 0.4, 1.1);
      const inside = mesh(new BoxGeometry(0.16, 0.01, 0.13), mouth, 0.12, 0.012, 0);
      jaw.add(lowerJaw, inside);
      for (const side of [-1, 1]) jaw.add(mesh(new ConeGeometry(0.012, 0.06, 6), ivory, 0.19, 0.04, side * 0.06));
      head.add(jaw);
      root.add(head);
      root.scale.setScalar(1.3);
      root.visible = false;
      this.group.add(root);
      this.#hippos.push({ root, head, jaw, ears, state: 'under', t: 0, timer: ctx.rng.range(1, 6) + i * 4, depth: HIPPO_DOWN });
    }
  }

  trigger(event: string): boolean {
    if (event !== 'hippo') return false;
    const hippo = this.#hippos.find((h) => h.state === 'under') ?? this.#hippos.find((h) => h.state === 'idle');
    if (!hippo) return true;
    if (hippo.state === 'under') hippo.timer = 0;
    else this.#set(hippo, 'yawn');
    return true;
  }

  onExplosion(at: Vector3): void {
    for (const hippo of this.#hippos) {
      if ((hippo.state === 'idle' || hippo.state === 'yawn' || hippo.state === 'rise') && flatDistance(hippo.root.position, at) < 6) {
        this.#set(hippo, 'sink');
        this.#ctx.bubbles(hippo.root.position, 10);
      }
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    for (const hippo of this.#hippos) {
      hippo.t += dt;
      let depth = hippo.depth;
      switch (hippo.state) {
        case 'under':
          hippo.timer -= dt;
          if (hippo.timer <= 0) {
            const rng = ctx.rng;
            hippo.root.position.set(rng.range(-RIVER_SWIM_X + 1.5, RIVER_SWIM_X - 1.5), WATER_LEVEL, rng.range(-0.7, 0.7));
            hippo.root.rotation.y = rng.range(0, Math.PI * 2);
            hippo.root.visible = true;
            ctx.bubbles(hippo.root.position, 12);
            this.#set(hippo, 'rise');
          }
          break;
        case 'rise':
          depth = HIPPO_DOWN + (HIPPO_UP - HIPPO_DOWN) * Math.min(1, hippo.t / 1.6);
          if (hippo.t > 1.6) {
            ctx.lake.addRipple(hippo.root.position.x, hippo.root.position.z, 0.6);
            hippo.timer = ctx.rng.range(4, 8);
            this.#set(hippo, 'idle');
          }
          break;
        case 'idle':
          depth = HIPPO_UP + Math.sin(ctx.time * 1.3) * 0.012;
          hippo.ears.forEach((ear, i) => (ear.rotation.x = Math.max(0, Math.sin(ctx.time * 9 + i * 2)) * (Math.sin(ctx.time * 0.7) > 0.6 ? 0.6 : 0)));
          hippo.timer -= dt;
          if (hippo.timer <= 0) this.#set(hippo, ctx.rng.chance(0.6) ? 'yawn' : 'sink');
          break;
        case 'yawn': {
          const u = Math.min(1, hippo.t / 2.4);
          const open = Math.sin(u * Math.PI);
          hippo.head.rotation.z = open * 0.55;
          hippo.jaw.rotation.z = -open * 1.0;
          depth = HIPPO_UP + open * 0.06;
          if (hippo.t > 0.4 && hippo.t - dt <= 0.4) ctx.sound('grunt', hippo.root.position);
          if (u >= 1) {
            hippo.timer = ctx.rng.range(2, 5);
            this.#set(hippo, 'idle');
          }
          break;
        }
        case 'sink':
          hippo.head.rotation.z *= Math.exp(-dt * 4);
          hippo.jaw.rotation.z *= Math.exp(-dt * 4);
          depth = HIPPO_UP + (HIPPO_DOWN - HIPPO_UP) * Math.min(1, hippo.t / 1.4);
          if (hippo.t > 1.4) {
            hippo.root.visible = false;
            hippo.timer = ctx.rng.range(8, 16);
            this.#set(hippo, 'under');
          }
          break;
      }
      hippo.depth = depth;
      const p = hippo.root.position;
      p.y = ctx.lake.surfaceY(p.x, p.z) + depth;
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #set(hippo: Hippo, state: HippoState): void {
    hippo.state = state;
    hippo.t = 0;
  }
}
