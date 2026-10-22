import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, SphereGeometry, TorusGeometry, Vector3, type Mesh } from 'three';
import { part } from '../../units/parts';
import { Puffs, UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { bolt, piece } from '../kit/common';
import { camel, figure, horse, moved, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

/** Little pointed merlons in a ring (round towers) or a row (walls along x). */
function teeth(tint: Color, count: number, at: (i: number) => { x: number; z: number }, y: number, size = 0.035): Parts {
  const parts: Parts = [];
  for (let i = 0; i < count; i++) {
    const p = at(i);
    parts.push(part(new ConeGeometry(size, size * 1.8, 4), tint, { x: p.x, y: y + size * 0.9, z: p.z, ry: Math.PI / 4 }));
  }
  return parts;
}

function roundTower(k: KitStyle, r: number, h: number): Parts {
  const mud = k.color.stone;
  const parts: Parts = [
    part(new CylinderGeometry(r * 0.86, r, h, 14), mud, { y: h / 2 }),
    part(new CylinderGeometry(r * 0.9, r * 0.9, 0.035, 14), 'main', { y: h - 0.07 }),
    ...teeth(mud, 8, (i) => ({ x: Math.cos((i / 8) * Math.PI * 2) * r * 0.78, z: Math.sin((i / 8) * Math.PI * 2) * r * 0.78 }), h),
  ];
  // Timber ends poking out of the mud brick, and a slit window.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(part(new CylinderGeometry(0.008, 0.008, 0.06, 4), k.color.woodDark, { x: Math.cos(a) * r * 0.95, y: h * 0.6, z: Math.sin(a) * r * 0.95, rz: Math.PI / 2, ry: -a }));
  }
  parts.push(part(new BoxGeometry(0.025, 0.07, 0.01), k.color.dark, { y: h * 0.4, z: -r * 0.93 }));
  return parts;
}

// ------------------------------------------------------------------ Arabia

/**
 * Forte do Oásis: a square desert fort of sun-dried brick with round corner
 * towers, an arched gate and a courtyard with a well and a palm. When struck
 * the corner towers split away and the walls slump into the sand.
 */
export function arabDesertFort(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const mud = k.color.stone;
    const walls = new Group();
    walls.add(piece(k, body, 'ar-fort-walls', () => {
      const parts: Parts = [part(new BoxGeometry(1.84, 0.04, 1.84), k.color.stoneDark, { y: 0.02 }), part(new BoxGeometry(1.2, 0.012, 1.2), mud.clone().multiplyScalar(1.05), { y: 0.045 })];
      for (const [x, z, w, d] of [[0, -0.66, 1.3, 0.12], [0, 0.66, 1.3, 0.12], [-0.66, 0, 0.12, 1.3], [0.66, 0, 0.12, 1.3]] as const) {
        parts.push(part(new BoxGeometry(w, 0.42, d), mud, { x, y: 0.25, z }));
        const n = Math.round(Math.max(w, d) / 0.12);
        parts.push(...teeth(mud, n, (i) => (w > d ? { x: x - w / 2 + (i + 0.5) * (w / n), z } : { x, z: z - d / 2 + (i + 0.5) * (d / n) }), 0.46, 0.03));
      }
      // The gate: arch, studded door and a team banner band above.
      parts.push(part(new BoxGeometry(0.34, 0.56, 0.18), mud, { y: 0.32, z: -0.68 }));
      parts.push(part(new BoxGeometry(0.18, 0.24, 0.01), k.color.woodDark, { y: 0.16, z: -0.775 }));
      parts.push(part(new CylinderGeometry(0.09, 0.09, 0.01, 12, 1, false, Math.PI / 2, Math.PI), k.color.woodDark, { y: 0.28, z: -0.775, rx: Math.PI / 2 }));
      parts.push(part(new TorusGeometry(0.1, 0.012, 4, 12, Math.PI), k.color.accent, { y: 0.28, z: -0.78 }));
      parts.push(part(new BoxGeometry(0.3, 0.05, 0.01), 'main', { y: 0.5, z: -0.775 }));
      // Courtyard: the well, a palm and a shade awning.
      parts.push(part(new CylinderGeometry(0.1, 0.11, 0.1, 12), mud, { x: 0.2, y: 0.1, z: 0.1 }));
      parts.push(part(new CylinderGeometry(0.075, 0.075, 0.02, 12), new Color('#2a6a7a'), { x: 0.2, y: 0.15, z: 0.1 }));
      parts.push(part(new CylinderGeometry(0.016, 0.024, 0.5, 6), k.color.wood, { x: -0.25, y: 0.3, z: 0.25, rz: 0.1 }));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(part(new BoxGeometry(0.2, 0.01, 0.05), new Color('#4f7d34'), { x: -0.22 + Math.cos(a) * 0.08, y: 0.54, z: 0.25 + Math.sin(a) * 0.08, ry: -a, rz: -0.4 }));
      }
      parts.push(part(new BoxGeometry(0.4, 0.015, 0.3), k.tint.cloth, { x: 0.28, y: 0.4, z: 0.42, rx: 0.1 }));
      return parts;
    }));
    model.add(walls);
    const towers: Group[] = [];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const holder = new Group();
      holder.position.set(x * 0.66, 0.04, z * 0.66);
      holder.add(piece(k, body, 'ar-fort-tower', () => roundTower(k, 0.17, 0.66)));
      model.add(holder);
      towers.push(holder);
    }
    const anchor = new Group();
    anchor.position.set(0, 0.8, 0);
    towers[1]!.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      anchor.visible = false;
      await shudder(ctx, model, 0.03, 0.18);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.4, 0)));
      const jobs: Promise<void>[] = [];
      towers.forEach((t, i) => {
        const out = new Vector3(t.position.x, 0, t.position.z).normalize();
        jobs.push(lerpTo(ctx, 0.9, (e) => {
          t.rotation.x = out.z * e * 1.2;
          t.rotation.z = -out.x * e * 1.2;
          t.position.y = 0.04 - e * 0.05;
        }, 0.1 + i * 0.1));
      });
      jobs.push(lerpTo(ctx, 0.8, (e) => walls.scale.set(1, 1 - e * 0.45, 1), 0.3));
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(0.4, 0.2, 0.4)));
    };
    return model;
  };
}

/**
 * Torre de Vigia do Forte: a tapering mud-brick tower with timber ends, a
 * pointed parapet and a lookout with a bow scanning the desert. When struck
 * the parapet is thrown off and the tower folds over.
 */
export function arabWatchtower(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('tower', body);
    model.add(piece(k, body, 'ar-watch-base', () => [part(new CylinderGeometry(0.3, 0.33, 0.06, 12), k.color.stoneDark, { y: 0.03 }), ...moved(roundTower(k, 0.22, 0.62), { y: 0.06 })]));
    const top = new Group();
    top.position.y = 0.66;
    const lookout = new Group();
    lookout.add(piece(k, body, 'ar-watch-lookout', () => {
      const bow = new TorusGeometry(0.2, 0.012, 4, 12, Math.PI * 0.75);
      bow.rotateZ(-Math.PI * 0.375);
      bow.rotateY(Math.PI / 2);
      return [...figure(k, 0.5, 'archer', k.params.helmet, null), part(bow, k.color.woodDark, { y: 0.2, z: -0.1, sx: 0.5, sy: 0.5, sz: 0.5 })];
    }));
    top.add(lookout);
    top.add(piece(k, body, 'ar-watch-awning', () => [
      ...[0, 1, 2, 3].map((i) => part(new CylinderGeometry(0.01, 0.01, 0.34, 5), k.color.wood, { x: Math.cos(i * 1.57 + 0.78) * 0.16, y: 0.17, z: Math.sin(i * 1.57 + 0.78) * 0.16 })),
      part(new BoxGeometry(0.36, 0.015, 0.36), k.tint.cloth, { y: 0.35 }),
      part(new BoxGeometry(0.37, 0.04, 0.37), k.color.accent, { y: 0.33 }),
    ]));
    model.add(top);
    const anchor = new Group();
    anchor.position.set(0, 0.45, 0);
    top.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      const s = Math.sin(time * 0.5 + phase);
      lookout.rotation.y = Math.sign(s) * Math.pow(Math.abs(s), 0.4) * 1.3;
    };

    model.wreck = async (ctx) => {
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.6, 0)));
      anchor.visible = false;
      const off = throwPart(ctx, top, new Vector3(0.36, 0.04, 0.3), 0.4, 0.8, new Vector3(0, 0, 0), new Vector3(1.2, 0.6, 1.5));
      await off;
      ctx.emit('dust', model.worldOf(new Vector3(0.3, 0.1, 0.3)));
    };
    return model;
  };
}

/**
 * Astrolábio: a great brass astrolabe on a stone stand, its pierced rete
 * turning slowly over the plate of stars. When struck it is knocked off the
 * stand and rolls away like a wheel.
 */
export function arabAstrolabe(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    const brass = new Color('#d0a040');
    const brassDark = new Color('#8a6420');
    model.add(piece(k, body, 'ar-astro-stand', () => [
      part(new CylinderGeometry(0.34, 0.37, 0.06, 14), k.color.stoneDark, { y: 0.03 }),
      part(new BoxGeometry(0.34, 0.16, 0.2), k.color.stone, { y: 0.14 }),
      part(new BoxGeometry(0.35, 0.03, 0.21), 'main', { y: 0.2 }),
      part(new BoxGeometry(0.04, 0.22, 0.06), brassDark, { x: -0.12, y: 0.32 }),
      part(new BoxGeometry(0.04, 0.22, 0.06), brassDark, { x: 0.12, y: 0.32 }),
      ...moved(figure(k, 0.38, 'officer', k.params.helmet, null), { x: 0.3, z: 0.18, ry: -2.2 }),
    ]));
    const disc = new Group();
    disc.position.set(0, 0.52, 0);
    disc.add(piece(k, body, 'ar-astro-mater', () => {
      const parts: Parts = [
        part(new CylinderGeometry(0.22, 0.22, 0.03, 28), brassDark, { rx: Math.PI / 2 }),
        part(new TorusGeometry(0.22, 0.02, 6, 28), brass),
        // The throne and ring it hangs from.
        part(new BoxGeometry(0.08, 0.06, 0.035), brass, { y: 0.24 }),
        part(new TorusGeometry(0.035, 0.01, 4, 12), brass, { y: 0.3 }),
        part(new TorusGeometry(0.15, 0.004, 4, 24), brass, { z: -0.017 }),
        part(new TorusGeometry(0.08, 0.004, 4, 20), brass, { z: -0.017 }),
      ];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        parts.push(part(new BoxGeometry(0.004, 0.02, 0.004), brass, { x: Math.cos(a) * 0.2, y: Math.sin(a) * 0.2, z: -0.017, rz: a + Math.PI / 2 }));
      }
      return parts;
    }));
    const rete = piece(k, body, 'ar-astro-rete', () => {
      const parts: Parts = [part(new TorusGeometry(0.12, 0.008, 4, 22), brass, { y: 0.03 })];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(part(new ConeGeometry(0.01, 0.07, 4), brass, { x: Math.cos(a) * 0.15, y: Math.sin(a) * 0.15, rz: a - Math.PI / 2 }));
        parts.push(part(new SphereGeometry(0.008, 4, 3), 'glow', { x: Math.cos(a) * 0.185, y: Math.sin(a) * 0.185 }));
      }
      parts.push(part(new BoxGeometry(0.4, 0.014, 0.006), brass));
      return parts;
    });
    rete.position.z = -0.03;
    disc.add(rete);
    model.add(disc);
    const anchor = new Group();
    anchor.position.set(0, 0.4, 0);
    disc.add(anchor);
    model.flagAnchor = anchor;

    model.idle = (time, dt) => {
      rete.rotation.z += dt * 0.25;
      body.userData.unit.lights.value = 0.7 + 0.3 * Math.sin(time * 1.6);
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(0, 0.55, 0)));
      // Off the stand and rolling away on its rim.
      await lerpTo(ctx, 0.3, (e) => (disc.position.y = 0.52 - e * 0.3));
      const roll = ctx.tweens.run(1.0, (t) => {
        disc.position.x = -t * 0.55;
        disc.rotation.z = t * 2.5;
        disc.rotation.y = t * 0.6;
      });
      const dim = lerpTo(ctx, 0.8, (e) => (body.userData.unit.lights.value = 1 - e));
      await Promise.all([roll, dim]);
      await topple(ctx, disc, 'x', -1.4, 0.5);
    };
    return model;
  };
}

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/** A long low black tent of woven goat hair, open on its front. */
function blackTent(k: KitStyle, length: number): Parts {
  const hair = new Color('#2e2622');
  const parts: Parts = [
    part(new CylinderGeometry(0.22, 0.22, length, 8, 1, true, 0, Math.PI), hair, { rz: Math.PI / 2 }),
    part(new BoxGeometry(length, 0.02, 0.02), k.color.accent, { y: 0.215 }),
    part(new BoxGeometry(length, 0.03, 0.005), 'main', { y: 0.15, z: -0.2 }),
    part(new BoxGeometry(length * 0.8, 0.008, 0.3), new Color('#9a2a2a'), { y: 0.004, z: -0.28 }),
  ];
  for (const x of [-length / 2, 0, length / 2]) parts.push(part(new CylinderGeometry(0.008, 0.008, 0.28, 4), k.color.wood, { x, y: 0.14, z: -0.22 }));
  return parts.map((g) => g.scale(1, 1.15, 1));
}

/**
 * Acampamento Beduíno: two black tents, a coffee fire and a resting camel.
 * When struck the tent poles give, the cloth sags flat and the camel gets up
 * and wanders off.
 */
export function arabBedouinCamp(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const tents: Mesh[] = [];
    for (const [at, len] of [[ANT_A, 0.62], [ANT_B, 0.66]] as const) {
      const t = piece(k, body, `ar-tent-${len}`, () => blackTent(k, len));
      t.position.copy(at);
      t.rotation.y = at === ANT_A ? 0.2 : -0.15;
      model.add(t);
      tents.push(t);
    }
    model.add(piece(k, body, 'ar-camp-ground', () => [
      part(new CylinderGeometry(0.2, 0.22, 0.02, 12), new Color('#c8a870'), { x: ANT_C.x - 0.1, y: 0.01, z: ANT_C.z - 0.15 }),
      ...[0, 1, 2, 3, 4].map((i) => part(new SphereGeometry(0.03, 5, 4), k.color.stoneDark, { x: ANT_C.x - 0.1 + Math.cos(i * 1.26) * 0.08, y: 0.025, z: ANT_C.z - 0.15 + Math.sin(i * 1.26) * 0.08 })),
      part(new SphereGeometry(0.04, 6, 4), 'glow', { x: ANT_C.x - 0.1, y: 0.03, z: ANT_C.z - 0.15, sy: 0.6 }),
      // The coffee pot with its long beak.
      part(new CylinderGeometry(0.02, 0.03, 0.06, 8), new Color('#c8a040'), { x: ANT_C.x - 0.02, y: 0.05, z: ANT_C.z - 0.1 }),
      part(new ConeGeometry(0.01, 0.05, 5), new Color('#c8a040'), { x: ANT_C.x - 0.05, y: 0.07, z: ANT_C.z - 0.1, rz: 1.0 }),
      ...moved(figure(k, 0.42, 'soldier', k.params.helmet, null), { x: ANT_C.x - 0.3, z: ANT_C.z - 0.05, ry: -1.3 }),
    ]));
    const beast = new Group();
    beast.position.set(ANT_C.x + 0.12, 0, ANT_C.z + 0.12);
    beast.rotation.y = 0.6;
    beast.add(piece(k, body, 'ar-camel', () => [...camel(new Color('#c49a62')), part(new BoxGeometry(0.16, 0.05, 0.16), k.tint.cloth, { y: 0.5 })]));
    model.add(beast);
    const smoke = new Puffs(new Vector3(ANT_C.x - 0.1, 0.1, ANT_C.z - 0.15), 4, 1, 0.04);
    model.add(smoke.group);
    const anchor = new Group();
    anchor.position.set(ANT_A.x, 0.45, ANT_A.z);
    model.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time, dt) => {
      smoke.update(dt);
      beast.children[0]!.rotation.z = Math.sin(time * 0.6 + phase) * 0.02;
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(ANT_A.x, 0.2, ANT_A.z)));
      const jobs = tents.map((t, i) => lerpTo(ctx, 0.6, (e) => t.scale.set(1 + e * 0.1, 1 - e * 0.8, 1 + e * 0.1), i * 0.15));
      jobs.push(bolt(ctx, beast, new Vector3(1.2, 0, 0.6), 1.6));
      smoke.enabled = false;
      ctx.emit('smoke', model.worldOf(new Vector3(ANT_C.x, 0.2, ANT_C.z)));
      await Promise.all(jobs);
    };
    return model;
  };
}

// ------------------------------------------------------------------ Parthia

/**
 * Tiro Parto: a horse archer galloping away while turned in the saddle to
 * loose an arrow back over the horse's croup. When struck the rider tumbles
 * off and the horse runs from the board.
 */
export function parthianShot(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('sniper', body);
    const h = horse(new Color('#8a5a3a'), new Color('#2a1c14'));
    const mount = new Group();
    mount.rotation.y = 0.7;
    mount.scale.setScalar(1.05);
    mount.add(piece(k, body, 'pa-shot-horse', () => [...h.body, part(new BoxGeometry(0.22, 0.02, 0.2), k.tint.cloth, { y: 0.44 }), part(new BoxGeometry(0.24, 0.012, 0.21), k.color.accent, { y: 0.432 })]));
    const head = new Group();
    head.position.set(...h.headPivot);
    head.add(piece(k, body, 'pa-shot-horse-head', () => h.head));
    mount.add(head);
    const rider = new Group();
    rider.position.set(0.02, 0.4, 0);
    rider.rotation.y = -Math.PI / 2 - 0.3;
    rider.add(piece(k, body, 'pa-shot-rider', () => {
      const bow = new TorusGeometry(0.2, 0.012, 4, 12, Math.PI * 0.75);
      bow.rotateZ(-Math.PI * 0.375);
      bow.rotateY(Math.PI / 2);
      return [
        ...figure(k, 0.5, 'archer', k.params.helmet, null),
        part(bow, k.color.woodDark, { x: 0, y: 0.24, z: -0.16, sx: 0.55, sy: 0.55, sz: 0.55 }),
        part(new CylinderGeometry(0.004, 0.004, 0.2, 4), k.color.wood, { y: 0.24, z: -0.08, rx: Math.PI / 2 }),
      ];
    }));
    mount.add(rider);
    model.add(mount);
    const anchor = new Group();
    anchor.position.set(0.2, 0.6, 0.1);
    mount.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      const g = Math.sin(time * 4 + phase);
      mount.position.y = Math.abs(g) * 0.02;
      mount.rotation.z = g * 0.04;
      head.rotation.z = g * 0.12;
      rider.rotation.x = Math.sin(time * 0.7 + phase) * 0.05;
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      model.attach(rider);
      const off = throwPart(ctx, rider, new Vector3(0.3, 0.02, 0.3), 0.3, 0.7, new Vector3(0, 0, 0), new Vector3(Math.PI / 2, 0.6, 0));
      const away = bolt(ctx, mount, new Vector3(-1.6, 0, -0.8), 1.5);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.1, 0)));
      await Promise.all([off, away]);
    };
    return model;
  };
}

/** One half of the great parabolic vault, as box segments; s = −1 or 1. */
function vaultHalf(k: KitStyle, s: number, span: number, rise: number, depth: number): Parts {
  const parts: Parts = [];
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    // Parabola from the springing (|x| = span/2, y = 0) to the crown.
    const x0 = s * (span / 2) * (1 - t0);
    const x1 = s * (span / 2) * (1 - t1);
    const y0 = rise * (1 - (1 - t0) * (1 - t0));
    const y1 = rise * (1 - (1 - t1) * (1 - t1));
    const len = Math.hypot(x1 - x0, y1 - y0);
    parts.push(part(new BoxGeometry(len + 0.02, 0.12, depth), k.color.stone, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rz: Math.atan2(y1 - y0, x1 - x0) }));
    parts.push(part(new BoxGeometry(len + 0.02, 0.02, 0.012), k.color.accent, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - 0.05, z: -depth / 2 - 0.004, rz: Math.atan2(y1 - y0, x1 - x0) }));
  }
  return parts;
}

function arcadeWing(k: KitStyle, w: number, h: number): Parts {
  const parts: Parts = [part(new BoxGeometry(w, h, 0.26), k.color.stone, { y: h / 2 }), part(new BoxGeometry(w + 0.01, 0.035, 0.27), 'main', { y: h - 0.06 })];
  const rows = 4;
  const cols = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (c + 0.5) * (w / cols);
      const y = 0.08 + r * (h - 0.16) / rows;
      parts.push(part(new BoxGeometry(w / cols - 0.06, (h - 0.16) / rows - 0.06, 0.01), k.color.stoneDark, { x, y: y + 0.06, z: -0.132 }));
      parts.push(part(new CylinderGeometry((w / cols - 0.06) / 2, (w / cols - 0.06) / 2, 0.01, 10, 1, false, Math.PI / 2, Math.PI), k.color.stoneDark, { x, y: y + 0.06 + ((h - 0.16) / rows - 0.06) / 2, z: -0.132, rx: Math.PI / 2 }));
    }
  }
  return parts;
}

/**
 * Portal de Ctesifonte: the great brick vault of the royal hall between two
 * arcaded wings. When struck the wings lean out and fall and the two halves
 * of the vault crack apart at the crown.
 */
export function parthianCtesiphon(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const span = 0.74;
    const rise = 1.25;
    model.add(piece(k, body, 'pa-hall-floor', () => [
      part(new BoxGeometry(1.84, 0.04, 1.84), k.color.stoneDark, { y: 0.02 }),
      part(new BoxGeometry(span, 0.012, 1.0), k.color.stone.clone().multiplyScalar(0.9), { y: 0.045, z: 0.05 }),
      part(new BoxGeometry(span - 0.06, 0.9, 0.02), k.color.dark, { y: 0.45, z: 0.5 }),
      part(new BoxGeometry(span + 0.3, 0.5, 0.2), k.color.stone, { y: 0.29, z: 0.62 }),
    ]));
    const halves: Group[] = [];
    for (const s of [-1, 1]) {
      const holder = new Group();
      holder.position.set(s * span / 2, 0.04, 0.05);
      const inner = piece(k, body, `pa-vault-${s}`, () => vaultHalf(k, s, span, rise, 0.95));
      inner.position.x = -s * span / 2;
      holder.add(inner);
      model.add(holder);
      halves.push(holder);
    }
    const wings: Group[] = [];
    for (const s of [-1, 1]) {
      const holder = new Group();
      holder.position.set(s * 0.64, 0.04, -0.3);
      holder.add(piece(k, body, 'pa-wing', () => arcadeWing(k, 0.5, 0.95)));
      model.add(holder);
      wings.push(holder);
    }
    const anchor = new Group();
    anchor.position.set(0, 1.1, 0);
    wings[0]!.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      anchor.visible = false;
      await shudder(ctx, model, 0.025, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.9, 0)));
      const jobs: Promise<void>[] = [];
      wings.forEach((w, i) => jobs.push(topple(ctx, w, 'z', (i ? -1 : 1) * 1.3, 0.9, 0.1 + i * 0.1)));
      halves.forEach((h, i) => {
        const s = i ? 1 : -1;
        jobs.push(lerpTo(ctx, 0.9, (e) => {
          h.rotation.z = -s * e * 0.6;
          h.position.x = s * (span / 2 + e * 0.1);
          h.scale.y = 1 - e * 0.25;
        }, 0.35));
      });
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, -0.3)));
    };
    return model;
  };
}
