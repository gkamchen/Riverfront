import { Color, Group, Vector3 } from 'three';
import { FIELD_INNER_Z, PLATE_HALF_X } from '../board/layout';
import type { ReflectedLight } from '../board/water';
import { rand } from '../util/random';
import { ParticleSystem, type EmitOptions } from './particles';

type ShellKind = 'peony' | 'ring' | 'willow' | 'crossette';

interface Rocket {
  position: Vector3;
  velocity: Vector3;
  fuse: number;
  color: Color;
  kind: ShellKind;
}

interface Glow extends ReflectedLight {
  decay: number;
}

const TRAIL = new Color(3.4, 2.3, 1.2);
const TRAIL_END = new Color(0.7, 0.3, 0.1);
const CRACKLE = new Color(5, 4.4, 3.2);
const GOLD = new Color(4.2, 2.6, 0.8);
const WILLOW_END = new Color(0.6, 0.25, 0.05);

/**
 * Victory fireworks over the river. Rockets rise from both banks, often in
 * salvos, and burst into several kinds of shells; every burst is also reported
 * as a light so the water mirrors it.
 */
export class Fireworks {
  readonly group = new Group();
  readonly #sparks: ParticleSystem;
  readonly #rockets: Rocket[] = [];
  readonly #glows: Glow[] = [];
  readonly #trail: EmitOptions = { origin: new Vector3(), count: 3, radius: 0.02, speed: [0.05, 0.35], spread: 1, life: [0.25, 0.55], size: [0.06, 0.11], color: TRAIL, colorEnd: TRAIL_END, gravity: 1 };
  readonly #endColor = new Color();
  #remaining = 0;
  #nextLaunch = 0;
  #colors: Color[] = [new Color(3, 2.2, 0.6)];
  #density = 1;
  onLaunch: () => void = () => undefined;
  onBurst: () => void = () => undefined;

  constructor() {
    this.#sparks = new ParticleSystem(6000, true);
    this.#sparks.points.name = 'fireworks';
    this.group.add(this.#sparks.points);
  }

  get active(): boolean {
    return this.#remaining > 0 || this.#rockets.length > 0;
  }

  /** Lights of the bursts still glowing, for water reflections. */
  get lights(): readonly ReflectedLight[] {
    return this.#glows;
  }

  setDensity(density: number): void {
    this.#density = density;
  }

  setViewport(heightPx: number, fov: number): void {
    this.#sparks.setScale(heightPx, fov);
  }

  /** Fires shells for `seconds`, in the given colours (HDR values allowed). */
  start(seconds: number, colors: readonly Color[]): void {
    this.#remaining = seconds;
    this.#nextLaunch = 0;
    if (colors.length > 0) this.#colors = colors.map((c) => c.clone().multiplyScalar(1.35));
  }

  stop(): void {
    this.#remaining = 0;
  }

  clear(): void {
    this.#remaining = 0;
    this.#rockets.length = 0;
    this.#glows.length = 0;
    this.#sparks.clear();
  }

  dispose(): void {
    this.clear();
    this.#sparks.dispose();
    this.group.removeFromParent();
  }

  update(dt: number): void {
    if (this.#remaining > 0) {
      this.#remaining -= dt;
      this.#nextLaunch -= dt;
      if (this.#nextLaunch <= 0) {
        this.#nextLaunch = rand(0.18, 0.42) / Math.max(0.5, this.#density);
        // Every few launches a salvo of two or three shells goes up together.
        const salvo = Math.random() < 0.3 ? (Math.random() < 0.5 ? 2 : 3) : 1;
        for (let i = 0; i < salvo; i++) this.#launch();
      }
    }

    for (let i = this.#rockets.length - 1; i >= 0; i--) {
      const rocket = this.#rockets[i]!;
      rocket.velocity.y -= 3.2 * dt;
      rocket.position.addScaledVector(rocket.velocity, dt);
      rocket.fuse -= dt;
      this.#trail.origin.copy(rocket.position);
      this.#sparks.emit(this.#trail);
      if (rocket.fuse <= 0) {
        this.#burst(rocket);
        this.#rockets.splice(i, 1);
      }
    }

    for (let i = this.#glows.length - 1; i >= 0; i--) {
      const glow = this.#glows[i]!;
      glow.intensity -= dt * glow.decay;
      if (glow.intensity <= 0) this.#glows.splice(i, 1);
    }
    this.#sparks.update(dt);
  }

  #launch(): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    const position = new Vector3(rand(-PLATE_HALF_X + 2, PLATE_HALF_X - 2), 0.25, side * (FIELD_INNER_Z + 0.2));
    const apex = new Vector3(position.x + rand(-2.5, 2.5), rand(5.5, 8.5), rand(-1, 1));
    const time = rand(1.1, 1.5);
    const velocity = new Vector3((apex.x - position.x) / time, (apex.y - position.y) / time + 1.6 * time, (apex.z - position.z) / time);
    const color = this.#colors[Math.floor(Math.random() * this.#colors.length)] ?? TRAIL;
    const roll = Math.random();
    const kind: ShellKind = roll < 0.45 ? 'peony' : roll < 0.65 ? 'ring' : roll < 0.85 ? 'willow' : 'crossette';
    this.#rockets.push({ position, velocity, fuse: time, color, kind });
    this.onLaunch();
  }

  #burst(rocket: Rocket): void {
    const d = this.#density;
    const end = this.#endColor.copy(rocket.color).multiplyScalar(0.3);
    const origin = rocket.position;
    switch (rocket.kind) {
      case 'peony':
        this.#sparks.emit({ origin, count: Math.round(320 * d), radius: 0.05, speed: [3.6, 5.2], spread: 1, life: [1.3, 2.2], size: [0.1, 0.18], color: rocket.color, colorEnd: end, gravity: 1.6, drag: 1.25 });
        break;
      case 'ring': {
        // A flat halo: particles launched mostly sideways.
        this.#sparks.emit({ origin, count: Math.round(220 * d), radius: 0.05, speed: [4.6, 5.2], spread: 0.52, life: [1.2, 1.8], size: [0.1, 0.16], color: rocket.color, colorEnd: end, gravity: 1.2, drag: 1.4 });
        this.#sparks.emit({ origin, count: Math.round(90 * d), radius: 0.1, speed: [1, 2], spread: 1, life: [0.8, 1.4], size: [0.08, 0.13], color: GOLD, colorEnd: end, gravity: 1.4, drag: 1.4 });
        break;
      }
      case 'willow':
        // Long golden drips hanging down.
        this.#sparks.emit({ origin, count: Math.round(260 * d), radius: 0.05, speed: [2.6, 3.8], spread: 1, life: [2.2, 3.2], size: [0.08, 0.14], color: GOLD, colorEnd: WILLOW_END, gravity: 2.6, drag: 1.6 });
        this.#sparks.emit({ origin, count: Math.round(120 * d), radius: 0.05, speed: [3, 4], spread: 1, life: [1, 1.6], size: [0.1, 0.16], color: rocket.color, colorEnd: end, gravity: 1.5, drag: 1.3 });
        break;
      case 'crossette':
        // Four bright sub-bursts around the main one.
        this.#sparks.emit({ origin, count: Math.round(160 * d), radius: 0.05, speed: [3.2, 4.4], spread: 1, life: [1, 1.6], size: [0.1, 0.16], color: rocket.color, colorEnd: end, gravity: 1.6, drag: 1.3 });
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + Math.random();
          const sub = new Vector3(origin.x + Math.cos(a) * 1.4, origin.y + rand(-0.3, 0.5), origin.z + Math.sin(a) * 1.4);
          this.#sparks.emit({ origin: sub, count: Math.round(70 * d), radius: 0.05, speed: [1.6, 2.6], spread: 1, life: [0.8, 1.3], size: [0.08, 0.14], color: CRACKLE, colorEnd: end, gravity: 1.8, drag: 1.2 });
        }
        break;
    }
    this.#sparks.emit({ origin, count: Math.round(70 * d), radius: 0.7, speed: [0.2, 0.9], spread: 1, life: [0.6, 1.5], size: [0.05, 0.09], color: CRACKLE, colorEnd: end, gravity: 2, drag: 1 });
    this.#glows.push({ position: origin.clone(), color: rocket.color.clone().multiplyScalar(0.45), intensity: rocket.kind === 'peony' ? 1.9 : 1.5, decay: 0.85 });
    if (this.#glows.length > 8) this.#glows.shift();
    this.onBurst();
  }
}
