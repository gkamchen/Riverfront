import { BoxGeometry, CylinderGeometry, Group, Vector3 } from 'three';
import { part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { flicker, piece } from '../kit/common';
import { kitSquad } from '../kit/squad';
import { flame, moved, roof, shield, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/**
 * Torre de Vigia: a timber watchtower on a stone footing in a marching camp,
 * with leather tents on one cell and a rack of javelins and shields on the
 * other. A signal fire burns on the platform.
 */
export function romanWatchtower(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const tents = piece(k, body, 'ro-tents', () => {
      const parts: Parts = [];
      for (const s of [-1, 1]) {
        parts.push(...moved(roof(k, 'gable', 0.22, 0.3, k.color.cloth), { x: s * 0.13, sy: 1.1 }));
        parts.push(part(new BoxGeometry(0.02, 0.1, 0.01), k.color.dark, { x: s * 0.13 - 0.11, y: 0.05 }));
      }
      parts.push(part(new BoxGeometry(0.56, 0.02, 0.4), k.color.stoneDark, { y: 0.01 }));
      return parts;
    });
    tents.position.copy(ANT_A);
    model.add(tents);
    const rack = piece(k, body, 'ro-rack', () => [
      part(new BoxGeometry(0.34, 0.03, 0.04), k.color.wood, { y: 0.32, z: 0.1 }),
      part(new BoxGeometry(0.03, 0.34, 0.03), k.color.wood, { x: -0.16, y: 0.17, z: 0.1 }),
      part(new BoxGeometry(0.03, 0.34, 0.03), k.color.wood, { x: 0.16, y: 0.17, z: 0.1 }),
      ...[-0.1, -0.03, 0.04, 0.11].map((x) => part(new CylinderGeometry(0.006, 0.006, 0.5, 4), k.color.wood, { x, y: 0.25, z: 0.12, rx: -0.1 })),
      ...moved(shield(k, 'scutum'), { x: 0.19, y: -0.12, z: -0.06, sx: 0.7, sy: 0.7, sz: 0.7 }),
      ...moved(shield(k, 'scutum'), { x: 0.27, y: -0.12, z: -0.02, sx: 0.7, sy: 0.7, sz: 0.7, ry: 0.4 }),
      part(new BoxGeometry(0.14, 0.06, 0.12), k.color.stoneDark, { x: -0.18, y: 0.03, z: -0.18 }),
    ]);
    rack.position.copy(ANT_C);
    model.add(rack);
    const campFire = flame(0.6);
    campFire.position.set(ANT_C.x - 0.18, 0.06 + campFire.position.y, ANT_C.z - 0.18);
    model.add(campFire);

    const tower = new Group();
    tower.position.copy(ANT_B);
    tower.add(piece(k, body, 'ro-tower-foot', () => [
      part(new BoxGeometry(0.5, 0.22, 0.5), k.color.stone, { y: 0.11 }),
      part(new BoxGeometry(0.54, 0.03, 0.54), k.tint.trim, { y: 0.23 }),
    ]));
    const upper = new Group();
    upper.position.y = 0.24;
    upper.add(piece(k, body, 'ro-tower-top', () => {
      const parts: Parts = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(new BoxGeometry(0.05, 0.86, 0.05), k.color.wood, { x: sx * 0.18, y: 0.43, z: sz * 0.18, rz: -sx * 0.04, rx: sz * 0.04 }));
      for (const y of [0.25, 0.55]) {
        for (const s of [-1, 1]) {
          parts.push(part(new BoxGeometry(0.4, 0.025, 0.025), k.color.woodDark, { y, z: s * 0.18, rz: s * 0.6 }));
          parts.push(part(new BoxGeometry(0.025, 0.025, 0.4), k.color.woodDark, { y, x: s * 0.18, rx: s * 0.6 }));
        }
      }
      parts.push(part(new BoxGeometry(0.5, 0.04, 0.5), k.color.woodDark, { y: 0.86 }));
      for (const s of [-1, 1]) {
        parts.push(part(new BoxGeometry(0.5, 0.12, 0.02), k.color.wood, { y: 0.94, z: s * 0.24 }));
        parts.push(part(new BoxGeometry(0.02, 0.12, 0.5), k.color.wood, { y: 0.94, x: s * 0.24 }));
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(new CylinderGeometry(0.012, 0.012, 0.28, 5), k.color.wood, { x: sx * 0.22, y: 1.02, z: sz * 0.22 }));
      parts.push(...moved(roof(k, 'gable', 0.52, 0.52), { y: 1.16 }));
      return parts;
    }));
    tower.add(upper);
    model.add(tower);
    const fires = [flame(0.7), flame(0.55)];
    fires.forEach((f, i) => {
      f.position.set(i * 0.05 - 0.02, 0.9 + f.position.y, 0);
      upper.add(f);
    });
    const anchor = new Group();
    anchor.position.set(0.24, 1.22, 0.24);
    upper.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    let alive = true;
    model.idle = (time) => {
      if (!alive) return;
      flicker(fires, time + phase, 1);
      flicker([campFire], time * 1.2 + phase, 1);
    };

    model.wreck = async (ctx) => {
      alive = false;
      for (const f of [...fires, campFire]) f.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, 1.2, ANT_B.z)));
      await shudder(ctx, upper, 0.03, 0.18);
      const fall = topple(ctx, upper, 'z', -1.35, 1.0);
      const pitch = lerpTo(ctx, 0.7, (e) => {
        tents.scale.y = 1 - e * 0.7;
        rack.rotation.x = e * 0.9;
      }, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(ANT_C.x, 0.1, ANT_C.z)));
      await Promise.all([fall, pitch]);
    };
    return model;
  };
}

/** Falange: eight hoplites in two ranks behind round shields, front spears levelled. */
export function greekPhalanx(k: KitStyle): UnitFactory {
  return kitSquad(k, { helmet: 'corinthian', shield: 'hoplon', weapon: 'spear', levelled: true, key: 'phalanx' });
}
