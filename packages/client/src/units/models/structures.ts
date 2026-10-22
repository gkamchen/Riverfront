import {
  BoxGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { SKIN, cached, lathe, merge, mesh, part, ring, type Tint } from '../parts';
import { Puffs, UnitModel, pivot, type UnitFactoryOptions } from '../unitModel';
import { lerpTo, shudder, throwPart, topple } from './motion';

const UP = new Vector3(0, 1, 0);

/** Thin cylinder from a to b. */
function strut(a: Vector3, b: Vector3, radius: number, tint: Tint): BufferGeometry {
  const direction = b.clone().sub(a);
  const length = direction.length();
  const geometry = new CylinderGeometry(radius, radius, length, 6);
  const q = new Quaternion().setFromUnitVectors(UP, direction.normalize());
  geometry.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
  return part(geometry, tint);
}

let beaconMaterial: MeshBasicMaterial | null = null;
function beacon(): Mesh {
  beaconMaterial ??= new MeshBasicMaterial({ color: 0xff3a22, toneMapped: false });
  beaconMaterial.color.setRGB(4, 0.5, 0.25);
  const m = new Mesh(new SphereGeometry(0.035, 10, 8), beaconMaterial);
  m.name = 'beacon';
  return m;
}

// ------------------------------------------------------------------ antenna (L of 3)

// Cell centres of the L in the canonical frame (centroid at the origin).
const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);
const MAST_SPLIT = 0.8;
const MAST_TOP = 1.55;

function mastSection(y0: number, y1: number, w0: number, w1: number, tint: Tint): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const at = (y: number) => w0 + (w1 - w0) * ((y - y0) / (y1 - y0));
  corners.forEach(([sx, sz]) => {
    parts.push(strut(new Vector3(sx * w0, y0, sz * w0), new Vector3(sx * w1, y1, sz * w1), 0.018, tint));
  });
  const levels = 3;
  for (let l = 0; l <= levels; l++) {
    const ya = y0 + ((y1 - y0) * l) / levels;
    const wa = at(ya);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k]!;
      const [bx, bz] = corners[(k + 1) % 4]!;
      parts.push(strut(new Vector3(ax * wa, ya, az * wa), new Vector3(bx * wa, ya, bz * wa), 0.01, SKIN.metalLight));
      if (l < levels) {
        const yb = y0 + ((y1 - y0) * (l + 1)) / levels;
        const wb = at(yb);
        parts.push(strut(new Vector3(ax * wa, ya, az * wa), new Vector3(bx * wb, yb, bz * wb), 0.007, SKIN.metalLight));
      }
    }
  }
  return merge(parts);
}

function antennaGround(): BufferGeometry {
  const parts = [
    // Mast footing.
    part(new BoxGeometry(0.62, 0.05, 0.62), SKIN.concrete, { x: ANT_B.x, y: 0.025, z: ANT_B.z }),
    // Control cabin.
    part(new BoxGeometry(0.66, 0.34, 0.58), SKIN.concrete, { x: ANT_A.x, y: 0.17, z: ANT_A.z }),
    part(new BoxGeometry(0.74, 0.05, 0.66), 'main', { x: ANT_A.x, y: 0.365, z: ANT_A.z, rx: 0.08 }),
    part(new BoxGeometry(0.16, 0.22, 0.02), SKIN.woodDark, { x: ANT_A.x - 0.12, y: 0.11, z: ANT_A.z - 0.295 }),
    part(new BoxGeometry(0.02, 0.07, 0.4), 'glow', { x: ANT_A.x + 0.335, y: 0.24, z: ANT_A.z }),
    part(new BoxGeometry(0.3, 0.07, 0.02), 'glow', { x: ANT_A.x + 0.1, y: 0.24, z: ANT_A.z - 0.295 }),
    // Equipment cabinet and the upward dish on the third cell.
    part(new BoxGeometry(0.28, 0.3, 0.24), 'dark', { x: ANT_C.x + 0.12, y: 0.15, z: ANT_C.z + 0.12 }),
    part(new BoxGeometry(0.2, 0.03, 0.02), SKIN.gold, { x: ANT_C.x + 0.12, y: 0.24, z: ANT_C.z - 0.005 }),
    part(new CylinderGeometry(0.025, 0.035, 0.28, 8), SKIN.metal, { x: ANT_C.x - 0.12, y: 0.14, z: ANT_C.z - 0.08 }),
    part(lathe([[0, 0], [0.12, 0.03], [0.2, 0.08], [0.19, 0.085], [0.11, 0.04], [0, 0.012]], 18), SKIN.white, {
      x: ANT_C.x - 0.12,
      y: 0.3,
      z: ANT_C.z - 0.08,
      rx: 0.45,
    }),
  ];
  // Cable trays from the mast to the cabin and cabinet.
  parts.push(part(new BoxGeometry(0.06, 0.03, 0.62), SKIN.rubber, { x: ANT_B.x, y: 0.015, z: (ANT_A.z + ANT_B.z) / 2 }));
  parts.push(part(new BoxGeometry(0.7, 0.03, 0.06), SKIN.rubber, { x: (ANT_B.x + ANT_C.x) / 2, y: 0.015, z: ANT_B.z + 0.1 }));
  return merge(parts);
}

function radarDish(): BufferGeometry {
  const profile: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const r = (i / 8) * 0.26;
    profile.push([r, r * r * 1.5]);
  }
  for (let i = 8; i >= 0; i--) {
    const r = (i / 8) * 0.26;
    profile.push([r * 0.98, r * r * 1.5 - 0.016]);
  }
  return merge([
    part(lathe(profile, 24), SKIN.white, { rx: -Math.PI / 2 + 0.35, z: -0.06 }),
    part(new CylinderGeometry(0.012, 0.012, 0.22, 6), SKIN.metal, { z: -0.15, y: 0.04, rx: Math.PI / 2 - 0.35 }),
    part(new SphereGeometry(0.025, 8, 6), 'main', { z: -0.24, y: 0.085 }),
    part(new BoxGeometry(0.08, 0.1, 0.08), SKIN.metal, { y: -0.04 }),
  ]);
}

export function createAntenna({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('antenna', body);
  model.add(mesh(cached('antenna-ground', antennaGround), body, 'ground'));

  const mast = new Group();
  mast.position.set(ANT_B.x, 0.05, ANT_B.z);
  mast.add(mesh(cached('antenna-mast-low', () => mastSection(0, MAST_SPLIT, 0.22, 0.13, 'main')), body, 'mast-low'));
  const upper = new Group();
  upper.position.y = MAST_SPLIT;
  upper.add(mesh(cached('antenna-mast-up', () => mastSection(0, MAST_TOP - MAST_SPLIT, 0.13, 0.06, SKIN.white)), body, 'mast-up'));
  mast.add(upper);
  model.add(mast);

  const radar = new Group();
  radar.position.y = MAST_TOP - MAST_SPLIT + 0.08;
  radar.add(mesh(cached('antenna-dish', radarDish), body, 'dish'));
  upper.add(radar);
  const light = beacon();
  light.position.y = MAST_TOP - MAST_SPLIT + 0.2;
  upper.add(light);

  const anchor = new Group();
  anchor.position.set(0.06, MAST_TOP - MAST_SPLIT - 0.1, 0);
  upper.add(anchor);
  model.flagAnchor = anchor;

  const phase = Math.random() * 6;
  let alive = true;
  model.idle = (time, dt) => {
    radar.rotation.y += dt * 1.1;
    light.visible = alive && Math.sin(time * 3.2 + phase) > 0.35;
  };

  model.wreck = async (ctx) => {
    alive = false;
    light.visible = false;
    ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, MAST_TOP, ANT_B.z)));
    model.attach(radar);
    const landing = ANT_C.clone().add(new Vector3(0.1 - ctx.random() * 0.2, 0.06, -0.25));
    const dishFall = throwPart(ctx, radar, landing, 0.35, 0.85, new Vector3(2.2, 3, 1.4), new Vector3(Math.PI / 2 - 0.2, 1.4, 0.3));
    // The upper half of the mast buckles over towards the dish.
    const buckle = lerpTo(ctx, 0.25, (e) => {
      upper.rotation.x = 0.06 * e;
    }).then(() => topple(ctx, upper, 'z', -1.25, 0.95));
    await Promise.all([dishFall, buckle]);
  };
  return model;
}

// ------------------------------------------------------------------ bunker (2x2)

const B_HALF = 0.88;
const B_THICK = 0.14;
const B_HEIGHT = 0.42;

function bunkerFrontWall(z: number): BufferGeometry {
  const len = B_HALF * 2;
  return merge([
    part(new BoxGeometry(len, 0.26, B_THICK), SKIN.concrete, { y: 0.13, z }),
    part(new BoxGeometry(len, 0.1, B_THICK), SKIN.concrete, { y: 0.37, z }),
    part(new BoxGeometry(0.23, 0.06, B_THICK), SKIN.concrete, { x: -B_HALF + 0.115, y: 0.29, z }),
    part(new BoxGeometry(0.23, 0.06, B_THICK), SKIN.concrete, { x: B_HALF - 0.115, y: 0.29, z }),
    part(new BoxGeometry(len + 0.01, 0.04, B_THICK + 0.01), 'main', { y: 0.4, z }),
  ]);
}

function bunkerSideWall(x: number): BufferGeometry {
  const len = B_HALF * 2 - B_THICK * 2;
  return merge([
    part(new BoxGeometry(B_THICK, B_HEIGHT, len), SKIN.concrete, { x, y: B_HEIGHT / 2 }),
    part(new BoxGeometry(B_THICK + 0.01, 0.04, len), 'main', { x, y: 0.4 }),
    part(new BoxGeometry(B_THICK + 0.012, 0.08, 0.08), SKIN.concreteDark, { x, y: 0.2, z: -0.3 }),
  ]);
}

function bunkerRoofHalf(sign: number): BufferGeometry {
  return merge([
    part(new BoxGeometry(B_HALF, 0.1, B_HALF * 2 + 0.04), SKIN.concreteDark, { x: (sign * B_HALF) / 2, y: B_HEIGHT + 0.05 }),
    part(new BoxGeometry(B_HALF - 0.08, 0.012, 0.22), 'main', { x: (sign * B_HALF) / 2, y: B_HEIGHT + 0.106, z: 0.3 }),
    part(new BoxGeometry(B_HALF - 0.08, 0.012, 0.06), SKIN.gold, { x: (sign * B_HALF) / 2, y: B_HEIGHT + 0.106, z: 0.15 }),
  ]);
}

function bunkerCore(): BufferGeometry {
  return merge([
    part(new BoxGeometry(B_HALF * 2 - B_THICK * 2, B_HEIGHT - 0.02, B_HALF * 2 - B_THICK * 2), SKIN.black, { y: B_HEIGHT / 2 }),
    part(new BoxGeometry(1.2, 0.035, 0.03), 'glow', { y: 0.29, z: -B_HALF + B_THICK + 0.02 }),
  ]);
}

function cupola(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.13, 0.15, 0.1, 16), SKIN.metal, { y: 0.05 }),
    part(new BoxGeometry(0.1, 0.09, 0.14), SKIN.metal, { y: 0.14 }),
    part(new BoxGeometry(0.07, 0.03, 0.02), 'glow', { y: 0.15, z: -0.075 }),
  ]);
}

export function createBunker({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('bunker', body);
  const core = mesh(cached('bunker-core', bunkerCore), body, 'core');
  model.add(core);

  const wall = (key: string, build: () => BufferGeometry, at: Vector3) => {
    const m = mesh(cached(key, build), body, key);
    const p = pivot(m, at);
    model.add(p);
    return p;
  };
  const front = wall('bunker-front', () => bunkerFrontWall(-B_HALF + B_THICK / 2), new Vector3(0, 0, -B_HALF));
  const back = wall('bunker-back', () => bunkerFrontWall(B_HALF - B_THICK / 2), new Vector3(0, 0, B_HALF));
  const left = wall('bunker-left', () => bunkerSideWall(-B_HALF + B_THICK / 2), new Vector3(-B_HALF, 0, 0));
  const right = wall('bunker-right', () => bunkerSideWall(B_HALF - B_THICK / 2), new Vector3(B_HALF, 0, 0));
  const roofL = mesh(cached('bunker-roof-l', () => bunkerRoofHalf(-1)), body, 'roof-l');
  const roofR = mesh(cached('bunker-roof-r', () => bunkerRoofHalf(1)), body, 'roof-r');
  model.add(roofL, roofR);

  const scope = mesh(cached('bunker-cupola', cupola), body, 'cupola');
  scope.position.set(0.25, B_HEIGHT + 0.1, -0.2);
  model.add(scope);

  const phase = Math.random() * 6;
  model.idle = (time) => {
    scope.rotation.y = Math.sin(time * 0.3 + phase) * 1.2;
  };

  model.wreck = async (ctx) => {
    await shudder(ctx, model, 0.04, 0.22);
    ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
    model.attach(scope);
    const scopeOff = throwPart(ctx, scope, new Vector3(0.7, 0.05, -1.05), 0.6, 0.8, new Vector3(2, 4, 1), new Vector3(Math.PI / 2, 2, 0));
    // Walls fall outwards around their footing, staggered so the slabs read individually.
    const tip = 1.3 + ctx.random() * 0.15;
    const walls = [
      topple(ctx, front, 'x', -tip, 0.8, 0),
      topple(ctx, right, 'z', -tip * 0.92, 0.85, 0.08),
      topple(ctx, back, 'x', tip * 0.95, 0.85, 0.14),
      topple(ctx, left, 'z', tip, 0.9, 0.05),
    ];
    const roof = lerpTo(ctx, 0.55, (e) => {
      roofL.position.y = -0.36 * e;
      roofR.position.y = -0.33 * e;
      roofL.rotation.z = 0.22 * e;
      roofR.rotation.z = -0.3 * e;
      roofR.rotation.y = 0.12 * e;
      core.scale.y = 1 - 0.78 * e;
    }, 0.12);
    await Promise.all([scopeOff, roof, ...walls]);
  };
  return model;
}

// ------------------------------------------------------------------ generator (1x1)

const TANK_AT = new Vector3(-0.1, 0.06, 0.05);
const COIL_AT = new Vector3(0.2, 0.06, -0.14);

function generatorBase(): BufferGeometry {
  const parts = [
    part(new BoxGeometry(0.76, 0.06, 0.76), 'dark', { y: 0.03 }),
    part(new BoxGeometry(0.78, 0.015, 0.06), SKIN.gold, { y: 0.06, z: 0.33 }),
    strut(new Vector3(COIL_AT.x, 0.07, COIL_AT.z), new Vector3(TANK_AT.x + 0.1, 0.07, TANK_AT.z - 0.1), 0.018, SKIN.rubber),
  ];
  return merge(parts);
}

function generatorTank(): BufferGeometry {
  const parts = [
    part(lathe([[0, 0], [0.2, 0], [0.205, 0.05], [0.2, 0.38], [0.17, 0.44], [0.08, 0.47], [0, 0.47]]), 'main'),
    part(ring(0.205, 0.014, 0.1), SKIN.gold),
    part(ring(0.2, 0.014, 0.34), SKIN.gold),
    part(new CylinderGeometry(0.028, 0.028, 0.22, 10), SKIN.metal, { x: -0.06, y: 0.52, z: 0.08 }),
    part(new CylinderGeometry(0.036, 0.036, 0.03, 10), SKIN.metal, { x: -0.06, y: 0.63, z: 0.08 }),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(part(new BoxGeometry(0.06, 0.2, 0.012), SKIN.metalLight, { x: Math.cos(a) * 0.22, y: 0.22, z: Math.sin(a) * 0.22, ry: -a }));
  }
  return merge(parts);
}

function generatorCoils(): BufferGeometry {
  const parts = [part(new CylinderGeometry(0.04, 0.05, 0.48, 10), SKIN.copper, { y: 0.24 })];
  for (let i = 0; i < 4; i++) parts.push(part(new TorusGeometry(0.085 - i * 0.008, 0.018, 8, 20), 'glow', { rx: Math.PI / 2, y: 0.1 + i * 0.1 }));
  return merge(parts);
}

function generatorCap(): BufferGeometry {
  return merge([
    part(new SphereGeometry(0.06, 14, 10), SKIN.metalLight),
    part(new TorusGeometry(0.075, 0.012, 6, 18), SKIN.gold, { rx: Math.PI / 2, y: -0.02 }),
  ]);
}

function generatorRotor(): BufferGeometry {
  const parts = [part(new CylinderGeometry(0.03, 0.03, 0.03, 10), SKIN.metal)];
  for (let i = 0; i < 4; i++) {
    parts.push(part(new BoxGeometry(0.15, 0.006, 0.035), SKIN.metalLight, { ry: (i / 4) * Math.PI, rx: 0.3 }));
  }
  return merge(parts);
}

export function createGenerator({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('generator', body);
  model.add(mesh(cached('generator-base', generatorBase), body, 'base'));
  const tank = new Group();
  tank.position.copy(TANK_AT);
  tank.add(mesh(cached('generator-tank', generatorTank), body, 'tank'));
  model.add(tank);
  const rotor = mesh(cached('generator-rotor', generatorRotor), body, 'rotor');
  rotor.position.set(0.05, 0.49, -0.03);
  tank.add(rotor);

  const coil = new Group();
  coil.position.copy(COIL_AT);
  const coils = mesh(cached('generator-coils', generatorCoils), body, 'coils');
  coil.add(coils);
  const cap = mesh(cached('generator-cap', generatorCap), body, 'cap');
  cap.position.y = 0.53;
  coil.add(cap);
  model.add(coil);

  const steam = new Puffs(new Vector3(TANK_AT.x - 0.06, TANK_AT.y + 0.66, TANK_AT.z + 0.08), 5, 1.4, 0.045);
  model.add(steam.group);

  const phase = Math.random() * 6;
  let rotorSpeed = 7;
  model.idle = (time, dt) => {
    const pulse = Math.sin(time * 6 + phase);
    coils.scale.set(1 + pulse * 0.05, 1, 1 + pulse * 0.05);
    body.userData.unit.lights.value = 0.75 + 0.25 * Math.max(0, pulse);
    rotor.rotation.y += dt * rotorSpeed;
    steam.update(dt);
  };

  model.wreck = async (ctx) => {
    steam.enabled = false;
    steam.group.visible = false;
    const electrode = () => model.worldOf(new Vector3(COIL_AT.x, COIL_AT.y + 0.55, COIL_AT.z));
    // A few last arcs while the coil dies.
    const arcs = (async () => {
      for (let i = 0; i < 4; i++) {
        ctx.emit('arc', electrode());
        body.userData.unit.lights.value = i % 2 === 0 ? 2.2 : 0.2;
        await ctx.tweens.wait(0.12 + ctx.random() * 0.08);
      }
      body.userData.unit.lights.value = 0;
    })();
    model.attach(cap);
    const capOff = throwPart(ctx, cap, new Vector3(0.38, 0.06, 0.3), 0.8, 0.8, new Vector3(5, 0, 3));
    const crumple = lerpTo(ctx, 0.9, (e) => {
      const wobble = Math.sin(e * Math.PI * 4) * (1 - e) * 0.08;
      tank.scale.set(1 + e * 0.12 + wobble, 1 - e * 0.4, 1 + e * 0.1 - wobble);
      tank.rotation.z = e * 0.12;
      coil.rotation.x = -e * 0.5;
      coil.rotation.z = -e * 0.25;
      rotorSpeed = 7 * (1 - e);
    }, 0.2);
    await Promise.all([arcs, capOff, crumple]);
  };
  return model;
}

// ------------------------------------------------------------------ workshop (1x2)

const W_EAVE_Y = 0.38;
const W_RIDGE_Y = 0.62;
const W_EAVE_Z = 0.42;
const W_PITCH = Math.atan2(W_RIDGE_Y - W_EAVE_Y, W_EAVE_Z);

function workshopShell(): BufferGeometry {
  const gable = new Shape();
  gable.moveTo(-W_EAVE_Z, 0);
  gable.lineTo(W_EAVE_Z, 0);
  gable.lineTo(W_EAVE_Z, W_EAVE_Y);
  gable.lineTo(0, W_RIDGE_Y - 0.02);
  gable.lineTo(-W_EAVE_Z, W_EAVE_Y);
  gable.closePath();
  const gableGeometry = () => {
    const g = new ExtrudeGeometry(gable, { depth: 0.06, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    return g;
  };
  return merge([
    part(new BoxGeometry(1.84, 0.05, 0.86), SKIN.concrete, { y: 0.025 }),
    part(gableGeometry(), SKIN.wood, { x: -0.84 }),
    part(gableGeometry(), SKIN.wood, { x: 0.78 }),
    part(new BoxGeometry(1.62, W_EAVE_Y, 0.05), SKIN.wood, { y: W_EAVE_Y / 2, z: W_EAVE_Z - 0.03 }),
    part(new BoxGeometry(0.55, 0.16, 0.2), SKIN.woodDark, { x: -0.2, y: 0.13, z: -0.18 }),
    part(new BoxGeometry(0.22, 0.08, 0.12), 'main', { x: 0.3, y: 0.09, z: -0.2 }),
    part(new CylinderGeometry(0.07, 0.07, 0.18, 12), SKIN.metal, { x: 0.52, y: 0.14, z: 0.05 }),
    part(new BoxGeometry(0.2, 0.04, 0.12), 'glow', { x: -0.2, y: 0.33, z: W_EAVE_Z - 0.06 }),
  ]);
}

function roofPanel(): BufferGeometry {
  const width = Math.hypot(W_EAVE_Z, W_RIDGE_Y - W_EAVE_Y) + 0.06;
  const parts = [part(new BoxGeometry(1.86, 0.03, width), 'main', { z: width / 2 - 0.04 })];
  for (let i = 0; i < 7; i++) parts.push(part(new BoxGeometry(0.03, 0.02, width), 'dark', { x: -0.81 + i * 0.27, y: 0.02, z: width / 2 - 0.04 }));
  return merge(parts);
}

function chimney(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.045, 0.05, 0.42, 10), SKIN.metal, { y: 0.21 }),
    part(new CylinderGeometry(0.07, 0.06, 0.04, 10), SKIN.metalLight, { y: 0.43 }),
  ]);
}

function craneMast(): BufferGeometry {
  return merge([
    part(new BoxGeometry(0.06, 0.72, 0.06), SKIN.brass, { y: 0.36 }),
    part(new BoxGeometry(0.16, 0.04, 0.16), SKIN.metal, { y: 0.02 }),
  ]);
}

function craneJib(): BufferGeometry {
  return merge([
    part(new BoxGeometry(0.5, 0.045, 0.045), SKIN.brass, { x: 0.22 }),
    part(new BoxGeometry(0.008, 0.2, 0.008), SKIN.black, { x: 0.44, y: -0.1 }),
    part(new TorusGeometry(0.02, 0.006, 6, 12, Math.PI * 1.4), SKIN.metal, { x: 0.44, y: -0.21 }),
    part(new BoxGeometry(0.1, 0.07, 0.07), SKIN.metal, { x: -0.06 }),
  ]);
}

function gear(): BufferGeometry {
  const parts = [part(new TorusGeometry(0.1, 0.03, 6, 16), SKIN.gold)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(part(new BoxGeometry(0.045, 0.045, 0.04), SKIN.gold, { x: Math.cos(a) * 0.14, y: Math.sin(a) * 0.14, rz: a }));
  }
  parts.push(part(new CylinderGeometry(0.035, 0.035, 0.05, 10), 'main', { rx: Math.PI / 2 }));
  return merge(parts);
}

export function createWorkshop({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('workshop', body);
  model.add(mesh(cached('workshop-shell', workshopShell), body, 'shell'));

  const panels = [-1, 1].map((sign) => {
    const holder = new Group();
    holder.position.set(0, W_EAVE_Y, sign * W_EAVE_Z);
    // Panels run from the eave up to the ridge.
    holder.rotation.y = sign > 0 ? Math.PI : 0;
    const tiltGroup = new Group();
    tiltGroup.rotation.x = -W_PITCH;
    tiltGroup.add(mesh(cached('workshop-roof', roofPanel), body, 'roof'));
    holder.add(tiltGroup);
    model.add(holder);
    return tiltGroup;
  });

  const stack = mesh(cached('workshop-chimney', chimney), body, 'chimney');
  const stackPivot = new Group();
  stackPivot.position.set(0.55, 0.42, 0.18);
  stackPivot.add(stack);
  model.add(stackPivot);
  const steam = new Puffs(new Vector3(0.55, 0.88, 0.18), 6, 1.8, 0.05);
  model.add(steam.group);

  const crane = new Group();
  crane.position.set(-0.8, 0.05, -0.38);
  crane.add(mesh(cached('workshop-crane', craneMast), body, 'crane'));
  const jib = new Group();
  jib.position.y = 0.7;
  jib.add(mesh(cached('workshop-jib', craneJib), body, 'jib'));
  crane.add(jib);
  model.add(crane);

  const cog = mesh(cached('workshop-gear', gear), body, 'gear');
  cog.position.set(-0.3, W_RIDGE_Y + 0.15, 0);
  model.add(cog);
  model.flagAnchor = cog;

  const phase = Math.random() * 6;
  model.idle = (time, dt) => {
    jib.rotation.y = 0.4 + Math.sin(time * 0.4 + phase) * 0.7;
    cog.rotation.z += dt * 0.9;
    steam.update(dt);
  };

  model.wreck = async (ctx) => {
    steam.enabled = false;
    steam.group.visible = false;
    ctx.emit('dust', model.worldOf(new Vector3(0, 0.5, 0)));
    // The ridge gives way: both panels fold down into the building.
    const roof = panels.map((panel, i) =>
      ctx.tweens.run(
        0.75,
        (t) => {
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          panel.rotation.x = -W_PITCH + e * (W_PITCH + 0.42);
        },
        { delay: i * 0.12 },
      ),
    );
    const chimneyFall = topple(ctx, stackPivot, 'z', -1.35, 0.9, 0.1);
    const craneFall = topple(ctx, crane, 'x', -1.3, 1.0, 0.2);
    model.attach(cog);
    const gearRoll = throwPart(ctx, cog, new Vector3(-0.55, 0.05, 0.55), 0.3, 0.9, new Vector3(0, 0, 6), new Vector3(Math.PI / 2, 0, 6));
    await Promise.all([...roof, chimneyFall, craneFall, gearRoll]);
  };
  return model;
}

// ------------------------------------------------------------------ tower (1x1 automatic)

function towerBase(): BufferGeometry {
  return merge([
    part(new CylinderGeometry(0.3, 0.34, 0.16, 8), SKIN.concrete, { y: 0.08, ry: Math.PI / 8 }),
    part(new CylinderGeometry(0.22, 0.27, 0.22, 8), SKIN.concreteDark, { y: 0.27, ry: Math.PI / 8 }),
    part(new CylinderGeometry(0.235, 0.235, 0.04, 8), 'main', { y: 0.36, ry: Math.PI / 8 }),
    part(new BoxGeometry(0.12, 0.08, 0.01), 'glow', { y: 0.22, z: -0.25 }),
  ]);
}

function towerTurret(): BufferGeometry {
  const parts = [
    part(new SphereGeometry(0.17, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'main'),
    part(new CylinderGeometry(0.18, 0.18, 0.04, 16), 'dark'),
    part(new CylinderGeometry(0.04, 0.04, 0.03, 12), 'glow', { y: 0.1, z: -0.14, rx: Math.PI / 2 - 0.5 }),
  ];
  for (const x of [-0.06, 0.06]) {
    parts.push(part(new CylinderGeometry(0.022, 0.026, 0.32, 10), SKIN.metal, { x, y: 0.06, z: -0.26, rx: Math.PI / 2 }));
    parts.push(part(new CylinderGeometry(0.03, 0.03, 0.05, 10), SKIN.metalLight, { x, y: 0.06, z: -0.42, rx: Math.PI / 2 }));
  }
  return merge(parts);
}

/** Automatic tower: a squat bunker with a sensor dome and twin guns that sweep on their own. */
export function createTower({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('tower', body);
  const base = mesh(cached('tower-base', towerBase), body, 'base');
  model.add(base);
  const turret = new Group();
  turret.position.y = 0.38;
  turret.add(mesh(cached('tower-turret', towerTurret), body, 'turret'));
  model.add(turret);
  const anchor = new Group();
  anchor.position.set(0.18, 0.5, 0.18);
  model.add(anchor);
  model.flagAnchor = anchor;

  const phase = Math.random() * 6;
  model.idle = (time) => {
    // Sweeps, pauses on a bearing, sweeps back: it reads as watching on its own.
    const s = Math.sin(time * 0.5 + phase);
    turret.rotation.y = Math.sign(s) * Math.pow(Math.abs(s), 0.4) * 1.2;
    body.userData.unit.lights.value = 0.7 + 0.3 * Math.max(0, Math.sin(time * 4 + phase));
  };

  model.wreck = async (ctx) => {
    ctx.emit('sparks', model.worldOf(new Vector3(0, 0.45, 0)));
    model.attach(turret);
    const off = throwPart(ctx, turret, new Vector3(0.4, 0.06, 0.3), 0.6, 0.8, new Vector3(3, 2, 2), new Vector3(Math.PI * 0.7, 1.2, 0.4));
    const crack = lerpTo(ctx, 0.6, (e) => {
      base.scale.set(1 + e * 0.06, 1 - e * 0.3, 1 + e * 0.06);
      base.rotation.z = e * 0.08;
    }, 0.1);
    await Promise.all([off, crack]);
    ctx.emit('smoke', model.worldOf(new Vector3(0, 0.3, 0)));
  };
  return model;
}
