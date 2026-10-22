import {
  CapsuleGeometry,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WATER_LEVEL } from '../layout';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext } from './shared';

interface Pad {
  group: Group;
  phase: number;
  base: Vector3;
}

type FrogState = 'sit' | 'leap' | 'under' | 'peek' | 'climb';

interface Frog {
  mesh: Group;
  throat: Mesh;
  pad: Pad;
  state: FrogState;
  t: number;
  timer: number;
  from: Vector3;
  to: Vector3;
  croak: number;
}

const SPOTS: Array<[number, number, boolean]> = [
  [-10.2, 0.6, true],
  [-9.6, 0.95, false],
  [-6.1, -0.9, false],
  [-3.4, -0.7, true],
  [2.8, 0.4, true],
  [3.3, 0.85, false],
  [7.4, 0.95, false],
  [9.1, -0.5, false],
  [10.4, -0.2, true],
];

function frogGeometry(): { body: ReturnType<typeof mergeGeometries>; eyes: ReturnType<typeof mergeGeometries> } {
  const body = new SphereGeometry(0.06, 12, 8);
  body.scale(1.25, 0.7, 1);
  body.translate(0, 0.04, 0);
  const head = new SphereGeometry(0.045, 10, 8);
  head.scale(1.1, 0.75, 1.1);
  head.translate(0.06, 0.06, 0);
  const legs = [-1, 1].flatMap((side) => {
    const back = new CapsuleGeometry(0.018, 0.07, 3, 6);
    back.rotateZ(Math.PI / 2);
    back.rotateY(side * 0.5);
    back.translate(-0.04, 0.02, side * 0.06);
    const front = new CapsuleGeometry(0.012, 0.04, 3, 6);
    front.translate(0.07, 0.02, side * 0.04);
    return [back, front];
  });
  const eyes = [-1, 1].map((side) => {
    const eye = new SphereGeometry(0.02, 8, 6);
    eye.translate(0.075, 0.1, side * 0.032);
    return eye;
  });
  return {
    body: mergeGeometries([body, head, ...legs].map((g) => (g.index ? g.toNonIndexed() : g))),
    eyes: mergeGeometries(eyes),
  };
}

/**
 * Lily pads drifting on the river; a few carry frogs that dive in when a shot
 * lands nearby and climb back once things calm down.
 */
export class LilyFrogsModule implements LifeModule {
  readonly group = newGroup('lily-frogs');
  readonly #ctx: WildlifeContext;
  readonly #pads: Pad[] = [];
  readonly #frogs: Frog[] = [];

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const padMaterial = new MeshStandardMaterial({ color: new Color('#3f7d3a'), roughness: 0.45 });
    const flowerMaterial = new MeshStandardMaterial({ color: new Color('#f3b7d0'), emissive: new Color('#5a2038'), roughness: 0.5 });
    const padGeometry = new CircleGeometry(0.26, 24, 0.35, Math.PI * 2 - 0.5);
    padGeometry.rotateX(-Math.PI / 2);
    const flowerGeometry = new SphereGeometry(0.07, 12, 8);

    SPOTS.forEach(([x, z, flower], i) => {
      const group = new Group();
      const pad = new Mesh(padGeometry, padMaterial);
      pad.receiveShadow = true;
      group.add(pad);
      if (flower) {
        const bloom = new Mesh(flowerGeometry, flowerMaterial);
        bloom.position.set(0.05, 0.04, 0.02);
        bloom.scale.set(1, 0.7, 1);
        bloom.castShadow = true;
        group.add(bloom);
      }
      const base = new Vector3(x, WATER_LEVEL + 0.018, z);
      group.position.copy(base);
      group.rotation.y = i * 1.7;
      group.scale.setScalar(0.8 + (i % 3) * 0.15);
      this.group.add(group);
      this.#pads.push({ group, phase: i * 2.1, base });
    });

    const { body, eyes } = frogGeometry();
    const skin = new MeshStandardMaterial({ color: new Color('#4f9a35'), roughness: 0.4 });
    const eyeMaterial = new MeshStandardMaterial({ color: new Color('#e8d24a'), roughness: 0.2, emissive: new Color('#2a2200') });
    const throatMaterial = new MeshStandardMaterial({ color: new Color('#e4e0a2'), roughness: 0.5 });
    const throatGeometry = new SphereGeometry(0.03, 8, 6);
    const frogPads = this.#pads.filter((_, i) => !(SPOTS[i]?.[2] ?? false));
    const count = ctx.high ? 4 : 2;
    for (let i = 0; i < Math.min(count, frogPads.length); i++) {
      const pad = frogPads[(i * 2) % frogPads.length]!;
      const mesh = new Group();
      const frogBody = new Mesh(body, skin);
      frogBody.castShadow = true;
      const frogEyes = new Mesh(eyes, eyeMaterial);
      const throat = new Mesh(throatGeometry, throatMaterial);
      throat.position.set(0.085, 0.035, 0);
      mesh.add(frogBody, frogEyes, throat);
      mesh.scale.setScalar(1.15);
      this.group.add(mesh);
      this.#frogs.push({
        mesh,
        throat,
        pad,
        state: 'sit',
        t: 0,
        timer: 0,
        from: new Vector3(),
        to: new Vector3(),
        croak: ctx.rng.range(3, 12),
      });
    }
  }

  trigger(event: string): boolean {
    if (event !== 'frogs') return false;
    for (const frog of this.#frogs) if (frog.state === 'sit') this.#leap(frog);
    return true;
  }

  onExplosion(at: Vector3): void {
    for (const frog of this.#frogs) {
      if (frog.state === 'sit' && flatDistance(frog.mesh.position, at) < 4.5) this.#leap(frog);
    }
  }

  update(dt: number): void {
    const time = this.#ctx.time;
    for (const pad of this.#pads) {
      pad.group.position.y = pad.base.y + Math.sin(time * 1.3 + pad.phase) * 0.01;
      pad.group.rotation.y += dt * 0.04 * Math.sin(pad.phase);
    }
    for (const frog of this.#frogs) this.#updateFrog(frog, dt, time);
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #leap(frog: Frog): void {
    const angle = this.#ctx.rng.range(0, Math.PI * 2);
    frog.state = 'leap';
    frog.t = this.#ctx.rng.range(-0.25, 0);
    frog.from.copy(frog.mesh.position);
    frog.to.copy(frog.pad.group.position).add(new Vector3(Math.cos(angle) * 0.55, 0, Math.sin(angle) * 0.4));
    frog.to.y = WATER_LEVEL - 0.02;
    frog.mesh.rotation.y = Math.atan2(-(frog.to.z - frog.from.z), frog.to.x - frog.from.x);
  }

  #updateFrog(frog: Frog, dt: number, time: number): void {
    const ctx = this.#ctx;
    frog.t += dt;
    const padTop = frog.pad.group.position.clone();
    padTop.y += 0.012;
    switch (frog.state) {
      case 'sit': {
        frog.mesh.position.copy(padTop);
        frog.mesh.visible = true;
        frog.croak -= dt;
        const pulse = frog.croak < 0.5 ? Math.max(0, Math.sin(frog.croak * Math.PI * 6)) : 0;
        frog.throat.scale.setScalar(1 + pulse * 0.9 + Math.sin(time * 5) * 0.08);
        if (frog.croak <= 0) {
          frog.croak = ctx.rng.range(6, 16);
          ctx.sound('frog', frog.mesh.position);
        }
        break;
      }
      case 'leap': {
        if (frog.t < 0) break;
        const u = Math.min(1, frog.t / 0.45);
        frog.mesh.position.lerpVectors(frog.from, frog.to, u);
        frog.mesh.position.y += Math.sin(Math.PI * u) * 0.28;
        frog.mesh.rotation.z = (0.5 - u) * 0.9;
        if (u >= 1) {
          ctx.splash(frog.to, 0.45);
          ctx.sound('plop', frog.to);
          frog.state = 'under';
          frog.t = 0;
          frog.timer = ctx.rng.range(6, 12);
          frog.mesh.visible = false;
          frog.mesh.rotation.z = 0;
        }
        break;
      }
      case 'under':
        if (frog.t > frog.timer) {
          frog.state = 'peek';
          frog.t = 0;
          frog.mesh.visible = true;
          frog.mesh.position.copy(frog.to).setY(WATER_LEVEL - 0.075);
          ctx.lake.addRipple(frog.to.x, frog.to.z, 0.3);
        }
        break;
      case 'peek':
        // Only the eyes show above the surface for a moment.
        frog.mesh.position.y = WATER_LEVEL - 0.075 + Math.sin(time * 2) * 0.005;
        if (frog.t > 1.6) {
          frog.state = 'climb';
          frog.t = 0;
          frog.from.copy(frog.mesh.position);
          frog.mesh.rotation.y = Math.atan2(-(padTop.z - frog.from.z), padTop.x - frog.from.x);
          ctx.splash(frog.from.clone().setY(WATER_LEVEL), 0.25);
        }
        break;
      case 'climb': {
        const u = Math.min(1, frog.t / 0.4);
        frog.mesh.position.lerpVectors(frog.from, padTop, u);
        frog.mesh.position.y += Math.sin(Math.PI * u) * 0.16;
        if (u >= 1) {
          frog.state = 'sit';
          frog.croak = ctx.rng.range(2, 6);
        }
        break;
      }
    }
  }
}
