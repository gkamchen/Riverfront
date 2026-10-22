import { Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { RIVER_SWIM_X, RIVER_SWIM_Z, WATER_LEVEL, riverBedY } from '../layout';
import { CARP, LAMBARI, PIRARUCU, TUCUNARE, fishGeometry, fishMaterial } from './fishModels';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext, type WildlifeQuality } from './shared';

type Mode = 'swim' | 'jump' | 'stunned' | 'recover';

interface Fish {
  pos: Vector3;
  vel: Vector3;
  depth: number;
  phase: number;
  mode: Mode;
  t: number;
  from: Vector3;
  to: Vector3;
  jumpHeight: number;
  jumpTime: number;
  flee: number;
  roll: number;
  pitch: number;
  school: number;
}

interface Threat {
  at: Vector3;
  radius: number;
  until: number;
}

interface School {
  target: Vector3;
  retarget: number;
  nextJump: number;
}

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler(0, 0, 0, 'YZX');
const tmpScale = new Vector3(1, 1, 1);
const acc = new Vector3();
const centroid = new Vector3();
const heading = new Vector3();

function makeFish(pos: Vector3, school: number, phase: number): Fish {
  return {
    pos,
    vel: new Vector3(Math.cos(phase), 0, Math.sin(phase)).multiplyScalar(0.3),
    depth: -0.06 - (phase % 1) * 0.08,
    phase,
    mode: 'swim',
    t: 0,
    from: new Vector3(),
    to: new Vector3(),
    jumpHeight: 0,
    jumpTime: 0,
    flee: 0,
    roll: 0,
    pitch: 0,
    school,
  };
}

/** Keeps a swimming fish between the river bed and the surface. */
function swimY(fish: Fish): number {
  const floor = riverBedY(fish.pos.z) + 0.045;
  const ceiling = WATER_LEVEL - 0.035;
  return Math.min(ceiling, Math.max(floor, fish.depth));
}

/**
 * The river's fish: lambari schools (boids-lite) that jump now and then, a
 * hunting tucunaré that scatters them, a rare carp leap and the very rare
 * surfacing of a pirarucu.
 */
export class FishModule implements LifeModule {
  readonly group = newGroup('fish');
  readonly #ctx: WildlifeContext;
  readonly #material = fishMaterial();
  #lambari: InstancedMesh | null = null;
  #fish: Fish[] = [];
  #schools: School[] = [];
  readonly #threats: Threat[] = [];

  readonly #tucunare: Mesh;
  readonly #hunter: Fish;
  #hunt = { active: false, timer: 12, target: new Vector3(), elapsed: 0 };

  readonly #carp: Mesh;
  readonly #carpFish: Fish;
  #carpTimer: number;

  readonly #pirarucu: Mesh;
  #giant = { phase: 'hidden' as 'hidden' | 'bubbles' | 'surface' | 'dive', t: 0, timer: 0, at: new Vector3(), dir: 1 };

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    this.#tucunare = this.#mesh(fishGeometry(TUCUNARE));
    this.#hunter = makeFish(new Vector3(ctx.rng.range(-8, 8), -0.12, 0), -1, ctx.rng.range(0, 6));
    this.#hunter.depth = -0.14;
    this.#carp = this.#mesh(fishGeometry(CARP));
    this.#carp.visible = false;
    this.#carpFish = makeFish(new Vector3(), -1, 0);
    this.#carpTimer = ctx.rng.range(18, 40);
    this.#pirarucu = this.#mesh(fishGeometry(PIRARUCU));
    this.#pirarucu.visible = false;
    this.#giant.timer = ctx.rng.range(120, 240);
    this.#buildSchools(ctx.quality);
  }

  setQuality(quality: WildlifeQuality): void {
    this.#buildSchools(quality);
  }

  trigger(event: string): boolean {
    if (event === 'carp') this.#carpTimer = 0;
    else if (event === 'pirarucu') this.#giant.timer = 0;
    else if (event === 'tucunare') this.#hunt.timer = 0;
    else if (event === 'jump') for (const school of this.#schools) school.nextJump = 0;
    else return false;
    return true;
  }

  onExplosion(at: Vector3, power: number): void {
    const time = this.#ctx.time;
    const reach = 3 * Math.max(0.6, Math.min(1.4, power));
    this.#threats.push({ at: at.clone(), radius: reach, until: time + 6 });
    if (this.#threats.length > 8) this.#threats.shift();
    for (const fish of this.#fish) {
      const d = flatDistance(fish.pos, at);
      if (d > reach) continue;
      fish.flee = 6;
      if (d < 1.1 + power * 0.5 && fish.mode === 'swim' && power >= 0.5) {
        fish.mode = 'stunned';
        fish.t = 0;
      }
    }
    if (flatDistance(this.#hunter.pos, at) < reach) this.#hunter.flee = 6;
  }

  update(dt: number): void {
    const time = this.#ctx.time;
    for (let i = this.#threats.length - 1; i >= 0; i--) if (this.#threats[i]!.until < time) this.#threats.splice(i, 1);
    this.#updateSchools(dt);
    this.#updateLambari(dt);
    this.#updateHunter(dt);
    this.#updateCarp(dt);
    this.#updateGiant(dt);
  }

  dispose(): void {
    this.#lambari?.dispose();
    disposeGroup(this.group);
  }

  // -------------------------------------------------------------- lambari

  #buildSchools(quality: WildlifeQuality): void {
    if (this.#lambari) {
      this.#lambari.removeFromParent();
      this.#lambari.geometry.dispose();
      this.#lambari.dispose();
    }
    const rng = this.#ctx.rng;
    const schools = quality === 'high' ? 3 : 2;
    const perSchool = quality === 'high' ? 12 : 8;
    this.#schools = [];
    this.#fish = [];
    for (let s = 0; s < schools; s++) {
      const centre = new Vector3(rng.range(-RIVER_SWIM_X, RIVER_SWIM_X), 0, rng.range(-0.6, 0.6));
      this.#schools.push({ target: centre.clone(), retarget: rng.range(3, 8), nextJump: rng.range(3, 9) });
      for (let k = 0; k < perSchool; k++) {
        const pos = centre.clone().add(new Vector3(rng.range(-0.4, 0.4), 0, rng.range(-0.25, 0.25)));
        const fish = makeFish(pos, s, rng.range(0, Math.PI * 2));
        fish.pos.y = swimY(fish);
        this.#fish.push(fish);
      }
    }
    const mesh = new InstancedMesh(fishGeometry(LAMBARI), this.#material, this.#fish.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    const tint = new Color();
    for (let i = 0; i < this.#fish.length; i++) {
      tint.setHSL(0.52 + rng.range(-0.04, 0.04), 0.12, 0.75 + rng.range(-0.1, 0.1));
      mesh.setColorAt(i, tint);
    }
    this.#lambari = mesh;
    this.group.add(mesh);
  }

  #updateSchools(dt: number): void {
    const rng = this.#ctx.rng;
    this.#schools.forEach((school, s) => {
      school.retarget -= dt;
      if (school.retarget <= 0) {
        school.retarget = rng.range(4, 9);
        school.target.set(
          Math.max(-RIVER_SWIM_X, Math.min(RIVER_SWIM_X, school.target.x + rng.range(-4, 4))),
          0,
          rng.range(-RIVER_SWIM_Z * 0.8, RIVER_SWIM_Z * 0.8),
        );
      }
      school.nextJump -= dt;
      if (school.nextJump <= 0) {
        school.nextJump = rng.range(5, 11) * (this.#ctx.high ? 1 : 1.6);
        const members = this.#fish.filter((f) => f.school === s && f.mode === 'swim');
        const jumpers = rng.chance(0.3) ? 3 : 1;
        for (let j = 0; j < Math.min(jumpers, members.length); j++) {
          const fish = rng.pick(members);
          this.#startJump(fish, rng.range(0.45, 0.8), rng.range(0.18, 0.32), rng.range(0.5, 0.7), j * 0.12);
        }
      }
    });
  }

  #startJump(fish: Fish, distance: number, height: number, duration: number, delay = 0): void {
    heading.copy(fish.vel).setY(0);
    if (heading.lengthSq() < 1e-4) heading.set(1, 0, 0);
    heading.normalize();
    fish.mode = 'jump';
    fish.t = -delay;
    fish.from.set(fish.pos.x, WATER_LEVEL - 0.02, fish.pos.z);
    fish.to.copy(fish.from).addScaledVector(heading, distance);
    fish.to.x = Math.max(-RIVER_SWIM_X, Math.min(RIVER_SWIM_X, fish.to.x));
    fish.to.z = Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, fish.to.z));
    fish.jumpHeight = height;
    fish.jumpTime = duration;
  }

  /** Parabola step; returns true when the fish is back in the water. */
  #stepJump(fish: Fish, dt: number, splashSize: number): boolean {
    const before = fish.t;
    fish.t += dt;
    if (fish.t < 0) return false;
    if (before < 0 || before === 0) this.#ctx.splash(fish.from, splashSize * 0.6);
    const u = Math.min(1, fish.t / fish.jumpTime);
    fish.pos.lerpVectors(fish.from, fish.to, u);
    fish.pos.y = fish.from.y + 4 * fish.jumpHeight * u * (1 - u);
    const horizontal = Math.max(0.01, flatDistance(fish.from, fish.to));
    fish.pitch = Math.atan2(4 * fish.jumpHeight * (1 - 2 * u), horizontal);
    fish.vel.copy(fish.to).sub(fish.from).setY(0).normalize().multiplyScalar(0.5);
    if (u >= 1) {
      this.#ctx.splash(fish.to, splashSize);
      this.#ctx.sound('plop', fish.to);
      fish.pitch = 0;
      return true;
    }
    return false;
  }

  #updateLambari(dt: number): void {
    const mesh = this.#lambari;
    if (!mesh) return;
    const time = this.#ctx.time;
    const hunting = this.#hunt.active;

    // School centroids and mean velocities.
    const sums = this.#schools.map(() => ({ c: new Vector3(), v: new Vector3(), n: 0 }));
    for (const fish of this.#fish) {
      const sum = sums[fish.school];
      if (!sum || fish.mode !== 'swim') continue;
      sum.c.add(fish.pos);
      sum.v.add(fish.vel);
      sum.n++;
    }

    this.#fish.forEach((fish, i) => {
      fish.flee = Math.max(0, fish.flee - dt);
      if (fish.mode === 'jump') {
        if (this.#stepJump(fish, dt, 0.45)) {
          fish.mode = 'swim';
          fish.pos.y = WATER_LEVEL - 0.05;
        }
      } else if (fish.mode === 'stunned' || fish.mode === 'recover') {
        this.#stepStunned(fish, dt);
      } else {
        const sum = sums[fish.school]!;
        const school = this.#schools[fish.school]!;
        acc.set(0, 0, 0);
        if (sum.n > 0) {
          centroid.copy(sum.c).divideScalar(sum.n);
          acc.addScaledVector(centroid.sub(fish.pos), 0.7);
          acc.addScaledVector(sum.v.clone().divideScalar(sum.n).sub(fish.vel), 0.9);
        }
        acc.addScaledVector(school.target.clone().sub(fish.pos).setY(0), 0.25);
        for (const other of this.#fish) {
          if (other === fish || other.school !== fish.school) continue;
          const dx = fish.pos.x - other.pos.x;
          const dz = fish.pos.z - other.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 0.03 && d2 > 1e-6) {
            acc.x += (dx / d2) * 0.012;
            acc.z += (dz / d2) * 0.012;
          }
        }
        for (const threat of this.#threats) this.#avoid(fish, threat.at, threat.radius, 5);
        if (hunting) {
          const d = flatDistance(fish.pos, this.#hunter.pos);
          if (d < 1.3) {
            this.#avoid(fish, this.#hunter.pos, 1.3, 9);
            fish.flee = Math.max(fish.flee, 1.2);
          }
        }
        this.#steer(fish, dt, fish.flee > 0 ? 1.5 : 0.5, 0.18);
        fish.depth = -0.06 - (Math.sin(time * 0.3 + fish.phase) * 0.5 + 0.5) * 0.08;
        fish.pos.y += (swimY(fish) - fish.pos.y) * Math.min(1, dt * 3);
      }
      this.#write(mesh, i, fish, 1);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  #stepStunned(fish: Fish, dt: number): void {
    fish.t += dt;
    if (fish.mode === 'stunned') {
      const k = Math.min(1, fish.t / 0.35);
      fish.roll = Math.PI * k;
      fish.pos.y += (WATER_LEVEL - 0.008 - fish.pos.y) * Math.min(1, dt * 6);
      fish.pos.x += 0.08 * dt;
      fish.vel.multiplyScalar(Math.exp(-dt * 4));
      if (fish.t > 2) {
        fish.mode = 'recover';
        fish.t = 0;
      }
    } else {
      const k = Math.min(1, fish.t / 0.6);
      fish.roll = Math.PI * (1 - k);
      fish.pos.y += (swimY(fish) - fish.pos.y) * Math.min(1, dt * 3);
      if (k >= 1) {
        fish.mode = 'swim';
        fish.roll = 0;
        fish.flee = 6;
      }
    }
  }

  #avoid(fish: Fish, at: Vector3, radius: number, strength: number): void {
    const dx = fish.pos.x - at.x;
    const dz = fish.pos.z - at.z;
    const d = Math.hypot(dx, dz);
    if (d >= radius || d < 1e-4) return;
    const push = ((radius - d) / radius) * strength;
    acc.x += (dx / d) * push;
    acc.z += (dz / d) * push;
  }

  /** Integrates `acc`, keeps the fish inside the river and within a speed band. */
  #steer(fish: Fish, dt: number, maxSpeed: number, minSpeed: number): void {
    const margin = 0.5;
    if (fish.pos.x > RIVER_SWIM_X - margin) acc.x -= (fish.pos.x - RIVER_SWIM_X + margin) * 6;
    if (fish.pos.x < -RIVER_SWIM_X + margin) acc.x += (-RIVER_SWIM_X + margin - fish.pos.x) * 6;
    if (fish.pos.z > RIVER_SWIM_Z - 0.2) acc.z -= (fish.pos.z - RIVER_SWIM_Z + 0.2) * 10;
    if (fish.pos.z < -RIVER_SWIM_Z + 0.2) acc.z += (-RIVER_SWIM_Z + 0.2 - fish.pos.z) * 10;
    fish.vel.addScaledVector(acc, dt);
    fish.vel.y = 0;
    const speed = fish.vel.length();
    if (speed > maxSpeed) fish.vel.multiplyScalar(maxSpeed / speed);
    else if (speed < minSpeed) fish.vel.multiplyScalar(minSpeed / Math.max(speed, 1e-4));
    fish.pos.addScaledVector(fish.vel, dt);
    fish.pos.x = Math.max(-RIVER_SWIM_X, Math.min(RIVER_SWIM_X, fish.pos.x));
    fish.pos.z = Math.max(-RIVER_SWIM_Z, Math.min(RIVER_SWIM_Z, fish.pos.z));
  }

  #pose(fish: Fish, wiggleAmount: number): Quaternion {
    const speed = fish.vel.length();
    const yaw = Math.atan2(-fish.vel.z, fish.vel.x);
    const wiggle = fish.mode === 'swim' ? Math.sin(this.#ctx.time * (10 + speed * 14) + fish.phase) * wiggleAmount * (0.4 + speed) : 0;
    tmpEuler.set(fish.roll, yaw + wiggle, fish.pitch);
    return tmpQuat.setFromEuler(tmpEuler);
  }

  #write(mesh: InstancedMesh, index: number, fish: Fish, scale: number): void {
    tmpScale.setScalar(fish.mode === 'jump' && fish.t < 0 ? 0.0001 : scale);
    tmpMatrix.compose(fish.pos, this.#pose(fish, 0.2), tmpScale);
    mesh.setMatrixAt(index, tmpMatrix);
  }

  // -------------------------------------------------------------- tucunaré

  #updateHunter(dt: number): void {
    const fish = this.#hunter;
    const hunt = this.#hunt;
    const rng = this.#ctx.rng;
    fish.flee = Math.max(0, fish.flee - dt);
    acc.set(0, 0, 0);
    if (!hunt.active) {
      hunt.timer -= dt;
      if (hunt.timer <= 0 && this.#fish.length > 0 && fish.flee <= 0) {
        hunt.active = true;
        hunt.elapsed = 0;
        const prey = rng.pick(this.#fish);
        hunt.target.copy(prey.pos);
      }
      if (fish.pos.distanceTo(hunt.target) < 0.5 || rng.chance(dt * 0.15)) {
        hunt.target.set(rng.range(-RIVER_SWIM_X, RIVER_SWIM_X), 0, rng.range(-0.8, 0.8));
      }
      acc.addScaledVector(hunt.target.clone().sub(fish.pos).setY(0).normalize(), 0.6);
    } else {
      hunt.elapsed += dt;
      acc.addScaledVector(hunt.target.clone().sub(fish.pos).setY(0).normalize(), 4);
      if (hunt.elapsed > 3 || flatDistance(fish.pos, hunt.target) < 0.25) {
        hunt.active = false;
        hunt.timer = rng.range(10, 20);
        hunt.target.set(rng.range(-RIVER_SWIM_X, RIVER_SWIM_X), 0, rng.range(-0.8, 0.8));
        if (rng.chance(0.4)) this.#ctx.splash(fish.pos.clone().setY(WATER_LEVEL), 0.6);
      }
    }
    for (const threat of this.#threats) this.#avoid(fish, threat.at, threat.radius, 4);
    this.#steer(fish, dt, hunt.active || fish.flee > 0 ? 1.4 : 0.35, 0.15);
    fish.pos.y += (swimY(fish) - fish.pos.y) * Math.min(1, dt * 2);
    this.#tucunare.position.copy(fish.pos);
    this.#tucunare.quaternion.copy(this.#pose(fish, 0.12));
  }

  // -------------------------------------------------------------- carp

  #updateCarp(dt: number): void {
    const fish = this.#carpFish;
    const rng = this.#ctx.rng;
    if (fish.mode !== 'jump') {
      this.#carpTimer -= dt;
      if (this.#carpTimer > 0) return;
      this.#carpTimer = rng.range(25, 50);
      fish.pos.set(rng.range(-RIVER_SWIM_X + 1, RIVER_SWIM_X - 1), 0, rng.range(-0.7, 0.7));
      fish.vel.set(rng.chance(0.5) ? 1 : -1, 0, rng.range(-0.3, 0.3));
      this.#startJump(fish, rng.range(1.1, 1.5), rng.range(0.6, 0.8), 1.05);
      fish.roll = 0;
      this.#carp.visible = true;
    }
    const landed = this.#stepJump(fish, dt, 2.1);
    const u = Math.min(1, Math.max(0, fish.t / fish.jumpTime));
    fish.roll = Math.sin(u * Math.PI) * 0.6;
    this.#carp.position.copy(fish.pos);
    this.#carp.quaternion.copy(this.#pose(fish, 0));
    if (landed) {
      fish.mode = 'swim';
      this.#carp.visible = false;
      this.#ctx.sound('splash', fish.to);
    }
  }

  // -------------------------------------------------------------- pirarucu

  #updateGiant(dt: number): void {
    const g = this.#giant;
    const rng = this.#ctx.rng;
    const mesh = this.#pirarucu;
    if (g.phase === 'hidden') {
      g.timer -= dt;
      if (g.timer > 0) return;
      g.timer = rng.range(150, 300);
      g.phase = 'bubbles';
      g.t = 0;
      g.dir = rng.chance(0.5) ? 1 : -1;
      g.at.set(rng.range(-RIVER_SWIM_X + 2, RIVER_SWIM_X - 2), -0.26, rng.range(-0.15, 0.15));
      mesh.visible = true;
      mesh.rotation.set(0, g.dir > 0 ? 0 : Math.PI, 0);
    }
    g.t += dt;
    const surface = new Vector3(g.at.x, WATER_LEVEL, g.at.z);
    if (g.phase === 'bubbles') {
      if (rng.chance(dt * 9)) this.#ctx.bubbles(surface.clone().setY(WATER_LEVEL - 0.01), 3);
      if (rng.chance(dt * 1.5)) this.#ctx.lake.addRipple(g.at.x + rng.range(-0.2, 0.2), g.at.z, 0.25);
      mesh.position.set(g.at.x, -0.26 + Math.min(1, g.t / 2.5) * 0.12, g.at.z);
      if (g.t > 2.5) {
        g.phase = 'surface';
        g.t = 0;
        this.#ctx.lake.addRipple(g.at.x, g.at.z, 1.3);
        this.#ctx.bubbles(surface, 12);
        this.#ctx.sound('plop', surface);
      }
    } else if (g.phase === 'surface') {
      const k = Math.min(1, g.t / 0.6);
      mesh.position.set(g.at.x + g.dir * g.t * 0.08, -0.14 + k * (WATER_LEVEL - 0.05 + 0.14), g.at.z);
      mesh.rotation.z = 0.12 * k;
      if (g.t > 1.8) {
        g.phase = 'dive';
        g.t = 0;
        this.#ctx.splash(surface.clone().setX(g.at.x - g.dir * 0.5), 1.2);
      }
    } else if (g.phase === 'dive') {
      const k = Math.min(1, g.t / 1.8);
      mesh.position.set(g.at.x + g.dir * (0.15 + k * 0.6), WATER_LEVEL - 0.05 - k * 0.24, g.at.z);
      mesh.rotation.z = -0.2 * Math.sin(Math.PI * k);
      if (k >= 1) {
        g.phase = 'hidden';
        mesh.visible = false;
      }
    }
  }

  #mesh(geometry: ReturnType<typeof fishGeometry>): Mesh {
    const mesh = new Mesh(geometry, this.#material);
    mesh.castShadow = false;
    this.group.add(mesh);
    return mesh;
  }
}
