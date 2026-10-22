import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, SphereGeometry, TorusGeometry, Vector3, type Object3D } from 'three';
import { lathe, part } from '../../units/parts';
import { Puffs, UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { bolt, flicker, piece } from '../kit/common';
import { elephant, figure, flame, horse, moved, wheel, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

const BRICK = new Color('#9a4a32');

/** Square crenels along a wall top running along x. */
function crenels(tint: Color, width: number, depth: number, y: number, step = 0.1): Parts {
  const parts: Parts = [];
  const n = Math.max(2, Math.round(width / step));
  for (let i = 0; i < n; i += 1) {
    if (i % 2) continue;
    parts.push(part(new BoxGeometry(width / n, 0.06, depth), tint, { x: -width / 2 + (i + 0.5) * (width / n), y: y + 0.03 }));
  }
  return parts;
}

// ------------------------------------------------------------------ Byzantium

/** A wall tower in stone with the bands of red brick of the land walls. */
function bandedTower(k: KitStyle, w: number, h: number): Parts {
  const parts: Parts = [part(new BoxGeometry(w, h, w), k.color.stone, { y: h / 2 }), ...crenels(k.color.stone, w, w, h, w / 5), part(new BoxGeometry(w + 0.01, 0.035, w + 0.01), 'main', { y: h - 0.07 })];
  for (let y = 0.12; y < h - 0.12; y += 0.16) parts.push(part(new BoxGeometry(w + 0.006, 0.03, w + 0.006), BRICK, { y }));
  parts.push(part(new BoxGeometry(0.03, 0.08, 0.01), k.color.dark, { y: h * 0.65, z: -w / 2 - 0.004 }));
  return parts;
}

/**
 * Muralhas Triplas: the land walls in depth, a water moat, a low outer wall
 * with small towers and the tall inner wall with great banded towers. When
 * struck the inner towers fall one after another and the outer wall slumps.
 */
export function byzantineTripleWalls(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'bz-walls-ground', () => [
      part(new BoxGeometry(1.84, 0.04, 1.84), k.color.stoneDark, { y: 0.02 }),
      part(new BoxGeometry(1.84, 0.02, 0.24), new Color('#2a6a8a'), { y: 0.045, z: -0.78 }),
      part(new BoxGeometry(1.84, 0.1, 0.05), k.color.stone, { y: 0.09, z: -0.64 }),
      ...moved(crenels(k.color.stone, 1.84, 0.05, 0.14, 0.08), { z: -0.64 }),
    ]));
    const outer = new Group();
    outer.position.set(0, 0.04, -0.42);
    outer.add(piece(k, body, 'bz-walls-outer', () => {
      const parts: Parts = [part(new BoxGeometry(1.84, 0.3, 0.1), k.color.stone, { y: 0.15 }), part(new BoxGeometry(1.845, 0.03, 0.105), BRICK, { y: 0.14 }), ...crenels(k.color.stone, 1.84, 0.1, 0.3, 0.08)];
      for (const x of [-0.7, -0.23, 0.23, 0.7]) parts.push(...moved(bandedTower(k, 0.18, 0.42), { x }));
      return parts;
    }));
    model.add(outer);
    model.add(piece(k, body, 'bz-walls-inner', () => [
      part(new BoxGeometry(1.84, 0.62, 0.16), k.color.stone, { y: 0.35, z: 0.2 }),
      part(new BoxGeometry(1.845, 0.035, 0.165), BRICK, { y: 0.3, z: 0.2 }),
      part(new BoxGeometry(1.845, 0.035, 0.165), BRICK, { y: 0.48, z: 0.2 }),
      ...moved(crenels(k.color.stone, 1.84, 0.16, 0.66, 0.08), { z: 0.2 }),
      part(new BoxGeometry(1.84, 0.4, 0.5), k.color.stoneDark, { y: 0.24, z: 0.6 }),
    ]));
    const towers: Group[] = [];
    for (const x of [-0.62, 0, 0.62]) {
      const holder = new Group();
      holder.position.set(x, 0.04, 0.2);
      holder.add(piece(k, body, 'bz-walls-tower', () => bandedTower(k, 0.32, 0.98)));
      model.add(holder);
      towers.push(holder);
    }
    const anchor = new Group();
    anchor.position.set(0, 1.12, 0);
    towers[1]!.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      anchor.visible = false;
      await shudder(ctx, model, 0.025, 0.2);
      const jobs: Promise<void>[] = [];
      towers.forEach((t, i) => {
        jobs.push(ctx.tweens.wait(i * 0.18).then(() => ctx.emit('dust', model.worldOf(new Vector3(t.position.x, 0.8, 0.2)))));
        jobs.push(topple(ctx, t, 'x', 1.2 * (i % 2 ? -1 : 1), 0.9, i * 0.18));
        jobs.push(lerpTo(ctx, 0.8, (e) => t.scale.set(1, 1 - e * 0.4, 1), i * 0.18));
      });
      jobs.push(lerpTo(ctx, 0.7, (e) => {
        outer.scale.y = 1 - e * 0.55;
        outer.rotation.x = -e * 0.1;
      }, 0.4));
      await Promise.all(jobs);
    };
    return model;
  };
}

/**
 * Sifão de Fogo: a wheeled platform with a bronze tank heated over a brick
 * furnace, a rocking pump worked by two men and a long swivelling siphon
 * that ends in a flared bronze mouth. When struck the tank bursts in flames,
 * the siphon drops and the crew scatters.
 */
export function byzantineFireSiphon(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('artillery', body);
    const bronze = new Color('#b0783a');
    model.add(piece(k, body, 'bz-siphon-cart', () => {
      const parts: Parts = [
        part(new BoxGeometry(1.6, 0.08, 0.62), k.color.wood, { y: 0.22 }),
        part(new BoxGeometry(1.62, 0.03, 0.64), 'main', { y: 0.27 }),
        // Brick furnace, its glowing mouth, and the tank above.
        part(new BoxGeometry(0.42, 0.2, 0.4), BRICK, { x: 0.45, y: 0.36 }),
        part(new BoxGeometry(0.12, 0.08, 0.01), 'glow', { x: 0.45, y: 0.34, z: -0.205 }),
        part(lathe([[0, 0], [0.16, 0], [0.19, 0.06], [0.19, 0.24], [0.15, 0.32], [0.05, 0.36], [0, 0.36]], 16), bronze, { x: 0.45, y: 0.46 }),
        part(new TorusGeometry(0.19, 0.012, 4, 16), k.color.accent, { x: 0.45, y: 0.6, rx: Math.PI / 2 }),
        // Mantlet at the front, with the team panel.
        part(new BoxGeometry(0.05, 0.34, 0.56), k.color.woodDark, { x: -0.7, y: 0.43 }),
        part(new BoxGeometry(0.055, 0.2, 0.4), 'main', { x: -0.7, y: 0.45 }),
        part(new CylinderGeometry(0.02, 0.02, 0.4, 6), k.color.woodDark, { x: -0.55, y: 0.45 }),
        part(new CylinderGeometry(0.02, 0.02, 0.28, 6), k.color.woodDark, { x: 0.0, y: 0.4 }),
      ];
      for (const x of [-0.5, 0.55]) for (const z of [-0.33, 0.33]) parts.push(...moved(wheel(k, 0.14, 6), { x, y: 0.14, z }));
      return parts;
    }));
    const pipe = new Group();
    pipe.position.set(-0.55, 0.66, 0);
    pipe.add(piece(k, body, 'bz-siphon-pipe', () => [
      part(new CylinderGeometry(0.032, 0.032, 1.0, 10), bronze, { x: 0.45, rz: Math.PI / 2 }),
      part(new CylinderGeometry(0.075, 0.032, 0.18, 12), bronze, { x: -0.62, rz: Math.PI / 2 }),
      part(new TorusGeometry(0.075, 0.012, 4, 14), k.color.accent, { x: -0.71, ry: Math.PI / 2 }),
      part(new TorusGeometry(0.04, 0.01, 4, 10), k.color.accent, { x: -0.1, ry: Math.PI / 2 }),
      part(new TorusGeometry(0.04, 0.01, 4, 10), k.color.accent, { x: 0.5, ry: Math.PI / 2 }),
    ]));
    const tongue = flame(1.2);
    tongue.rotation.z = Math.PI / 2;
    tongue.position.set(-0.78, 0, 0);
    pipe.add(tongue);
    model.add(pipe);
    const lever = new Group();
    lever.position.set(0.0, 0.56, 0);
    lever.add(piece(k, body, 'bz-siphon-lever', () => [part(new BoxGeometry(0.03, 0.03, 0.62), k.color.woodDark), part(new CylinderGeometry(0.05, 0.05, 0.12, 10), bronze, { y: -0.06 })]));
    model.add(lever);
    const crew = piece(k, body, 'bz-siphon-crew', () => [
      ...moved(figure(k, 0.46, 'soldier', k.params.helmet, null), { x: 0.0, z: -0.42 }),
      ...moved(figure(k, 0.46, 'soldier', k.params.helmet, null), { x: 0.0, z: 0.42, ry: Math.PI }),
      ...moved(figure(k, 0.46, 'officer', k.params.helmet, null), { x: -1.05, z: 0.25, ry: Math.PI / 2 }),
    ]);
    model.add(crew);
    const anchor = new Group();
    anchor.position.set(0.85, 0.55, 0.2);
    model.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      lever.rotation.x = Math.sin(time * 2.2 + phase) * 0.3;
      pipe.rotation.y = Math.sin(time * 0.4 + phase) * 0.12;
      const burst = Math.max(0, Math.sin(time * 0.8 + phase));
      tongue.visible = burst > 0.2;
      flicker([tongue], time, 0.6 + burst * 0.9);
      body.userData.unit.lights.value = 0.6 + 0.4 * Math.abs(Math.sin(time * 5 + phase));
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      tongue.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(0.45, 0.7, 0)));
      ctx.emit('smoke', model.worldOf(new Vector3(0.45, 0.8, 0)));
      const flames: Object3D[] = [];
      for (const [x, z] of [[0.35, -0.1], [0.55, 0.12], [0.45, 0.0]] as const) {
        const f = flame(1.4);
        f.position.set(x, 0.62, z);
        model.add(f);
        flames.push(f);
      }
      const burn = ctx.tweens.run(1.2, (t) => flicker(flames, t * 6, 1.4 * (1 - t * 0.5)));
      const drop = lerpTo(ctx, 0.5, (e) => {
        pipe.rotation.z = e * 0.35;
        pipe.position.y = 0.66 - e * 0.28;
      }, 0.1);
      const scatter = throwPart(ctx, crew, new Vector3(0.25, 0, 0.15), 0.15, 0.6, new Vector3(0, 0.5, 0));
      const leverOff = throwPart(ctx, lever, new Vector3(0.2, 0.32, 0.5), 0.3, 0.6, new Vector3(1, 0, 2));
      await Promise.all([burn, drop, scatter, leverOff]);
      ctx.emit('smoke', model.worldOf(new Vector3(0.45, 0.6, 0)));
      for (const f of flames) f.visible = false;
    };
    return model;
  };
}

// ------------------------------------------------------------------ India

/** A chhatri: a small domed pavilion on four slender pillars. */
function chhatri(k: KitStyle, size: number, dome: Color): Parts {
  const s = size;
  const parts: Parts = [part(new BoxGeometry(s, 0.03, s), k.color.stone, { y: 0.015 })];
  for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) parts.push(part(new CylinderGeometry(s * 0.05, s * 0.05, s * 0.8, 6), k.color.stone, { x: x * s * 0.38, y: s * 0.4 + 0.03, z: z * s * 0.38 }));
  parts.push(part(new BoxGeometry(s * 1.12, 0.03, s * 1.12), k.color.stone, { y: s * 0.8 + 0.045 }));
  parts.push(part(new SphereGeometry(s * 0.42, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.6), dome, { y: s * 0.8 + 0.06, sy: 1.15 }));
  parts.push(part(new ConeGeometry(s * 0.06, s * 0.3, 6), k.color.accent, { y: s * 0.8 + 0.06 + s * 0.5 }));
  return parts;
}

/**
 * Elefante de Guerra: a bull elephant in a team caparison with a gilded brow
 * plate and bells, carrying a howdah under a small domed canopy, with a
 * mahout on its neck. When struck the howdah slides off, the mahout jumps
 * clear and the elephant turns and leaves the board.
 */
export function indianWarElephant(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('armor', body);
    const grey = new Color('#7a7470');
    const ivory = new Color('#efe6d0');
    const gold = new Color('#d8a83a');
    const beast = new Group();
    beast.add(piece(k, body, 'in-elephant', () => {
      const parts: Parts = [...elephant(grey, ivory)];
      for (const s of [-1, 1]) {
        // Caparison down both flanks, gold border and a row of bells.
        parts.push(part(new BoxGeometry(0.34, 0.2, 0.012), k.tint.cloth, { x: 0.02, y: 0.44, z: s * 0.205 }));
        parts.push(part(new BoxGeometry(0.35, 0.025, 0.014), gold, { x: 0.02, y: 0.34, z: s * 0.206 }));
        for (let i = 0; i < 4; i++) parts.push(part(new SphereGeometry(0.014, 5, 4), gold, { x: -0.1 + i * 0.08, y: 0.32, z: s * 0.21 }));
      }
      parts.push(part(new BoxGeometry(0.36, 0.02, 0.42), k.tint.cloth, { x: 0.02, y: 0.56 }));
      parts.push(part(new BoxGeometry(0.1, 0.12, 0.13), gold, { x: -0.41, y: 0.5, rz: 0.2 }));
      parts.push(part(new SphereGeometry(0.02, 6, 4), new Color('#c0302a'), { x: -0.44, y: 0.52 }));
      return parts;
    }));
    beast.scale.setScalar(1.35);
    model.add(beast);
    const mahout = piece(k, body, 'in-mahout', () => figure(k, 0.4, 'soldier', 'turban', null));
    mahout.position.set(-0.42, 0.7, 0);
    model.add(mahout);
    const howdah = new Group();
    howdah.position.set(0.08, 0.78, 0);
    howdah.add(piece(k, body, 'in-howdah', () => [
      part(new BoxGeometry(0.36, 0.14, 0.32), k.color.wood, { y: 0.07 }),
      part(new BoxGeometry(0.37, 0.03, 0.33), gold, { y: 0.14 }),
      part(new BoxGeometry(0.37, 0.05, 0.33), 'main', { y: 0.05 }),
      ...moved(chhatri(k, 0.36, k.color.secondary), { y: 0.14 }),
      ...moved(figure(k, 0.36, 'archer', k.params.helmet, null), { x: 0.02, y: 0.12 }),
    ]));
    model.add(howdah);
    const anchor = new Group();
    anchor.position.set(0.15, 0.5, 0.12);
    howdah.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      const sway = Math.sin(time * 1.0 + phase);
      beast.rotation.z = sway * 0.02;
      howdah.rotation.z = sway * 0.035;
      howdah.rotation.x = Math.sin(time * 0.5 + phase) * 0.02;
      beast.position.y = Math.abs(sway) * 0.008;
    };

    model.wreck = async (ctx) => {
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      anchor.visible = false;
      const off = throwPart(ctx, howdah, new Vector3(0.55, 0.02, -0.4), 0.25, 0.8, new Vector3(0, 0, 0), new Vector3(-0.3, 0.5, -1.3));
      const jump = throwPart(ctx, mahout, new Vector3(-0.55, 0.02, 0.45), 0.3, 0.7, new Vector3(0, 0, 0), new Vector3(0, 0.8, 0));
      const away = bolt(ctx, beast, new Vector3(-1.8, 0, -0.8), 1.8);
      await Promise.all([off, jump, away]);
    };
    return model;
  };
}

/**
 * Palácio dos Chhatris: a red sandstone palace on a stepped plinth, with
 * cusped arcades, projecting balconies, a domed pavilion over the centre and
 * a chhatri at each corner of the roof terrace. When struck the chhatris are
 * thrown down, the central dome sinks and the arcade slumps.
 */
export function indianPalace(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const red = new Color('#b0603a');
    const marble = new Color('#efe8dc');
    const block = new Group();
    block.add(piece(k, body, 'in-palace-block', () => {
      const parts: Parts = [
        part(new BoxGeometry(1.84, 0.04, 1.84), k.color.stoneDark, { y: 0.02 }),
        part(new BoxGeometry(1.6, 0.12, 1.5), red, { y: 0.1 }),
        part(new BoxGeometry(1.4, 0.1, 1.3), red.clone().multiplyScalar(0.92), { y: 0.21 }),
        part(new BoxGeometry(0.4, 0.12, 0.3), red, { y: 0.1, z: -0.85 }),
        part(new BoxGeometry(1.26, 0.5, 1.0), red, { y: 0.51 }),
        part(new BoxGeometry(1.3, 0.04, 1.04), 'main', { y: 0.78 }),
        part(new BoxGeometry(1.32, 0.05, 1.06), marble, { y: 0.74 }),
      ];
      // Cusped arcade along the front: dark openings under small arches.
      for (let i = 0; i < 5; i++) {
        const x = -0.48 + i * 0.24;
        parts.push(part(new BoxGeometry(0.14, 0.2, 0.01), k.color.dark, { x, y: 0.4, z: -0.505 }));
        parts.push(part(new CylinderGeometry(0.07, 0.07, 0.01, 10, 1, false, Math.PI / 2, Math.PI), k.color.dark, { x, y: 0.5, z: -0.505, rx: Math.PI / 2 }));
        parts.push(part(new ConeGeometry(0.02, 0.04, 4), k.color.dark, { x, y: 0.58, z: -0.505 }));
      }
      // Projecting balconies (jharokhas) on the upper storey.
      for (const x of [-0.42, 0.42]) {
        parts.push(part(new BoxGeometry(0.2, 0.14, 0.12), marble, { x, y: 0.66, z: -0.55 }));
        parts.push(part(new SphereGeometry(0.08, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), marble, { x, y: 0.73, z: -0.55, sz: 0.7 }));
        parts.push(part(new BoxGeometry(0.16, 0.02, 0.1), k.tint.trim, { x, y: 0.6, z: -0.56 }));
      }
      return parts;
    }));
    model.add(block);
    const dome = new Group();
    dome.position.set(0, 0.8, 0);
    dome.add(piece(k, body, 'in-palace-dome', () => [
      part(new CylinderGeometry(0.24, 0.26, 0.12, 16), marble, { y: 0.06 }),
      part(new SphereGeometry(0.25, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), marble, { y: 0.12, sy: 1.15 }),
      part(new ConeGeometry(0.04, 0.16, 8), k.color.accent, { y: 0.48 }),
      part(new TorusGeometry(0.25, 0.012, 4, 18), k.color.accent, { y: 0.12, rx: Math.PI / 2 }),
    ]));
    model.add(dome);
    const corners: Group[] = [];
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const c = new Group();
      c.position.set(x * 0.5, 0.8, z * 0.36);
      c.add(piece(k, body, 'in-palace-chhatri', () => chhatri(k, 0.22, marble)));
      model.add(c);
      corners.push(c);
    }
    const anchor = new Group();
    anchor.position.set(0, 0.6, 0);
    dome.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      anchor.visible = false;
      await shudder(ctx, model, 0.025, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.8, 0)));
      const jobs = corners.map((c, i) => throwPart(ctx, c, new Vector3(c.position.x * 1.7, 0.06, c.position.z * 2.2), 0.3, 0.8, new Vector3(0, 0, 0), new Vector3(c.position.z * 3, i, -c.position.x * 3)));
      jobs.push(lerpTo(ctx, 0.8, (e) => {
        dome.position.y = 0.8 - e * 0.35;
        dome.rotation.z = e * 0.25;
      }, 0.3));
      jobs.push(lerpTo(ctx, 0.8, (e) => block.scale.set(1, 1 - e * 0.25, 1), 0.4));
      await Promise.all(jobs);
    };
    return model;
  };
}

// ------------------------------------------------------------------ Huns

/** A camp wagon facing −x: plank bed, hide cover on hoops and four wheels. */
function campWagon(k: KitStyle): Parts {
  const hide = k.color.secondary.clone().lerp(new Color('#a08460'), 0.5);
  const parts: Parts = [
    part(new BoxGeometry(0.5, 0.08, 0.28), k.color.wood, { y: 0.18 }),
    part(new CylinderGeometry(0.15, 0.15, 0.46, 10, 1, true, 0, Math.PI), hide, { y: 0.22, rz: Math.PI / 2 }),
    part(new CylinderGeometry(0.152, 0.152, 0.04, 10, 1, true, 0, Math.PI), 'main', { y: 0.22, rz: Math.PI / 2 }),
    part(new BoxGeometry(0.36, 0.02, 0.02), k.color.woodDark, { x: -0.4, y: 0.12, rz: 0.2 }),
  ];
  for (const x of [-0.17, 0.17]) for (const z of [-0.16, 0.16]) parts.push(...moved(wheel(k, 0.1, 6), { x, y: 0.1, z }));
  return parts;
}

/**
 * Círculo de Carroças: the camp wagons drawn up in a ring around the fire,
 * hide covers in team bands and a horse-tail standard. When struck the
 * wagons tip over one by one and the fire is scattered.
 */
export function hunWagonLaager(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'hu-laager-ground', () => [
      part(new CylinderGeometry(0.88, 0.9, 0.04, 22), k.color.stoneDark, { y: 0.02 }),
      ...[0, 1, 2, 3, 4, 5].map((i) => part(new SphereGeometry(0.04, 5, 4), k.color.stone, { x: Math.cos(i * 1.05) * 0.12, y: 0.05, z: Math.sin(i * 1.05) * 0.12 })),
      part(new SphereGeometry(0.06, 8, 6), 'glow', { y: 0.06, sy: 0.6 }),
      part(new CylinderGeometry(0.012, 0.014, 1.0, 6), k.color.wood, { x: 0.25, y: 0.54, z: 0.25 }),
      part(new SphereGeometry(0.035, 8, 6), k.color.accent, { x: 0.25, y: 1.06, z: 0.25 }),
      ...[0, 1, 2, 3, 4].map((i) => part(new CylinderGeometry(0.014, 0.004, 0.3, 4), i % 2 ? 'main' : k.color.dark, { x: 0.25 + Math.cos(i * 1.26) * 0.03, y: 0.86, z: 0.25 + Math.sin(i * 1.26) * 0.03 })),
    ]));
    const wagons: Group[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const holder = new Group();
      holder.position.set(Math.cos(a) * 0.6, 0.04, Math.sin(a) * 0.6);
      holder.rotation.y = -a + Math.PI / 2;
      const tilt = new Group();
      tilt.add(piece(k, body, 'hu-wagon', () => campWagon(k)));
      holder.add(tilt);
      model.add(holder);
      wagons.push(tilt);
    }
    const smoke = new Puffs(new Vector3(0, 0.12, 0), 5, 1, 0.05);
    model.add(smoke.group);
    const anchor = new Group();
    anchor.position.set(0.25, 1.0, 0.25);
    model.add(anchor);
    model.flagAnchor = anchor;

    model.idle = (time, dt) => {
      smoke.update(dt);
      body.userData.unit.lights.value = 0.7 + 0.3 * Math.abs(Math.sin(time * 6));
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      smoke.enabled = false;
      ctx.emit('sparks', model.worldOf(new Vector3(0, 0.1, 0)));
      const jobs = wagons.map((w, i) => topple(ctx, w, 'x', (i % 2 ? 1 : -1) * 1.45, 0.8, i * 0.12));
      jobs.push(lerpTo(ctx, 0.5, (e) => (body.userData.unit.lights.value = 1 - e)));
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
    };
    return model;
  };
}

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/** A falcon perched with folded wings, facing −z. */
function falconParts(): Parts {
  const brown = new Color('#7a5a3e');
  const pale = new Color('#d8c8a8');
  return [
    part(new SphereGeometry(0.035, 8, 6), brown, { sy: 1.4 }),
    part(new SphereGeometry(0.026, 8, 6), pale, { y: 0.004, z: -0.016, sy: 1.2 }),
    part(new SphereGeometry(0.022, 8, 6), brown, { y: 0.055, z: -0.006 }),
    part(new ConeGeometry(0.008, 0.02, 4), new Color('#e8c040'), { y: 0.05, z: -0.03, rx: -Math.PI / 2 }),
    part(new BoxGeometry(0.03, 0.05, 0.012), brown, { y: -0.05, z: 0.025, rx: 0.4 }),
  ];
}

/**
 * Mastro de Estandartes: a tall pole with a crossbar of long streamers and a
 * gilded disc, a falconer with a falcon on its perch and a tethered horse.
 * When struck the pole falls, the falcon takes flight and the horse runs.
 */
export function hunStandards(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const pole = new Group();
    pole.position.copy(ANT_A);
    pole.add(piece(k, body, 'hu-standard', () => {
      const parts: Parts = [
        part(new CylinderGeometry(0.16, 0.2, 0.06, 10), k.color.stoneDark, { y: 0.03 }),
        part(new CylinderGeometry(0.018, 0.022, 1.45, 8), k.color.wood, { y: 0.75 }),
        part(new BoxGeometry(0.5, 0.025, 0.025), k.color.woodDark, { y: 1.3 }),
        part(new CylinderGeometry(0.07, 0.07, 0.015, 16), k.color.accent, { y: 1.52, rx: Math.PI / 2 }),
        part(new TorusGeometry(0.07, 0.008, 4, 16), k.color.metal, { y: 1.52 }),
      ];
      for (const [x, tint] of [[-0.22, 'main'], [0, k.color.dark], [0.22, 'main']] as const) {
        parts.push(part(new BoxGeometry(0.06, 0.5, 0.006), tint, { x, y: 1.04 }));
        parts.push(part(new ConeGeometry(0.03, 0.08, 3), tint, { x, y: 0.76, rx: Math.PI }));
      }
      return parts;
    }));
    model.add(pole);
    model.add(piece(k, body, 'hu-falconer', () => [
      ...moved(figure(k, 0.46, 'soldier', k.params.helmet, null), { x: ANT_B.x + 0.12, z: ANT_B.z + 0.1, ry: -0.5 }),
      part(new CylinderGeometry(0.01, 0.012, 0.4, 5), k.color.woodDark, { x: ANT_B.x - 0.12, y: 0.2, z: ANT_B.z - 0.05 }),
      part(new BoxGeometry(0.14, 0.02, 0.02), k.color.woodDark, { x: ANT_B.x - 0.12, y: 0.4, z: ANT_B.z - 0.05 }),
    ]));
    const falcon = piece(k, body, 'hu-falcon', () => falconParts());
    falcon.position.set(ANT_B.x - 0.12, 0.45, ANT_B.z - 0.05);
    falcon.scale.setScalar(2.2);
    model.add(falcon);
    const h = horse(new Color('#5a3a26'), new Color('#1e140e'));
    const steed = new Group();
    steed.position.copy(ANT_C);
    steed.rotation.y = -0.4;
    steed.add(piece(k, body, 'hu-horse', () => [...h.body, part(new BoxGeometry(0.22, 0.02, 0.2), k.tint.cloth, { y: 0.44 })]));
    const head = new Group();
    head.position.set(...h.headPivot);
    head.add(piece(k, body, 'hu-horse-head', () => h.head));
    steed.add(head);
    model.add(steed);
    const anchor = new Group();
    anchor.position.set(0.04, 1.2, 0);
    pole.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      pole.rotation.z = Math.sin(time * 0.8 + phase) * 0.015;
      falcon.rotation.y = Math.sin(time * 0.4 + phase) * 0.6;
      head.rotation.z = -0.5 + Math.sin(time * 0.7 + phase) * 0.25;
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(ANT_A.x, 0.3, ANT_A.z)));
      const fall = topple(ctx, pole, 'x', 1.45, 1.0, 0.1);
      const flight = ctx.tweens.run(1.4, (t) => {
        falcon.position.set(ANT_B.x - 0.12 + t * 1.2, 0.45 + t * 1.6, ANT_B.z - 0.05 - t * 0.6);
        falcon.scale.setScalar(Math.max(0.001, 2.2 * (1 - Math.max(0, t - 0.6) / 0.4)));
      });
      const away = bolt(ctx, steed, new Vector3(1.4, 0, 0.8), 1.6);
      await Promise.all([fall, flight, away]);
    };
    return model;
  };
}

