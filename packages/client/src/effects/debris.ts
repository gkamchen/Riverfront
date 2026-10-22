import { Color, DodecahedronGeometry, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from 'three';
import { rand } from '../util/random';

interface Chip {
  alive: boolean;
  position: Vector3;
  velocity: Vector3;
  rotation: Euler;
  spin: Vector3;
  size: number;
  age: number;
  life: number;
  resting: boolean;
  /** Fell into water or lava: slides under instead of bouncing. */
  sinking: boolean;
}

export interface DebrisBurst {
  origin: Vector3;
  count: number;
  color: Color;
  size: readonly [number, number];
  speed: readonly [number, number];
  /** Vertical bias of the launch velocity. */
  lift?: number;
}

/** What is under a point: its height and whether chips sink into it. */
export interface GroundSample {
  y: number;
  liquid: boolean;
}

export type GroundProbe = (x: number, z: number, out: GroundSample) => GroundSample;

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpScale = new Vector3();
const tmpColor = new Color();
const hidden = new Matrix4().makeScale(0, 0, 0);
const sample: GroundSample = { y: 0, liquid: false };

/**
 * Little faceted chips that fly, bounce on the board and fade away. Chips are
 * pooled; the draw count shrinks to the highest live slot and the mesh hides
 * itself when nothing is flying.
 */
export class Debris {
  readonly mesh: InstancedMesh;
  readonly #chips: Chip[];
  #ground: GroundProbe;
  #cursor = 0;
  #live = 0;

  constructor(material: Material, capacity: number, groundY: number) {
    this.mesh = new InstancedMesh(new DodecahedronGeometry(1, 0), material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'debris';
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.#ground = (_x, _z, out) => {
      out.y = groundY;
      out.liquid = false;
      return out;
    };
    this.#chips = Array.from({ length: capacity }, () => ({
      alive: false,
      position: new Vector3(),
      velocity: new Vector3(),
      rotation: new Euler(),
      spin: new Vector3(),
      size: 0,
      age: 0,
      life: 1,
      resting: false,
      sinking: false,
    }));
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, hidden);
      this.mesh.setColorAt(i, tmpColor.setRGB(1, 1, 1));
    }
  }

  /** Lets chips land on the real surface (tiles, frame, water, table). */
  setGround(probe: GroundProbe): void {
    this.#ground = probe;
  }

  burst(options: DebrisBurst): void {
    const capacity = this.#chips.length;
    for (let n = 0; n < options.count; n++) {
      const index = this.#cursor;
      this.#cursor = (this.#cursor + 1) % capacity;
      const chip = this.#chips[index]!;
      const angle = Math.random() * Math.PI * 2;
      const speed = rand(options.speed[0], options.speed[1]);
      chip.alive = true;
      chip.position.set(options.origin.x + rand(-0.12, 0.12), options.origin.y + rand(0, 0.15), options.origin.z + rand(-0.12, 0.12));
      chip.velocity.set(Math.cos(angle) * speed, (options.lift ?? 2.5) * rand(0.6, 1.3), Math.sin(angle) * speed);
      chip.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      chip.spin.set(rand(-14, 14), rand(-14, 14), rand(-14, 14));
      chip.size = rand(options.size[0], options.size[1]);
      chip.age = 0;
      chip.life = rand(1.6, 2.6);
      chip.resting = false;
      chip.sinking = false;
      this.mesh.setColorAt(index, tmpColor.copy(options.color).multiplyScalar(rand(0.7, 1.15)));
      this.#live = Math.max(this.#live, index + 1);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = this.#live;
    this.mesh.visible = this.#live > 0;
  }

  update(dt: number): void {
    if (this.#live === 0) return;
    let highest = 0;
    for (let index = 0; index < this.#live; index++) {
      const chip = this.#chips[index]!;
      if (!chip.alive) continue;
      chip.age += dt;
      if (chip.age >= chip.life) {
        chip.alive = false;
        this.mesh.setMatrixAt(index, hidden);
        continue;
      }
      highest = index + 1;
      if (!chip.resting) this.#simulate(chip, dt);

      const fade = Math.min(1, (chip.life - chip.age) / 0.4);
      tmpQuat.setFromEuler(chip.rotation);
      tmpScale.setScalar(chip.size * fade);
      tmpMatrix.compose(chip.position, tmpQuat, tmpScale);
      this.mesh.setMatrixAt(index, tmpMatrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.#live = highest;
    this.mesh.count = highest;
    this.mesh.visible = highest > 0;
  }

  clear(): void {
    for (let i = 0; i < this.#chips.length; i++) {
      this.#chips[i]!.alive = false;
      this.mesh.setMatrixAt(i, hidden);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.#live = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }

  #simulate(chip: Chip, dt: number): void {
    if (chip.sinking) {
      // Drift down and shrink away under the surface.
      chip.position.y -= dt * 0.25;
      chip.life = Math.min(chip.life, chip.age + 0.5);
      return;
    }
    chip.velocity.y -= 9.8 * dt;
    chip.position.addScaledVector(chip.velocity, dt);
    chip.rotation.x += chip.spin.x * dt;
    chip.rotation.y += chip.spin.y * dt;
    chip.rotation.z += chip.spin.z * dt;

    const ground = this.#ground(chip.position.x, chip.position.z, sample);
    const floor = ground.y + chip.size * 0.6;
    if (chip.position.y < floor) {
      if (ground.liquid) {
        chip.sinking = true;
        chip.position.y = ground.y;
        return;
      }
      chip.position.y = floor;
      chip.velocity.y = -chip.velocity.y * 0.35;
      chip.velocity.x *= 0.6;
      chip.velocity.z *= 0.6;
      chip.spin.multiplyScalar(0.5);
      if (Math.abs(chip.velocity.y) < 0.35) chip.resting = true;
    }
  }
}
