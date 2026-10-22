import { BoxGeometry, CylinderGeometry, Group, SphereGeometry, Vector3 } from 'three';
import { lathe, part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { kitCavalry } from '../kit/cavalry';
import { piece } from '../kit/common';
import { moved, ornamentBand, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

const COL_H = 0.78;

/** Slender fluted column with a paired-animal (double bull) capital, standing on y = 0. */
function persianColumn(k: KitStyle): Parts {
  return [
    part(lathe([[0, 0], [0.07, 0], [0.07, 0.03], [0.05, 0.06], [0, 0.06]], 10), k.color.stone),
    part(new CylinderGeometry(0.036, 0.042, COL_H - 0.16, 12), k.color.stone, { y: 0.06 + (COL_H - 0.16) / 2 }),
    part(new CylinderGeometry(0.05, 0.036, 0.05, 10), k.color.stone, { y: COL_H - 0.08 }),
    // Two crouching beasts back to back, abstracted to blocks and heads.
    part(new BoxGeometry(0.24, 0.06, 0.07), k.color.stone, { y: COL_H - 0.03 }),
    part(new SphereGeometry(0.035, 8, 6), k.color.stone, { x: -0.12, y: COL_H - 0.01 }),
    part(new SphereGeometry(0.035, 8, 6), k.color.stone, { x: 0.12, y: COL_H - 0.01 }),
  ];
}

/**
 * Portal de Persépolis: a terrace with double stairs, two massive gate piers
 * and a hall of slender columns with paired-beast capitals under cedar beams.
 * When struck the columns topple one after another and the beams drop.
 */
export function persiaGate(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'pe-terrace', () => {
      const parts: Parts = [
        part(new BoxGeometry(1.78, 0.1, 1.78), k.color.stoneDark, { y: 0.05 }),
        part(new BoxGeometry(1.6, 0.08, 1.5), k.color.stone, { y: 0.14 }),
        ...moved(ornamentBand(k, 'sun', 1.4, k.tint.trim), { y: 0.1, z: -0.9 }),
      ];
      // Twin flights of steps up the front.
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) parts.push(part(new BoxGeometry(0.28, 0.06, 0.1), k.color.stone, { x: s * 0.42, y: 0.03 + i * 0.06, z: -0.86 + i * 0.07 }));
      return parts;
    }));
    const piers = [-1, 1].map((s) => {
      const pier = new Group();
      pier.position.set(s * 0.34, 0.18, -0.55);
      pier.add(piece(k, body, 'pe-pier', () => [
        part(new BoxGeometry(0.22, 0.86, 0.32), k.color.stone, { y: 0.43 }),
        part(new BoxGeometry(0.24, 0.06, 0.34), k.color.accent, { y: 0.83 }),
        part(new BoxGeometry(0.012, 0.5, 0.22), 'main', { x: s > 0 ? -0.112 : 0.112, y: 0.42 }),
      ]));
      model.add(pier);
      return pier;
    });
    const lintel = piece(k, body, 'pe-lintel', () => [part(new BoxGeometry(0.92, 0.08, 0.34), k.color.stone, { y: 0.04 }), part(new CylinderGeometry(0.06, 0.06, 0.02, 14), 'glow', { y: 0.04, z: -0.172, rx: Math.PI / 2 })]);
    lintel.position.set(0, 1.04, -0.55);
    model.add(lintel);
    const columns: Group[] = [];
    for (const z of [-0.05, 0.4]) {
      for (const x of [-0.55, -0.18, 0.18, 0.55]) {
        const c = new Group();
        c.position.set(x, 0.18, z);
        c.add(piece(k, body, 'pe-column', () => persianColumn(k)));
        model.add(c);
        columns.push(c);
      }
    }
    const beams = piece(k, body, 'pe-beams', () => [
      ...[-0.05, 0.4].map((z) => part(new BoxGeometry(1.3, 0.05, 0.08), k.color.wood, { z })),
      ...[-0.55, -0.18, 0.18, 0.55].map((x) => part(new BoxGeometry(0.06, 0.04, 0.6), k.color.woodDark, { x, y: 0.045, z: 0.17 })),
      part(new BoxGeometry(1.34, 0.025, 0.62), 'dark', { y: 0.08, z: 0.17 }),
    ]);
    beams.position.y = 0.18 + COL_H + 0.02;
    model.add(beams);
    const anchor = new Group();
    anchor.position.set(0.34, 1.32, -0.55);
    const pole = piece(k, body, 'pe-pole', () => [part(new CylinderGeometry(0.009, 0.011, 0.3, 6), k.color.wood, { y: 0.15 })]);
    pole.position.set(0.34, 1.04, -0.55);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    model.idle = (time) => {
      body.userData.unit.lights.value = 0.8 + 0.2 * Math.sin(time * 1.3);
    };

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.03, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.6, 0)));
      anchor.visible = false;
      pole.visible = false;
      model.attach(lintel);
      const lintelDrop = throwPart(ctx, lintel, new Vector3(0.2, 0.22, -0.95), 0.15, 0.6, new Vector3(0, 0, 0), new Vector3(0.6, 0.3, 0.2));
      const falls = columns.map((c, i) => topple(ctx, c, i % 2 ? 'z' : 'x', (i % 3 ? 1 : -1) * (1.3 + ctx.random() * 0.25), 0.8, 0.1 + i * 0.06));
      const roofDrop = lerpTo(ctx, 0.6, (e) => {
        beams.position.y = 0.18 + COL_H + 0.02 - e * 0.62;
        beams.rotation.z = e * 0.15;
      }, 0.35);
      const crack = piers.map((p, i) => lerpTo(ctx, 0.5, (e) => {
        p.scale.y = 1 - e * 0.4;
        p.rotation.z = (i ? -1 : 1) * e * 0.12;
      }, 0.2));
      await Promise.all([lintelDrop, roofDrop, ...falls, ...crack]);
    };
    return model;
  };
}

/** Cavalaria: two lancers in file with team saddle cloths. */
export function persiaCavalry(k: KitStyle): UnitFactory {
  return kitCavalry(k, { helmet: 'wrapped', arms: 'spear', key: 'persia' });
}

/** Immortal details: a long robe and a golden pomegranate at the spear butt. */
export function immortalDress(k: KitStyle): Parts {
  return [
    part(lathe([[0.17, 0], [0.165, 0.12], [0.15, 0.24], [0, 0.24]], 14), k.color.cloth),
    part(new SphereGeometry(0.035, 8, 6), k.color.accent, { x: 0.17, y: 0.02, z: -0.04 }),
    part(new SphereGeometry(0.02, 6, 4), k.color.accent, { x: 0.17, y: 0.055, z: -0.04 }),
  ];
}
