import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Vector3, type Mesh } from 'three';
import { part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import type { HelmetStyle, ShieldStyle, WeaponStyle } from '../types';
import { piece } from './common';
import { figureBody, headOn, moved, shield, weapon, type Parts } from './pieces';
import type { KitStyle } from './style';

export interface SquadOptions {
  helmet: HelmetStyle;
  shield: ShieldStyle;
  weapon: WeaponStyle;
  /** Front rank levels its spears (phalanx) instead of holding them up. */
  levelled?: boolean;
  /** Each rear soldier carries a tall team banner (nobori). */
  banners?: boolean;
  /** Shields overlap in a wall (vikings) rather than standing apart. */
  wall?: boolean;
  key: string;
}

function soldier(k: KitStyle, o: SquadOptions, front: boolean): Parts {
  const arms = weapon(k, o.weapon);
  // The front rank levels its spears over the shields; the rear holds them up.
  const held = front && o.levelled ? moved(moved(arms, { x: -0.17, y: 0.2, z: -0.1, rx: -1.1 }), { x: 0.17 }) : arms;
  const guard = o.shield === 'none' ? [] : moved(shield(k, o.shield), { x: o.wall ? 0.15 : 0.19, z: o.wall ? -0.12 : -0.1, sx: o.wall ? 1.25 : 1, sy: o.wall ? 1.15 : 1 });
  const parts: Parts = [...figureBody(k), ...headOn(k, o.helmet), ...guard, ...held];
  if (o.banners && !front) {
    parts.push(part(new CylinderGeometry(0.009, 0.009, 1.0, 5), k.color.woodDark, { x: -0.1, y: 0.6, z: 0.12 }));
    parts.push(part(new BoxGeometry(0.005, 0.42, 0.14), 'main', { x: -0.1, y: 0.86, z: 0.2 }));
  }
  return moved(parts, { sx: 0.55, sy: 0.55, sz: 0.55 });
}

/**
 * Eight soldiers in two ranks across the two cells. They shift their weight
 * in step; when broken they go down like dominoes and the standard falls.
 */
export function kitSquad(k: KitStyle, o: SquadOptions): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('armor', body);
    model.add(piece(k, body, `squad-ground-${o.key}`, () => [part(new BoxGeometry(1.7, 0.03, 0.62), k.color.stoneDark, { y: 0.015 })]));
    const men: Mesh[] = [];
    for (const z of [-0.15, 0.17]) {
      for (const x of [-0.62, -0.21, 0.2, 0.61]) {
        const front = z < 0;
        const m = piece(k, body, `squad-${o.key}-${front ? 'front' : 'rear'}`, () => soldier(k, o, front));
        m.position.set(x, 0.03, z);
        model.add(m);
        men.push(m);
      }
    }
    const standard = new Group();
    standard.position.set(0.82, 0.03, 0.25);
    standard.add(piece(k, body, 'squad-standard', () => [part(new CylinderGeometry(0.008, 0.01, 0.75, 6), k.color.wood, { y: 0.375 }), part(new ConeGeometry(0.02, 0.06, 6), k.color.accent, { y: 0.78 })]));
    model.add(standard);
    const anchor = new Group();
    anchor.position.set(0.82, 0.74, 0.25);
    model.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      men.forEach((m, i) => {
        const step = Math.sin(time * 2.2 + phase + (i % 4) * 0.15);
        m.position.y = 0.03 + Math.max(0, step) * 0.012;
        m.rotation.z = step * 0.025;
      });
    };

    model.wreck = async (ctx) => {
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      anchor.visible = false;
      const falls = men.map((m, i) => topple(ctx, m, 'x', 1.35 + ctx.random() * 0.15, 0.7, (i % 4) * 0.09 + (i < 4 ? 0.05 : 0)));
      const flag = throwPart(ctx, standard, new Vector3(0.95, 0.03, 0.55), 0.2, 0.7, new Vector3(0, 0, 0), new Vector3(Math.PI / 2 - 0.1, 0.3, 0));
      await Promise.all([...falls, flag]);
    };
    return model;
  };
}
