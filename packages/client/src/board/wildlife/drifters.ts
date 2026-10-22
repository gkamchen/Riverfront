import {
  BoxGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  Euler,
  Vector3,
} from 'three';
import { PLATE_HALF_X, RIVER_SWIM_Z, WATER_LEVEL } from '../layout';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext, type WildlifeQuality } from './shared';

interface Leaf {
  pos: Vector3;
  spin: number;
  angle: number;
  drift: number;
  push: Vector3;
}

const END = PLATE_HALF_X - 0.3;
const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3();

/** Fade-in/out near the river ends so wrapping around is never seen. */
function endFade(x: number): number {
  return Math.min(1, Math.max(0, (END - Math.abs(x)) / 0.8));
}

function leafGeometry(): ShapeGeometry {
  const shape = new Shape();
  shape.moveTo(-0.07, 0);
  shape.quadraticCurveTo(0, 0.045, 0.07, 0);
  shape.quadraticCurveTo(0, -0.045, -0.07, 0);
  const geometry = new ShapeGeometry(shape, 6);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/** An empty canoe and autumn leaves carried slowly downstream. */
export class DriftersModule implements LifeModule {
  readonly group = newGroup('drifters');
  readonly #ctx: WildlifeContext;
  readonly #canoe = new Group();
  readonly #canoePos = new Vector3();
  #roll = 0;
  #rollVel = 0;
  readonly #push = new Vector3();
  #leaves: Leaf[] = [];
  #leafMesh: InstancedMesh | null = null;
  readonly #leafMaterial = new MeshStandardMaterial({ roughness: 0.8, side: DoubleSide });
  readonly #leafGeometry = leafGeometry();

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    const wood = new MeshStandardMaterial({ color: new Color('#7a4a26'), roughness: 0.7, side: DoubleSide });
    const darkWood = new MeshStandardMaterial({ color: new Color('#4b2c16'), roughness: 0.8 });
    const hull = new Mesh(new SphereGeometry(0.12, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), wood);
    hull.scale.set(3.4, 0.9, 1.05);
    hull.castShadow = true;
    const rim = new Mesh(new TorusGeometry(0.12, 0.01, 6, 28), darkWood);
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(3.4, 1.05, 1);
    const seats = [-0.16, 0.16].map((x) => {
      const seat = new Mesh(new BoxGeometry(0.035, 0.012, 0.22), darkWood);
      seat.position.set(x, -0.02, 0);
      return seat;
    });
    const paddle = new Mesh(new BoxGeometry(0.42, 0.01, 0.025), darkWood);
    paddle.position.set(0.02, 0.005, 0.03);
    paddle.rotation.y = 0.25;
    const blade = new Mesh(new BoxGeometry(0.1, 0.008, 0.06), darkWood);
    blade.position.set(0.22, 0.005, 0.085);
    blade.rotation.y = 0.25;
    this.#canoe.add(hull, rim, ...seats, paddle, blade);
    this.#canoe.scale.setScalar(1.25);
    this.group.add(this.#canoe);
    this.#canoePos.set(ctx.rng.range(-8, 4), WATER_LEVEL, ctx.rng.range(-0.5, 0.5));
    this.#buildLeaves(ctx.quality);
  }

  setQuality(quality: WildlifeQuality): void {
    this.#buildLeaves(quality);
  }

  onExplosion(at: Vector3, power: number): void {
    const d = flatDistance(at, this.#canoePos);
    if (d < 5) {
      this.#rollVel += (at.z > this.#canoePos.z ? -1 : 1) * (5 - d) * 0.35 * Math.max(0.5, power);
      const away = this.#canoePos.clone().sub(at).setY(0).normalize();
      this.#push.addScaledVector(away, (5 - d) * 0.08);
    }
    for (const leaf of this.#leaves) {
      const dl = flatDistance(at, leaf.pos);
      if (dl < 3) leaf.push.add(leaf.pos.clone().sub(at).setY(0).normalize().multiplyScalar((3 - dl) * 0.25));
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    const time = ctx.time;
    const flow = 0.12;

    // Canoe: drifts, meanders, rocks back to level like a damped spring.
    this.#canoePos.x += (flow + this.#push.x) * dt;
    this.#canoePos.z += (Math.sin(time * 0.13) * 0.03 + this.#push.z) * dt;
    this.#canoePos.z = Math.max(-RIVER_SWIM_Z + 0.1, Math.min(RIVER_SWIM_Z - 0.1, this.#canoePos.z));
    this.#push.multiplyScalar(Math.exp(-dt * 1.2));
    if (this.#canoePos.x > END) this.#canoePos.x = -END;
    this.#rollVel += (-this.#roll * 18 - this.#rollVel * 2.2) * dt;
    this.#roll += this.#rollVel * dt;
    const fade = endFade(this.#canoePos.x);
    this.#canoe.position.set(this.#canoePos.x, ctx.lake.surfaceY(this.#canoePos.x, this.#canoePos.z) - 0.035 - (1 - fade) * 0.25, this.#canoePos.z);
    this.#canoe.rotation.set(this.#roll + Math.sin(time * 1.4) * 0.03, Math.sin(time * 0.2) * 0.3, Math.sin(time * 1.1) * 0.02);
    this.#canoe.visible = fade > 0.01;
    if (ctx.rng.chance(dt * 0.4)) ctx.lake.addRipple(this.#canoePos.x + 0.35, this.#canoePos.z, 0.18);

    const mesh = this.#leafMesh;
    if (!mesh) return;
    this.#leaves.forEach((leaf, i) => {
      leaf.pos.x += (flow * leaf.drift + leaf.push.x) * dt;
      leaf.pos.z += (Math.sin(time * 0.3 + i) * 0.02 + leaf.push.z) * dt;
      leaf.pos.z = Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, leaf.pos.z));
      leaf.push.multiplyScalar(Math.exp(-dt * 1.5));
      if (leaf.pos.x > END) leaf.pos.x = -END;
      leaf.angle += leaf.spin * dt;
      const f = endFade(leaf.pos.x);
      tmpEuler.set(Math.sin(time * 1.7 + i) * 0.08, leaf.angle, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpScale.setScalar(Math.max(0.001, f));
      const y = ctx.lake.surfaceY(leaf.pos.x, leaf.pos.z) + 0.004;
      tmpMatrix.compose(leaf.pos.clone().setY(y), tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.#leafMesh?.dispose();
    disposeGroup(this.group);
    this.#leafGeometry.dispose();
  }

  #buildLeaves(quality: WildlifeQuality): void {
    this.#leafMesh?.removeFromParent();
    this.#leafMesh?.dispose();
    const rng = this.#ctx.rng;
    const count = quality === 'high' ? 14 : 6;
    const palette = ['#c8641e', '#e0a02a', '#a83a1c', '#7a8a2a', '#d9862a'];
    this.#leaves = Array.from({ length: count }, () => ({
      pos: new Vector3(rng.range(-END, END), WATER_LEVEL, rng.range(-RIVER_SWIM_Z, RIVER_SWIM_Z)),
      spin: rng.range(-0.4, 0.4),
      angle: rng.range(0, 6),
      drift: rng.range(0.7, 1.4),
      push: new Vector3(),
    }));
    const mesh = new InstancedMesh(this.#leafGeometry, this.#leafMaterial, count);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    const color = new Color();
    for (let i = 0; i < count; i++) mesh.setColorAt(i, color.set(rng.pick(palette)));
    this.#leafMesh = mesh;
    this.group.add(mesh);
  }
}
