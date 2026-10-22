import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  ConeGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { PLATE_HALF_X, RIVER_SWIM_Z, WATER_LEVEL } from '../layout';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext } from './shared';

export type BoatStyle = 'felucca' | 'cargo' | 'trireme' | 'longship' | 'junk' | 'caique';

const END = PLATE_HALF_X - 0.4;

function mesh(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function hull(length: number, beam: number, depth: number, material: Material): Mesh {
  const h = new Mesh(new SphereGeometry(0.5, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), material);
  h.scale.set(length, depth * 2, beam);
  h.castShadow = true;
  return h;
}

function triangleSail(width: number, height: number, material: Material): Mesh {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.lineTo(width, 0);
  shape.lineTo(width * 0.05, height);
  shape.closePath();
  const m = new Mesh(new ShapeGeometry(shape), material);
  m.castShadow = true;
  return m;
}

interface Rig {
  root: Group;
  oars: Group[];
  sail: Mesh | null;
}

/** Builds the boat in a +x forward frame, waterline at y = 0. */
function buildBoat(style: BoatStyle): Rig {
  const root = new Group();
  const oars: Group[] = [];
  const wood = new MeshStandardMaterial({ color: new Color('#7a4a26'), roughness: 0.7 });
  const darkWood = new MeshStandardMaterial({ color: new Color('#4b2c16'), roughness: 0.8 });
  const sailcloth = new MeshStandardMaterial({ color: new Color(style === 'cargo' ? '#d9b26a' : '#efe7d4'), roughness: 0.85, side: DoubleSide });
  let sail: Mesh | null = null;

  if (style === 'caique') {
    // Bosphorus caïque: long, low and pointed at both ends, a rower under a small awning.
    const paint = new MeshStandardMaterial({ color: new Color('#e8dcc4'), roughness: 0.6 });
    const trim = new MeshStandardMaterial({ color: new Color('#b8322a'), roughness: 0.6 });
    root.add(hull(1.2, 0.2, 0.06, paint));
    root.add(mesh(new BoxGeometry(1.05, 0.012, 0.21), trim, 0, 0.01, 0));
    for (const s of [-1, 1]) {
      const post = mesh(new ConeGeometry(0.02, 0.16, 5), darkWood, s * 0.6, 0.06, 0);
      post.rotation.z = -s * 0.9;
      root.add(post);
    }
    root.add(mesh(new BoxGeometry(0.3, 0.012, 0.22), trim, 0.22, 0.2, 0));
    for (const sx of [0.1, 0.34]) for (const sz of [-1, 1]) root.add(mesh(new CylinderGeometry(0.005, 0.005, 0.19, 4), darkWood, sx, 0.1, sz * 0.09));
    const rower = mesh(new SphereGeometry(0.04, 8, 6), new MeshStandardMaterial({ color: new Color('#3a4a6a'), roughness: 0.7 }), -0.12, 0.07, 0);
    rower.scale.set(1, 1.3, 1);
    root.add(rower);
    for (const s of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(-0.12, 0.04, s * 0.1);
      const oar = mesh(new BoxGeometry(0.008, 0.008, 0.36), darkWood, 0, -0.05, s * 0.17);
      oar.rotation.x = s * 0.4;
      pivot.add(oar);
      root.add(pivot);
      oars.push(pivot);
    }
  } else if (style === 'longship') {
    // Drakkar: dragon prow, curled stern, a row of round shields and a striped sail.
    root.add(hull(1.35, 0.3, 0.08, wood));
    root.add(mesh(new BoxGeometry(1.15, 0.02, 0.24), darkWood, 0, 0.005, 0));
    const neck = mesh(new TorusGeometry(0.12, 0.022, 6, 12, Math.PI * 0.7), wood, -0.62, 0.1, 0);
    neck.rotation.z = Math.PI * 0.35;
    const head = mesh(new SphereGeometry(0.035, 8, 6), darkWood, -0.72, 0.24, 0);
    head.scale.set(1.6, 0.9, 0.8);
    const tail = mesh(new TorusGeometry(0.1, 0.02, 6, 12, Math.PI * 0.9), wood, 0.64, 0.1, 0);
    root.add(neck, head, tail);
    const colours = ['#b8322a', '#e2c04a', '#2f5a8a'].map((c) => new MeshStandardMaterial({ color: new Color(c), roughness: 0.6 }));
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const shield = mesh(new CylinderGeometry(0.045, 0.045, 0.01, 12), colours[i % 3]!, -0.4 + i * 0.16, 0.04, side * 0.15);
        shield.rotation.x = Math.PI / 2;
        root.add(shield);
      }
    }
    root.add(mesh(new CylinderGeometry(0.008, 0.01, 0.55, 6), darkWood, 0, 0.28, 0));
    const red = new MeshStandardMaterial({ color: new Color('#a8282a'), roughness: 0.85, side: DoubleSide });
    for (let i = 0; i < 4; i++) {
      const stripe = mesh(new BoxGeometry(0.004, 0.3, 0.1), i % 2 ? sailcloth : red, 0.01, 0.34, -0.15 + i * 0.1);
      root.add(stripe);
    }
    const yard = mesh(new CylinderGeometry(0.006, 0.006, 0.46, 6), darkWood, 0.01, 0.5, 0);
    yard.rotation.x = Math.PI / 2;
    root.add(yard);
  } else if (style === 'junk') {
    // Junk: flat hull with a raised stern and ribbed, battened sails.
    const tan = new MeshStandardMaterial({ color: new Color('#b07a4a'), roughness: 0.9, side: DoubleSide });
    root.add(mesh(new BoxGeometry(1.0, 0.1, 0.32), wood, 0, -0.01, 0));
    root.add(mesh(new BoxGeometry(0.24, 0.14, 0.32), darkWood, 0.42, 0.08, 0));
    root.add(mesh(new BoxGeometry(0.14, 0.06, 0.3), darkWood, -0.46, 0.04, 0));
    for (const [x, h] of [[-0.12, 0.62], [0.18, 0.48]] as const) {
      root.add(mesh(new CylinderGeometry(0.008, 0.01, h, 6), darkWood, x, h / 2, 0));
      const panel = mesh(new BoxGeometry(0.004, h * 0.7, 0.3), tan, x + 0.01, h * 0.55, 0);
      root.add(panel);
      for (let i = 0; i < 5; i++) root.add(mesh(new BoxGeometry(0.01, 0.008, 0.32), darkWood, x + 0.012, h * 0.22 + i * h * 0.14, 0));
      sail = panel;
    }
  } else if (style === 'felucca') {
    root.add(hull(0.9, 0.24, 0.07, wood));
    root.add(mesh(new BoxGeometry(0.75, 0.012, 0.2), darkWood, 0, 0.0, 0));
    root.add(mesh(new CylinderGeometry(0.008, 0.01, 0.55, 6), darkWood, 0.12, 0.27, 0));
    const yard = mesh(new CylinderGeometry(0.006, 0.006, 0.95, 6), darkWood, 0.05, 0.42, 0);
    yard.rotation.z = -1.0;
    root.add(yard);
    sail = triangleSail(0.62, 0.7, sailcloth);
    sail.position.set(-0.26, 0.04, 0.005);
    root.add(sail);
  } else if (style === 'cargo') {
    // A round-bellied merchant ship with a square sail and amphorae on deck.
    root.add(hull(1.0, 0.36, 0.1, wood));
    root.add(mesh(new BoxGeometry(0.86, 0.014, 0.3), darkWood, 0, 0.005, 0));
    const neck = new TorusGeometry(0.05, 0.012, 6, 12, Math.PI * 1.3);
    root.add(mesh(neck, darkWood, -0.47, 0.08, 0));
    root.add(mesh(new CylinderGeometry(0.01, 0.012, 0.62, 6), darkWood, 0.06, 0.31, 0));
    const yard = mesh(new CylinderGeometry(0.006, 0.006, 0.5, 6), darkWood, 0.06, 0.56, 0);
    yard.rotation.x = Math.PI / 2;
    root.add(yard);
    sail = mesh(new BoxGeometry(0.004, 0.36, 0.46), sailcloth, 0.07, 0.37, 0);
    root.add(sail);
    root.add(mesh(new BoxGeometry(0.006, 0.05, 0.46), new MeshStandardMaterial({ color: new Color('#9a2e22'), roughness: 0.8 }), 0.075, 0.43, 0));
    const amphora = new LatheGeometry(
      [[0, 0], [0.018, 0.005], [0.03, 0.035], [0.028, 0.07], [0.012, 0.09], [0.01, 0.11], [0.014, 0.115], [0, 0.115]].map(([x, y]) => new Vector2(x, y)),
      10,
    );
    const clay = new MeshStandardMaterial({ color: new Color('#b4643c'), roughness: 0.8 });
    for (let i = 0; i < 6; i++) root.add(mesh(amphora, clay, -0.3 + (i % 3) * 0.1, 0.008, (i < 3 ? -1 : 1) * 0.07));
    const steer = mesh(new BoxGeometry(0.02, 0.22, 0.05), darkWood, -0.44, 0.0, 0.16);
    steer.rotation.z = 0.6;
    root.add(steer);
  } else {
    // Trireme: long and narrow, a bronze ram, a painted eye and a row of oars.
    const bronze = new MeshStandardMaterial({ color: new Color('#b0863e'), roughness: 0.35, metalness: 0.7 });
    const paint = new MeshStandardMaterial({ color: new Color('#2a3f63'), roughness: 0.6 });
    root.add(hull(1.3, 0.24, 0.08, paint));
    root.add(mesh(new BoxGeometry(1.15, 0.03, 0.2), wood, 0, 0.012, 0));
    const ram = mesh(new CylinderGeometry(0.0, 0.03, 0.14, 6), bronze, 0.68, -0.02, 0);
    ram.rotation.z = -Math.PI / 2;
    root.add(ram);
    for (const side of [-1, 1]) {
      const eye = mesh(new SphereGeometry(0.018, 8, 6), new MeshStandardMaterial({ color: new Color('#f1ece0'), roughness: 0.4 }), 0.55, 0.03, side * 0.08);
      eye.scale.set(1.4, 1, 0.4);
      root.add(eye);
    }
    const stern = mesh(new TorusGeometry(0.09, 0.014, 6, 12, Math.PI * 0.9), paint, -0.62, 0.08, 0);
    stern.rotation.z = 0.4;
    root.add(stern);
    root.add(mesh(new CylinderGeometry(0.008, 0.01, 0.5, 6), darkWood, 0.05, 0.26, 0));
    sail = mesh(new BoxGeometry(0.004, 0.26, 0.4), sailcloth, 0.06, 0.32, 0);
    root.add(sail);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const pivot = new Group();
        pivot.position.set(-0.42 + i * 0.1, 0.03, side * 0.12);
        const oar = mesh(new BoxGeometry(0.008, 0.008, 0.26), darkWood, 0, -0.05, side * 0.12);
        oar.rotation.x = side * 0.45;
        pivot.add(oar);
        root.add(pivot);
        oars.push(pivot);
      }
    }
  }
  return { root, oars, sail };
}

interface Boat {
  rig: Rig;
  pos: Vector3;
  push: Vector3;
  roll: number;
  rollVel: number;
  speed: number;
  phase: number;
}

/**
 * Working boats drifting (or rowing) down the river: a Nile felucca, a Roman
 * cargo ship or a small Greek trireme. They rock when something explodes.
 */
export class BoatModule implements LifeModule {
  readonly group: Group;
  readonly #ctx: WildlifeContext;
  readonly #style: BoatStyle;
  readonly #boats: Boat[] = [];

  constructor(ctx: WildlifeContext, style: BoatStyle) {
    this.#ctx = ctx;
    this.#style = style;
    this.group = newGroup(`boats-${style}`);
    const count = style === 'cargo' && ctx.high ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const rig = buildBoat(style);
      rig.root.scale.setScalar(style === 'trireme' ? 1.25 : 1.35);
      this.group.add(rig.root);
      this.#boats.push({
        rig,
        pos: new Vector3(ctx.rng.range(-8, 6) + i * 9, WATER_LEVEL, (i % 2 ? 1 : -1) * ctx.rng.range(0.1, 0.5)),
        push: new Vector3(),
        roll: 0,
        rollVel: 0,
        speed: style === 'trireme' ? 0.32 : ctx.rng.range(0.1, 0.16),
        phase: ctx.rng.range(0, 6),
      });
    }
  }

  trigger(event: string): boolean {
    if (event !== 'boat') return false;
    for (const boat of this.#boats) boat.rollVel += 3;
    return true;
  }

  onExplosion(at: Vector3, power: number): void {
    for (const boat of this.#boats) {
      const d = flatDistance(at, boat.pos);
      if (d > 5) continue;
      boat.rollVel += (at.z > boat.pos.z ? -1 : 1) * (5 - d) * 0.3 * Math.max(0.5, power);
      boat.push.add(boat.pos.clone().sub(at).setY(0).normalize().multiplyScalar((5 - d) * 0.06));
    }
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    const time = ctx.time;
    for (const boat of this.#boats) {
      boat.pos.x += (boat.speed + boat.push.x) * dt;
      boat.pos.z += (Math.sin(time * 0.11 + boat.phase) * 0.025 + boat.push.z) * dt;
      boat.pos.z = Math.max(-RIVER_SWIM_Z + 0.15, Math.min(RIVER_SWIM_Z - 0.15, boat.pos.z));
      boat.push.multiplyScalar(Math.exp(-dt * 1.2));
      if (boat.pos.x > END) boat.pos.x = -END;
      boat.rollVel += (-boat.roll * 16 - boat.rollVel * 2) * dt;
      boat.roll += boat.rollVel * dt;
      const fade = Math.min(1, Math.max(0, (END - Math.abs(boat.pos.x)) / 0.9));
      const root = boat.rig.root;
      root.visible = fade > 0.01;
      root.position.set(boat.pos.x, ctx.lake.surfaceY(boat.pos.x, boat.pos.z) + 0.05 - (1 - fade) * 0.4, boat.pos.z);
      root.rotation.set(boat.roll + Math.sin(time * 1.2 + boat.phase) * 0.03, Math.sin(time * 0.15 + boat.phase) * 0.08, Math.sin(time * 0.9 + boat.phase) * 0.02);
      if (boat.rig.sail) boat.rig.sail.rotation.y = Math.sin(time * 0.7 + boat.phase) * 0.06;
      // Oars sweep in unison: back through the water, lifted forward.
      boat.rig.oars.forEach((oar, i) => {
        const stroke = time * 2.4 + boat.phase;
        const side = i < boat.rig.oars.length / 2 ? 1 : -1;
        oar.rotation.y = Math.sin(stroke) * 0.35 * side;
        oar.rotation.x = Math.max(0, Math.cos(stroke)) * 0.25 * side;
      });
      if (ctx.rng.chance(dt * (this.#style === 'trireme' ? 3 : 0.5))) ctx.lake.addRipple(boat.pos.x - 0.4, boat.pos.z, 0.15);
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }
}
