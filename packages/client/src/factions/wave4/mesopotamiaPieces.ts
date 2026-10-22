import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, SphereGeometry, TorusGeometry, Vector3, type Mesh } from 'three';
import { part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { piece } from '../kit/common';
import { figure, moved, wheel, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

/** Stepped merlons along the top of a wall running along x. */
function merlons(width: number, depth: number, y: number, tint: Color | 'main' | 'dark', step = 0.12): Parts {
  const parts: Parts = [];
  const n = Math.max(2, Math.round(width / step));
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + (i + 0.5) * (width / n);
    parts.push(part(new BoxGeometry(width / n - 0.02, 0.05, depth), tint, { x, y: y + 0.025 }));
    parts.push(part(new BoxGeometry(width / n - 0.05, 0.04, depth * 0.8), tint, { x, y: y + 0.07 }));
  }
  return parts;
}

// ------------------------------------------------------------------ Assyria

/**
 * A lamassu gate guardian: winged bull with a bearded human head and a tall
 * cap, carved in the round and set against the gate tower. Faces −z.
 */
function lamassu(k: KitStyle): Parts {
  const stone = k.color.stone.clone().lerp(new Color('#efe4c8'), 0.35);
  const carved = stone.clone().multiplyScalar(0.72);
  const parts: Parts = [
    part(new BoxGeometry(0.2, 0.06, 0.48), k.color.stoneDark, { y: 0.03 }),
    part(new BoxGeometry(0.15, 0.17, 0.34), stone, { y: 0.25, z: 0.03 }),
    part(new BoxGeometry(0.15, 0.13, 0.08), stone, { y: 0.36, z: -0.15 }),
    // Human head, curled beard and the horned cap.
    part(new BoxGeometry(0.1, 0.1, 0.09), stone, { y: 0.47, z: -0.18 }),
    part(new BoxGeometry(0.09, 0.1, 0.035), carved, { y: 0.4, z: -0.225 }),
    part(new CylinderGeometry(0.048, 0.054, 0.1, 10), stone, { y: 0.57, z: -0.18 }),
    part(new TorusGeometry(0.054, 0.009, 4, 12), k.color.accent, { y: 0.535, z: -0.18, rx: Math.PI / 2 }),
    part(new TorusGeometry(0.05, 0.006, 4, 12), carved, { y: 0.585, z: -0.18, rx: Math.PI / 2 }),
    part(new BoxGeometry(0.03, 0.012, 0.02), carved, { x: -0.022, y: 0.48, z: -0.226 }),
    part(new BoxGeometry(0.03, 0.012, 0.02), carved, { x: 0.022, y: 0.48, z: -0.226 }),
    part(new BoxGeometry(0.03, 0.03, 0.06), carved, { y: 0.1, z: 0.22 }),
  ];
  // Five legs, as carved: two seen from the front, four from the side.
  for (const [x, z] of [[-0.05, -0.15], [0.05, -0.15], [-0.05, 0.15], [0.05, 0.15], [0.05, -0.05]] as const) parts.push(part(new BoxGeometry(0.045, 0.17, 0.05), stone, { x, y: 0.135, z }));
  for (const s of [-1, 1]) {
    // Wings swept up and back along the flank, with feather rows.
    parts.push(part(new BoxGeometry(0.018, 0.16, 0.34), stone, { x: s * 0.084, y: 0.37, z: 0.05, rx: -0.35 }));
    for (let i = 0; i < 4; i++) parts.push(part(new BoxGeometry(0.006, 0.012, 0.3 - i * 0.05), carved, { x: s * 0.094, y: 0.31 + i * 0.035, z: 0.06 + i * 0.02, rx: -0.35 }));
  }
  return parts;
}

function gateTower(k: KitStyle, w: number, h: number, d: number, brick: Color): Parts {
  const parts: Parts = [
    part(new BoxGeometry(w, h, d), brick, { y: h / 2 }),
    part(new BoxGeometry(w + 0.01, 0.04, d + 0.01), 'main', { y: h - 0.08 }),
    ...merlons(w, d, h, brick),
  ];
  for (const y of [h * 0.45, h * 0.7]) parts.push(part(new BoxGeometry(0.035, 0.09, 0.01), k.color.dark, { y, z: -d / 2 - 0.004 }));
  return parts;
}

/**
 * Portão de Nínive: a mud-brick gate between two crenellated towers, guarded
 * by a pair of lamassu. When struck the towers lean out and fall, the lintel
 * drops into the passage and the guardians are left standing amid the dust.
 */
export function assyrianLamassuGate(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const brick = k.color.stone.clone().lerp(new Color('#a8784a'), 0.45);
    model.add(piece(k, body, 'as-gate-ground', () => [
      part(new BoxGeometry(1.84, 0.04, 1.84), k.color.stoneDark, { y: 0.02 }),
      part(new BoxGeometry(0.5, 0.012, 1.0), brick.clone().multiplyScalar(0.85), { y: 0.045, z: -0.35 }),
      // Curtain wall behind the gate.
      part(new BoxGeometry(1.8, 0.5, 0.3), brick, { y: 0.29, z: 0.62 }),
      ...moved(merlons(1.8, 0.3, 0.54, brick), { z: 0.62 }),
    ]));
    const towers: Group[] = [];
    for (const s of [-1, 1]) {
      const holder = new Group();
      holder.position.set(s * 0.56, 0.04, 0.05);
      holder.add(piece(k, body, 'as-gate-tower', () => gateTower(k, 0.56, 0.86, 0.72, brick)));
      model.add(holder);
      towers.push(holder);
    }
    const lintel = piece(k, body, 'as-gate-lintel', () => [
      part(new BoxGeometry(0.58, 0.2, 0.72), brick, { y: 0.1 }),
      part(new BoxGeometry(0.59, 0.035, 0.73), k.color.accent, { y: 0.02 }),
      ...merlons(0.58, 0.72, 0.2, brick),
    ]);
    lintel.position.set(0, 0.62, 0.05);
    model.add(lintel);
    model.add(piece(k, body, 'as-gate-passage', () => [
      part(new BoxGeometry(0.4, 0.56, 0.02), k.color.dark, { y: 0.32, z: -0.3 }),
      part(new CylinderGeometry(0.2, 0.2, 0.02, 14, 1, false, Math.PI / 2, Math.PI), k.color.dark, { y: 0.6, z: -0.3, rx: Math.PI / 2 }),
      part(new TorusGeometry(0.21, 0.018, 4, 14, Math.PI), k.color.accent, { y: 0.6, z: -0.31 }),
    ]));
    const guards: Mesh[] = [];
    for (const s of [-1, 1]) {
      const g = piece(k, body, 'as-lamassu', () => lamassu(k));
      g.position.set(s * 0.4, 0.04, -0.66);
      g.scale.setScalar(1.3);
      model.add(g);
      guards.push(g);
    }
    const anchor = new Group();
    anchor.position.set(0, 1.0, 0);
    towers[0]!.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      anchor.visible = false;
      await shudder(ctx, model, 0.03, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.5, 0)));
      const jobs: Promise<void>[] = [];
      towers.forEach((t, i) => {
        const s = i === 0 ? 1 : -1;
        jobs.push(topple(ctx, t, 'z', s * 1.2, 1.0, 0.1 + i * 0.15));
        jobs.push(lerpTo(ctx, 0.8, (e) => t.scale.set(1, 1 - e * 0.35, 1), 0.2 + i * 0.15));
      });
      jobs.push(throwPart(ctx, lintel, new Vector3(0.05, 0.1, -0.55), 0.1, 0.6, new Vector3(0.5, 0.2, 0.3)));
      guards.forEach((g, i) => jobs.push(lerpTo(ctx, 0.5, (e) => (g.rotation.z = (i ? -1 : 1) * e * 0.08), 0.5)));
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, -0.5)));
      await Promise.all(jobs);
    };
    return model;
  };
}

/**
 * Torre de Cerco com Aríete: a six-wheeled siege engine with a wicker-armoured
 * hull, a fighting turret and a long iron-headed ram. The ram works back and
 * forth; when struck the turret is thrown, the ram drops and the hull slews.
 */
export function assyrianSiegeEngine(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('artillery', body);
    const hull = new Group();
    hull.add(piece(k, body, 'as-siege-hull', () => {
      const wicker = k.color.wood.clone().lerp(k.color.secondary, 0.35);
      const parts: Parts = [
        part(new BoxGeometry(1.3, 0.08, 0.6), k.color.woodDark, { y: 0.2 }),
        part(new BoxGeometry(1.2, 0.4, 0.56), wicker, { y: 0.44 }),
        part(new BoxGeometry(1.22, 0.04, 0.58), 'main', { y: 0.62 }),
        part(new BoxGeometry(1.2, 0.08, 0.5), wicker, { y: 0.66, rz: 0.06 }),
      ];
      for (const y of [0.3, 0.4, 0.5]) parts.push(part(new BoxGeometry(1.21, 0.012, 0.57), k.color.woodDark, { y }));
      for (let x = -0.55; x <= 0.56; x += 0.11) parts.push(part(new BoxGeometry(0.012, 0.4, 0.57), k.color.woodDark, { x, y: 0.44 }));
      for (const x of [-0.45, 0, 0.45]) for (const z of [-0.32, 0.32]) parts.push(...moved(wheel(k, 0.13, 6), { x, y: 0.13, z }));
      return parts;
    }));
    model.add(hull);
    const turret = new Group();
    turret.position.set(-0.32, 0.64, 0);
    turret.add(piece(k, body, 'as-siege-turret', () => [
      part(new BoxGeometry(0.42, 0.5, 0.48), k.color.wood, { y: 0.25 }),
      part(new BoxGeometry(0.43, 0.04, 0.49), 'main', { y: 0.42 }),
      ...merlons(0.42, 0.48, 0.5, k.color.wood, 0.1),
      part(new BoxGeometry(0.04, 0.1, 0.01), k.color.dark, { x: -0.1, y: 0.28, z: -0.245 }),
      part(new BoxGeometry(0.04, 0.1, 0.01), k.color.dark, { x: 0.1, y: 0.28, z: -0.245 }),
      ...moved(figure(k, 0.42, 'archer', k.params.helmet, null), { y: 0.5, ry: Math.PI / 2 }),
    ]));
    model.add(turret);
    const ram = new Group();
    ram.position.set(-0.6, 0.42, 0);
    ram.add(piece(k, body, 'as-siege-ram', () => [
      part(new CylinderGeometry(0.045, 0.05, 1.0, 8), k.color.woodDark, { x: -0.4, rz: Math.PI / 2 }),
      part(new ConeGeometry(0.07, 0.2, 6), k.color.metal, { x: -0.98, rz: Math.PI / 2 }),
      part(new BoxGeometry(0.06, 0.12, 0.02), k.color.metal, { x: -0.86 }),
      part(new TorusGeometry(0.052, 0.012, 4, 10), k.color.accent, { x: -0.7, ry: Math.PI / 2 }),
    ]));
    model.add(ram);
    const crew = piece(k, body, 'as-siege-crew', () => [
      ...moved(figure(k, 0.48, 'soldier', k.params.helmet, null), { x: 0, z: -0.14, ry: Math.PI / 2, rz: 0.2 }),
      ...moved(figure(k, 0.48, 'soldier', k.params.helmet, null), { x: 0.05, z: 0.14, ry: Math.PI / 2, rz: 0.2 }),
    ]);
    crew.position.set(0.8, 0, 0);
    model.add(crew);
    const anchor = new Group();
    anchor.position.set(0.15, 0.6, 0.15);
    turret.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      ram.position.x = -0.6 - Math.max(0, Math.sin(time * 1.4 + phase)) * 0.08;
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(-1.3, 0.42, 0)));
      model.attach(turret);
      const off = throwPart(ctx, turret, new Vector3(-0.1, 0.04, 0.7), 0.4, 0.8, new Vector3(0, 0, 0), new Vector3(1.5, 0.3, 0.2));
      const drop = lerpTo(ctx, 0.5, (e) => {
        ram.position.y = 0.42 - e * 0.32;
        ram.rotation.z = -e * 0.12;
      }, 0.1);
      const slew = lerpTo(ctx, 0.7, (e) => {
        hull.rotation.y = e * 0.25;
        hull.rotation.x = e * 0.12;
      }, 0.2);
      const away = throwPart(ctx, crew, new Vector3(1.3, 0, 0.3), 0.15, 0.6, new Vector3(0, 0.6, 0));
      ctx.emit('smoke', model.worldOf(new Vector3(0, 0.6, 0)));
      await Promise.all([off, drop, slew, away]);
    };
    return model;
  };
}

// ------------------------------------------------------------------ Babylon

const GLAZE = new Color('#2458b0');
const GLAZE_DARK = new Color('#183c7a');
const GOLDEN = new Color('#e0b84a');
const IVORY = new Color('#efe6cc');

/** A striding beast in raised glazed brick (aurochs or serpent-dragon), flat on the −z face. */
function relief(kind: 'aurochs' | 'dragon', tint: Color): Parts {
  const parts: Parts = [part(new BoxGeometry(0.12, 0.045, 0.012), tint, { y: 0.06 })];
  for (const x of [-0.045, -0.02, 0.025, 0.05]) parts.push(part(new BoxGeometry(0.012, 0.045, 0.012), tint, { x, y: 0.02 }));
  if (kind === 'aurochs') {
    parts.push(part(new BoxGeometry(0.035, 0.035, 0.012), tint, { x: -0.07, y: 0.085 }));
    parts.push(part(new BoxGeometry(0.008, 0.035, 0.012), tint, { x: -0.07, y: 0.115, rz: -0.4 }));
  } else {
    // Long neck, small horned head and a curling tail.
    parts.push(part(new BoxGeometry(0.014, 0.06, 0.012), tint, { x: -0.065, y: 0.1, rz: 0.3 }));
    parts.push(part(new BoxGeometry(0.035, 0.016, 0.012), tint, { x: -0.085, y: 0.13 }));
    parts.push(part(new BoxGeometry(0.04, 0.012, 0.012), tint, { x: 0.075, y: 0.085, rz: 0.7 }));
  }
  return parts;
}

function reliefRow(width: number, y: number, z: number, kind: 'aurochs' | 'dragon', tint: Color): Parts {
  const n = Math.max(1, Math.floor(width / 0.17));
  const parts: Parts = [part(new BoxGeometry(width, 0.012, 0.01), IVORY, { y: y - 0.012, z })];
  for (let i = 0; i < n; i++) parts.push(...moved(relief(kind, tint), { x: -width / 2 + (i + 0.5) * (width / n), y, z }));
  return parts;
}

function ishtarTower(k: KitStyle): Parts {
  const w = 0.42;
  const h = 1.12;
  const d = 0.6;
  const parts: Parts = [
    part(new BoxGeometry(w, h, d), GLAZE, { y: h / 2 }),
    part(new BoxGeometry(w + 0.012, 0.035, d + 0.012), 'main', { y: h - 0.05 }),
    ...merlons(w, d, h, IVORY, 0.1),
    ...reliefRow(w - 0.06, 0.2, -d / 2 - 0.006, 'aurochs', GOLDEN),
    ...reliefRow(w - 0.06, 0.48, -d / 2 - 0.006, 'dragon', IVORY),
    ...reliefRow(w - 0.06, 0.76, -d / 2 - 0.006, 'aurochs', GOLDEN),
  ];
  // Rosette band under the merlons.
  for (let i = 0; i < 5; i++) parts.push(part(new CylinderGeometry(0.014, 0.014, 0.01, 8), IVORY, { x: -w / 2 + 0.05 + i * 0.08, y: h - 0.12, z: -d / 2 - 0.006, rx: Math.PI / 2 }));
  parts.push(part(new BoxGeometry(w + 0.01, 0.025, d + 0.01), k.color.accent, { y: 0.02 }));
  return parts;
}

/**
 * Porta de Ishtar: the blue glazed-brick gate with rows of golden aurochs and
 * serpent-dragons in relief between two tall towers. When struck the towers
 * crack and fall outward and the arched gateway slumps in a cloud of dust.
 */
export function babylonIshtarGate(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'bb-gate-ground', () => [
      part(new BoxGeometry(1.84, 0.04, 1.84), k.color.stoneDark, { y: 0.02 }),
      // The processional way leading to the gate, and low walls along it.
      part(new BoxGeometry(0.42, 0.012, 1.0), k.color.stone, { y: 0.046, z: -0.4 }),
      ...[-1, 1].flatMap((s) => [part(new BoxGeometry(0.1, 0.22, 0.6), GLAZE_DARK, { x: s * 0.3, y: 0.15, z: -0.6 }), part(new BoxGeometry(0.11, 0.025, 0.61), IVORY, { x: s * 0.3, y: 0.27, z: -0.6 })]),
      part(new BoxGeometry(1.8, 0.62, 0.3), GLAZE_DARK, { y: 0.35, z: 0.62 }),
      ...moved(merlons(1.8, 0.3, 0.66, IVORY, 0.12), { z: 0.62 }),
    ]));
    const towers: Group[] = [];
    for (const s of [-1, 1]) {
      const holder = new Group();
      holder.position.set(s * 0.6, 0.04, 0.1);
      holder.add(piece(k, body, 'bb-gate-tower', () => ishtarTower(k)));
      model.add(holder);
      towers.push(holder);
    }
    const gateway = new Group();
    gateway.position.set(0, 0.04, 0.1);
    gateway.add(piece(k, body, 'bb-gateway', () => [
      part(new BoxGeometry(0.78, 0.9, 0.56), GLAZE, { y: 0.45 }),
      ...merlons(0.78, 0.56, 0.9, IVORY, 0.1),
      part(new BoxGeometry(0.34, 0.42, 0.02), k.color.dark, { y: 0.21, z: -0.285 }),
      part(new CylinderGeometry(0.17, 0.17, 0.02, 14, 1, false, Math.PI / 2, Math.PI), k.color.dark, { y: 0.42, z: -0.285, rx: Math.PI / 2 }),
      part(new TorusGeometry(0.19, 0.02, 4, 16, Math.PI), GOLDEN, { y: 0.42, z: -0.29 }),
      ...[-1, 1].map((s) => part(new BoxGeometry(0.04, 0.42, 0.012), GOLDEN, { x: s * 0.19, y: 0.21, z: -0.29 })),
      ...reliefRow(0.66, 0.7, -0.286, 'dragon', GOLDEN),
      part(new BoxGeometry(0.79, 0.035, 0.57), 'main', { y: 0.84 }),
    ]));
    model.add(gateway);
    const anchor = new Group();
    anchor.position.set(0, 1.25, 0);
    towers[1]!.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      anchor.visible = false;
      await shudder(ctx, model, 0.03, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.6, 0)));
      const jobs: Promise<void>[] = [];
      towers.forEach((t, i) => {
        const s = i === 0 ? 1 : -1;
        jobs.push(topple(ctx, t, 'z', s * 1.25, 1.0, 0.1 + i * 0.12));
        jobs.push(lerpTo(ctx, 0.9, (e) => t.scale.set(1, 1 - e * 0.4, 1), 0.15 + i * 0.12));
      });
      jobs.push(lerpTo(ctx, 0.8, (e) => {
        gateway.scale.set(1 + e * 0.08, 1 - e * 0.55, 1 + e * 0.05);
        gateway.rotation.x = e * 0.1;
      }, 0.3));
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, -0.4)));
      await Promise.all(jobs);
    };
    return model;
  };
}

/** A garden terrace: brick step with plants spilling over its edge. */
function terrace(k: KitStyle, w: number, h: number, seed: number): Parts {
  const leaf = new Color('#3f7a32');
  const leafLight = new Color('#6a9a3a');
  const parts: Parts = [
    part(new BoxGeometry(w, h, w), k.color.stone, { y: h / 2 }),
    part(new BoxGeometry(w + 0.01, 0.02, w + 0.01), GLAZE, { y: h - 0.03 }),
    part(new BoxGeometry(w - 0.04, 0.04, w - 0.04), leaf, { y: h + 0.01 }),
  ];
  const n = Math.round(w * 24);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    const r = w * 0.5;
    const x = Math.max(-r, Math.min(r, Math.cos(a) * r * 1.3));
    const z = Math.max(-r, Math.min(r, Math.sin(a) * r * 1.3));
    parts.push(part(new SphereGeometry(0.045, 6, 5), i % 2 ? leaf : leafLight, { x, y: h + 0.02, z, sy: 0.8 }));
    if (i % 2 === 0) parts.push(part(new CylinderGeometry(0.014, 0.004, h * 0.9, 4), leaf, { x: x * 1.04, y: h * 0.62, z: z * 1.04 }));
  }
  return parts;
}

function smallPalm(k: KitStyle, h: number): Parts {
  const frond = new Color('#4f7d34');
  const parts: Parts = [part(new CylinderGeometry(0.014, 0.02, h, 6), k.color.wood, { y: h / 2 })];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(part(new BoxGeometry(0.14, 0.008, 0.035), frond, { x: Math.cos(a) * 0.06, y: h, z: Math.sin(a) * 0.06, ry: -a, rz: -0.35 }));
  }
  return parts;
}

/**
 * Jardins Suspensos: three brick terraces overflowing with plants and palms,
 * watered by a chain of buckets turning on a wheel beside them. When struck
 * the upper terraces slide off, the wheel rolls away and the water stops.
 */
export function babylonHangingGardens(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    model.add(piece(k, body, 'bb-gardens-base', () => [
      part(new BoxGeometry(0.9, 0.04, 0.9), k.color.stoneDark, { y: 0.02 }),
      ...moved(terrace(k, 0.72, 0.2, 0), { y: 0.04 }),
      part(new BoxGeometry(0.06, 0.01, 0.5), 'glow', { x: 0.38, y: 0.05 }),
    ]));
    const upper: Group[] = [];
    for (const [w, y, seed] of [[0.5, 0.28, 1.0], [0.3, 0.46, 2.0]] as const) {
      const g = new Group();
      g.position.set(-0.03, y, -0.02);
      g.add(piece(k, body, `bb-terrace-${w}`, () => [...terrace(k, w, 0.18, seed), ...moved(smallPalm(k, 0.2 + w * 0.2), { x: w * 0.2, y: 0.2, z: w * 0.15 })]));
      model.add(g);
      upper.push(g);
    }
    const wheelGroup = new Group();
    wheelGroup.position.set(0.36, 0.32, 0);
    const wheelMesh = piece(k, body, 'bb-water-wheel', () => {
      const parts: Parts = [...wheel(k, 0.2, 8, k.color.wood)];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(part(new BoxGeometry(0.04, 0.035, 0.05), k.color.secondary, { x: Math.cos(a) * 0.2, y: Math.sin(a) * 0.2 }));
      }
      return parts;
    });
    wheelMesh.rotation.y = Math.PI / 2;
    wheelGroup.add(wheelMesh);
    model.add(wheelGroup);
    model.add(piece(k, body, 'bb-wheel-posts', () => [
      part(new BoxGeometry(0.03, 0.36, 0.03), k.color.woodDark, { x: 0.36, y: 0.2, z: -0.06 }),
      part(new BoxGeometry(0.03, 0.36, 0.03), k.color.woodDark, { x: 0.36, y: 0.2, z: 0.06 }),
    ]));
    const anchor = new Group();
    anchor.position.set(-0.03, 0.85, -0.02);
    model.add(anchor);
    model.flagAnchor = anchor;

    model.idle = (time, dt) => {
      wheelMesh.rotation.z += dt * 0.9;
      body.userData.unit.lights.value = 0.75 + 0.25 * Math.sin(time * 2);
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('splash', model.worldOf(new Vector3(0.36, 0.1, 0)));
      const jobs = upper.map((g, i) => throwPart(ctx, g, new Vector3(-0.25 - i * 0.15, 0.04, 0.2 + i * 0.15), 0.12, 0.7, new Vector3(0, 0, 0), new Vector3(0.4, 0.5, 1.2 + i * 0.3)));
      jobs.push(throwPart(ctx, wheelGroup, new Vector3(0.6, 0.2, 0.3), 0.1, 0.8, new Vector3(0, 0, 0), new Vector3(0, 0, -1.4)));
      jobs.push(lerpTo(ctx, 0.6, (e) => (body.userData.unit.lights.value = 1 - e)));
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      await Promise.all(jobs);
    };
    return model;
  };
}

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/**
 * Terraço dos Astrólogos: a stepped observation tower with an astronomer
 * reading the sky, a scribe's table of clay tablets and a stone star chart
 * whose stars glow at dusk. When struck the tower's upper steps are thrown
 * down, the astronomer climbs off and the chart topples.
 */
export function babylonAstronomers(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const base = piece(k, body, 'bb-obs-base', () => [
      part(new BoxGeometry(0.62, 0.22, 0.62), k.color.stone, { y: 0.11 }),
      part(new BoxGeometry(0.63, 0.03, 0.63), GLAZE, { y: 0.2 }),
      part(new BoxGeometry(0.16, 0.24, 0.1), k.color.stoneDark, { y: 0.05, z: -0.33, rx: 0.8 }),
    ]);
    base.position.set(ANT_A.x, 0, ANT_A.z);
    model.add(base);
    const top = new Group();
    top.position.set(ANT_A.x, 0.22, ANT_A.z);
    top.add(piece(k, body, 'bb-obs-top', () => [
      part(new BoxGeometry(0.44, 0.2, 0.44), k.color.stone, { y: 0.1 }),
      part(new BoxGeometry(0.3, 0.18, 0.3), k.color.stone, { y: 0.29 }),
      part(new BoxGeometry(0.31, 0.025, 0.31), 'main', { y: 0.36 }),
      ...moved(figure(k, 0.42, 'officer', 'cap', null), { y: 0.38 }),
      part(new BoxGeometry(0.05, 0.065, 0.012), k.color.stone.clone().multiplyScalar(0.8), { x: 0.06, y: 0.52, z: -0.07, rx: -0.6 }),
    ]));
    model.add(top);
    const table = piece(k, body, 'bb-obs-table', () => {
      const parts: Parts = [
        part(new BoxGeometry(0.4, 0.04, 0.26), k.color.wood, { y: 0.2 }),
        ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => part(new BoxGeometry(0.03, 0.2, 0.03), k.color.woodDark, { x: sx! * 0.17, y: 0.1, z: sz! * 0.1 })),
        ...moved(figure(k, 0.4, 'soldier', 'cap', null), { x: 0.05, z: 0.22, ry: Math.PI }),
      ];
      for (let i = 0; i < 5; i++) parts.push(part(new BoxGeometry(0.05, 0.015, 0.07), k.color.stone.clone().multiplyScalar(0.85), { x: -0.14 + i * 0.07, y: 0.23, z: (i % 2) * 0.04 - 0.02, ry: i * 0.3 }));
      return parts;
    });
    table.position.copy(ANT_B);
    model.add(table);
    const chart = new Group();
    chart.position.copy(ANT_C);
    chart.add(piece(k, body, 'bb-obs-chart', () => {
      const parts: Parts = [
        part(new CylinderGeometry(0.06, 0.08, 0.36, 8), k.color.stone, { y: 0.18 }),
        part(new CylinderGeometry(0.24, 0.24, 0.04, 20), GLAZE_DARK, { y: 0.48, rx: Math.PI / 2 - 0.5 }),
        part(new TorusGeometry(0.24, 0.015, 4, 24), GOLDEN, { y: 0.48, rx: -0.5 }),
      ];
      // Constellations: stars on the dark face (glow follows the unit lights).
      const stars: Array<[number, number]> = [[-0.12, 0.08], [-0.05, 0.12], [0.03, 0.06], [0.1, 0.12], [-0.1, -0.06], [0.0, -0.1], [0.12, -0.05], [0.06, -0.14]];
      for (const [x, y] of stars) parts.push(part(new SphereGeometry(0.014, 5, 4), 'glow', { x, y: 0.48 + y * Math.cos(0.5), z: -0.025 - y * Math.sin(0.5) }));
      return parts;
    }));
    model.add(chart);
    const anchor = new Group();
    anchor.position.set(0, 0.7, 0);
    top.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      body.userData.unit.lights.value = 0.6 + 0.4 * Math.abs(Math.sin(time * 0.9 + phase));
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(ANT_A.x, 0.5, ANT_A.z)));
      const off = throwPart(ctx, top, new Vector3(ANT_A.x - 0.25, 0.04, ANT_A.z - 0.35), 0.25, 0.8, new Vector3(0, 0, 0), new Vector3(1.4, 0.3, 0.2));
      const fall = topple(ctx, chart, 'x', -1.3, 0.9, 0.2);
      const tableDown = lerpTo(ctx, 0.5, (e) => (table.rotation.z = e * 0.3), 0.3);
      const dim = lerpTo(ctx, 0.6, (e) => (body.userData.unit.lights.value = 1 - e));
      await Promise.all([off, fall, tableDown, dim]);
    };
    return model;
  };
}
