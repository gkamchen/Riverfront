import { Color, Group, Vector3, type Object3D } from 'three';
import { ParticleSystem } from '../../effects/particles';
import type { Lake } from '../water';

/** Cosmetic random stream (mulberry32). Never used for anything that affects play. */
export class CosmeticRng {
  #state: number;

  constructor(seed = 0x9e3779b9) {
    this.#state = seed >>> 0;
  }

  next(): number {
    let t = (this.#state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

export type WildlifeQuality = 'high' | 'low';

export type WildlifeSound = 'splash' | 'plop' | 'frog' | 'bird' | 'flap' | 'sizzle' | 'seal' | 'crack' | 'gull' | 'grunt' | 'snap';

export type AmbientSpecies =
  | 'fish'
  | 'lilypads'
  | 'heron'
  | 'dragonflies'
  | 'drifters'
  | 'fireflies'
  | 'birdsong'
  | 'salamanders'
  | 'embers'
  | 'seals'
  | 'penguins'
  | 'snow'
  | 'crocodiles'
  | 'hippos'
  | 'ibis'
  | 'dolphins'
  | 'seagulls'
  | 'ducks'
  | 'felucca'
  | 'cargoBoat'
  | 'trireme'
  | 'mist'
  | 'longship'
  | 'harborSeals'
  | 'koi'
  | 'petals'
  | 'junk'
  | 'dragonKite'
  | 'caravan'
  | 'caique'
  | 'eagles'
  | 'condors'
  | 'macaws'
  | 'crows'
  | 'wolves'
  | 'llamas'
  | 'dogs'
  | 'jaguars'
  | 'falcons'
  | 'lions'
  | 'tigers'
  | 'horses'
  | 'peacocks';

const DROPLET = new Color('#dff2f4');
const DROPLET_END = new Color('#a9cdd6');
const LAVA = new Color(3.2, 1.1, 0.22);
const LAVA_END = new Color(0.9, 0.12, 0.02);
const BUBBLE = new Color('#d8f4ff');

/** Everything a wildlife module may use: the river, randomness, splashes and sounds. */
export class WildlifeContext {
  readonly lake: Lake;
  readonly rng: CosmeticRng;
  readonly spray = new ParticleSystem(700, false);
  readonly glow = new ParticleSystem(600, true);
  quality: WildlifeQuality;
  dusk = 0;
  time = 0;
  #sound: (name: WildlifeSound, at: Vector3) => void;

  constructor(lake: Lake, rng: CosmeticRng, quality: WildlifeQuality, sound: (name: WildlifeSound, at: Vector3) => void) {
    this.lake = lake;
    this.rng = rng;
    this.quality = quality;
    this.#sound = sound;
    this.spray.points.name = 'wildlife-spray';
    this.glow.points.name = 'wildlife-glow';
  }

  get high(): boolean {
    return this.quality === 'high';
  }

  sound(name: WildlifeSound, at: Vector3): void {
    this.#sound(name, at);
  }

  setSoundHandler(handler: (name: WildlifeSound, at: Vector3) => void): void {
    this.#sound = handler;
  }

  /** Water (or lava) breaking: droplets plus a ripple ring. */
  splash(at: Vector3, size = 1): void {
    const lava = this.lake.mode === 'lava';
    if (this.lake.mode === 'ice') return;
    const count = Math.round((lava ? 14 : 18) * size * (this.high ? 1 : 0.5)) + 2;
    const system = lava ? this.glow : this.spray;
    system.emit({
      origin: at,
      count,
      radius: 0.04 * size,
      speed: [0.5 * size, 1.4 * Math.sqrt(size)],
      spread: 0.22,
      lift: 0.4,
      life: [0.35, 0.7],
      size: lava ? [0.05, 0.1] : [0.035, 0.07],
      grow: 0.8,
      color: lava ? LAVA : DROPLET,
      colorEnd: lava ? LAVA_END : DROPLET_END,
      opacity: 0.85,
      gravity: 7,
      drag: 0.6,
    });
    this.lake.addRipple(at.x, at.z, Math.min(1.4, 0.35 + size * 0.5));
  }

  bubbles(at: Vector3, count: number): void {
    this.spray.emit({
      origin: at,
      count,
      radius: 0.15,
      speed: [0.05, 0.15],
      spread: 0.15,
      lift: 0.35,
      life: [0.5, 1.1],
      size: [0.02, 0.045],
      color: BUBBLE,
      opacity: 0.7,
      gravity: -0.3,
      drag: 1.5,
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.spray.update(dt);
    this.glow.update(dt);
  }

  dispose(): void {
    for (const system of [this.spray, this.glow]) {
      system.points.removeFromParent();
      system.points.geometry.dispose();
      system.points.material.dispose();
    }
  }
}

export interface LifeModule {
  readonly group: Object3D;
  update(dt: number): void;
  onExplosion?(at: Vector3, power: number): void;
  onHoverIdle?(at: Vector3 | null): void;
  setQuality?(quality: WildlifeQuality): void;
  setDusk?(amount: number): void;
  /** Gallery/debug triggers ("carp", "heron"...). Returns true if handled. */
  trigger?(event: string): boolean;
  dispose(): void;
}

/** Frees every geometry/material under a group (wildlife owns its meshes). */
export function disposeGroup(group: Object3D): void {
  group.traverse((object) => {
    const mesh = object as Object3D & { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
  group.removeFromParent();
}

export function newGroup(name: string): Group {
  const group = new Group();
  group.name = name;
  return group;
}

/** Horizontal distance helper. */
export function flatDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
