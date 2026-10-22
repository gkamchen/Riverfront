import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry, Vector3, type Object3D } from 'three';
import { lathe, part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { flicker, piece } from '../kit/common';
import { flame, moved, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/** Flared eight-sided roof with upturned eaves, eaves at y = 0. */
function flaredRoof(k: KitStyle, r: number): Parts {
  return [
    part(new ConeGeometry(r, 0.12, 8, 1, true), 'dark', { y: 0.06 }),
    part(new CylinderGeometry(r * 1.02, r * 1.02, 0.02, 8), k.color.accent, { y: 0.0 }),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => part(new ConeGeometry(0.012, 0.05, 4), k.color.accent, { x: Math.cos((i / 8) * Math.PI * 2) * r, y: 0.02, z: Math.sin((i / 8) * Math.PI * 2) * r, rz: 0.6 })),
  ];
}

/**
 * Pagode: a five-storey octagonal tower with red pillars and flared roofs, a
 * pavilion on the first cell and a bronze lantern on the last. When struck it
 * comes apart storey by storey, the top one first.
 */
export function chinaPagoda(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const pavilion = piece(k, body, 'cn-pavilion', () => [
      part(new BoxGeometry(0.5, 0.06, 0.42), k.color.stone, { y: 0.03 }),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(new CylinderGeometry(0.02, 0.02, 0.26, 6), k.color.primary, { x: sx * 0.18, y: 0.19, z: sz * 0.14 }))),
      ...moved(flaredRoof(k, 0.32), { y: 0.32 }),
      part(new SphereGeometry(0.03, 6, 4), k.color.accent, { y: 0.46 }),
    ]);
    pavilion.position.copy(ANT_A);
    model.add(pavilion);
    const lantern = piece(k, body, 'cn-lantern', () => [
      part(new CylinderGeometry(0.03, 0.05, 0.2, 8), k.color.metalDark, { y: 0.1 }),
      part(lathe([[0, 0], [0.08, 0.02], [0.1, 0.1], [0.08, 0.18], [0, 0.2]], 10), k.color.primary, { y: 0.2 }),
      part(new SphereGeometry(0.06, 8, 6), 'glow', { y: 0.3 }),
      part(new ConeGeometry(0.1, 0.06, 8), k.color.dark, { y: 0.43 }),
    ]);
    lantern.position.copy(ANT_C);
    model.add(lantern);

    const tower = new Group();
    tower.position.copy(ANT_B);
    tower.add(piece(k, body, 'cn-pagoda-base', () => [part(new CylinderGeometry(0.3, 0.32, 0.08, 8), k.color.stone, { y: 0.04 })]));
    model.add(tower);
    const floors: Group[] = [];
    let parent: Object3D = tower;
    for (let i = 0; i < 5; i++) {
      const r = 0.2 - i * 0.022;
      const floor = new Group();
      floor.position.y = i === 0 ? 0.08 : 0.24;
      floor.add(piece(k, body, `cn-pagoda-floor-${i}`, () => [
        part(new CylinderGeometry(r, r, 0.16, 8), k.color.secondary, { y: 0.08 }),
        ...[0, 1, 2, 3].map((j) => part(new CylinderGeometry(0.014, 0.014, 0.16, 5), k.color.primary, { x: Math.cos(j * Math.PI / 2 + 0.4) * (r + 0.01), y: 0.08, z: Math.sin(j * Math.PI / 2 + 0.4) * (r + 0.01) })),
        part(new BoxGeometry(0.06, 0.08, 0.01), k.color.dark, { y: 0.07, z: -r - 0.002 }),
        ...moved(flaredRoof(k, r + 0.1), { y: 0.16 }),
      ]));
      parent.add(floor);
      floors.push(floor);
      parent = floor;
    }
    const spire = piece(k, body, 'cn-pagoda-spire', () => [part(new CylinderGeometry(0.008, 0.012, 0.22, 6), k.color.accent, { y: 0.11 }), ...[0.06, 0.11, 0.16].map((y) => part(new SphereGeometry(0.022, 6, 4), k.color.accent, { y }))]);
    spire.position.y = 0.26;
    parent.add(spire);
    const glowFlames = [flame(0.4)];
    glowFlames[0]!.position.set(ANT_C.x, 0.3, ANT_C.z);
    glowFlames[0]!.visible = false;
    const anchor = new Group();
    anchor.position.set(0.12, 0.16, 0.12);
    floors[2]!.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      body.userData.unit.lights.value = 0.75 + 0.25 * Math.sin(time * 1.8 + phase);
      lantern.rotation.z = Math.sin(time * 1.1 + phase) * 0.02;
      flicker(glowFlames, time, 1);
    };

    model.wreck = async (ctx) => {
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, 1.4, ANT_B.z)));
      anchor.visible = false;
      await shudder(ctx, tower, 0.03, 0.18);
      const jobs: Promise<void>[] = [];
      model.attach(spire);
      jobs.push(throwPart(ctx, spire, new Vector3(ANT_C.x + 0.4, 0.04, ANT_C.z - 0.3), 0.5, 0.7, new Vector3(3, 1, 2), new Vector3(Math.PI / 2, 0.3, 0.2)));
      // Storeys are shed from the top, each landing a little further out.
      [...floors].reverse().forEach((floor, i) => {
        if (i > 3) return;
        jobs.push(
          ctx.tweens.wait(0.15 + i * 0.2).then(() => {
            model.attach(floor);
            const out = new Vector3(ANT_B.x + (i % 2 ? -0.3 : 0.45), 0.04, ANT_B.z + (i % 2 ? 0.45 : -0.25 - i * 0.1));
            return throwPart(ctx, floor, out, 0.2, 0.6, new Vector3(0, 0, 0), new Vector3((i % 2 ? -1 : 1) * 1.4, i * 0.7, (i % 2 ? 1 : -1) * 0.3));
          }),
        );
      });
      jobs.push(topple(ctx, lantern, 'z', -1.4, 0.8, 0.3));
      jobs.push(lerpTo(ctx, 0.5, (e) => (pavilion.scale.y = 1 - e * 0.35), 0.5));
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(ANT_B.x, 0.2, ANT_B.z)));
    };
    return model;
  };
}

const W_LEN = 1.76;

function wallSection(k: KitStyle, length: number): Parts {
  const parts: Parts = [
    part(new BoxGeometry(length, 0.36, 0.42), k.color.stone, { y: 0.18 }),
    part(new BoxGeometry(length + 0.01, 0.02, 0.43), k.color.stoneDark, { y: 0.12 }),
    part(new BoxGeometry(length, 0.02, 0.34), k.color.stoneDark, { y: 0.37 }),
  ];
  const n = Math.round(length / 0.16);
  for (let i = 0; i < n; i++) {
    for (const s of [-1, 1]) parts.push(part(new BoxGeometry(0.09, 0.08, 0.06), k.color.stone, { x: -length / 2 + (i + 0.5) * (length / n), y: 0.4, z: s * 0.18 }));
  }
  return parts;
}

/**
 * Muralha: a stretch of the great wall across both cells with a two-storey
 * watchtower astride it and a gate below. When breached the tower roof flies,
 * the tower slumps and the wall breaks into sections that sink and tilt.
 */
export function chinaGreatWall(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'cn-wall-ground', () => [part(new BoxGeometry(1.8, 0.04, 1.8), k.color.stoneDark, { y: 0.02 })]));
    const sections = [-1, 0, 1].map((i) => {
      const g = new Group();
      g.position.set(i * (W_LEN / 3), 0.04, -0.3);
      g.add(piece(k, body, `cn-wall-${i === 0 ? 'gate' : 'run'}`, () => [
        ...wallSection(k, W_LEN / 3 - 0.01),
        ...(i === 0 ? [part(new BoxGeometry(0.22, 0.24, 0.44), k.color.dark, { y: 0.12 }), part(new CylinderGeometry(0.11, 0.11, 0.44, 12, 1, false, 0, Math.PI), k.color.dark, { y: 0.24, rx: Math.PI / 2, rz: Math.PI / 2 })] : []),
      ]));
      model.add(g);
      return g;
    });
    // A ramp behind the wall so it reads as a rampart from the player's side.
    model.add(piece(k, body, 'cn-wall-ramp', () => [part(new BoxGeometry(0.4, 0.05, 0.9), k.color.stone, { x: -0.55, y: 0.2, z: 0.3, rx: 0.45 })]));
    const tower = new Group();
    tower.position.set(0.48, 0.04, -0.3);
    tower.add(piece(k, body, 'cn-wall-tower', () => [
      part(new BoxGeometry(0.56, 0.6, 0.56), k.color.stone, { y: 0.3 }),
      ...[-1, 1].map((s) => part(new BoxGeometry(0.1, 0.14, 0.01), k.color.dark, { x: s * 0.12, y: 0.45, z: -0.285 })),
      part(new BoxGeometry(0.44, 0.22, 0.44), k.color.secondary, { y: 0.71 }),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(new CylinderGeometry(0.016, 0.016, 0.22, 5), k.color.primary, { x: sx * 0.21, y: 0.71, z: sz * 0.21 }))),
    ]));
    model.add(tower);
    const roof = piece(k, body, 'cn-wall-roof', () => [part(new ConeGeometry(0.46, 0.2, 4, 1, true), 'dark', { y: 0.1, ry: Math.PI / 4 }), part(new SphereGeometry(0.03, 6, 4), k.color.accent, { y: 0.22 })]);
    roof.position.set(0.48, 0.86, -0.3);
    model.add(roof);
    const anchor = new Group();
    anchor.position.set(-0.75, 0.75, -0.3);
    const pole = piece(k, body, 'cn-wall-pole', () => [part(new CylinderGeometry(0.009, 0.011, 0.36, 6), k.color.wood, { y: 0.18 })]);
    pole.position.set(-0.75, 0.44, -0.3);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.035, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.4, -0.3)));
      anchor.visible = false;
      pole.visible = false;
      model.attach(roof);
      const roofOff = throwPart(ctx, roof, new Vector3(0.9, 0.04, 0.5), 0.5, 0.85, new Vector3(2, 3, 1), new Vector3(0.4, 1.6, Math.PI * 0.8));
      const slump = lerpTo(ctx, 0.7, (e) => {
        tower.scale.y = 1 - e * 0.55;
        tower.rotation.z = -e * 0.12;
      }, 0.15);
      const breach = sections.map((g, i) =>
        lerpTo(ctx, 0.6, (e) => {
          g.position.y = 0.04 - e * (0.08 + i * 0.04);
          g.rotation.x = (i % 2 ? -1 : 1) * e * 0.25;
          g.rotation.z = (i - 1) * e * 0.15;
        }, 0.1 + i * 0.12),
      );
      await Promise.all([roofOff, slump, ...breach]);
    };
    return model;
  };
}
