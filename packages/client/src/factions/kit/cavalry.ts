import { BoxGeometry, Color, Group, TorusGeometry, Vector3 } from 'three';
import { part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { throwPart } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import type { HelmetStyle } from '../types';
import { bolt, piece } from './common';
import { figure, horse, moved, type Parts } from './pieces';
import type { KitStyle } from './style';

export interface CavalryOptions {
  helmet: HelmetStyle;
  /** Lancers or horse archers. */
  arms: 'spear' | 'bow';
  /** Coat colours of the two horses. */
  coats?: readonly [string, string];
  key: string;
}

const MANE = new Color('#2a1c14');

function rider(k: KitStyle, o: CavalryOptions): Parts {
  if (o.arms === 'spear') return moved(figure(k, 0.5, 'officer', o.helmet, 'spear'), { y: 0.02 });
  const bow = new TorusGeometry(0.2, 0.012, 4, 12, Math.PI * 0.75);
  bow.rotateZ(-Math.PI * 0.375);
  bow.rotateY(Math.PI / 2);
  return [...moved(figure(k, 0.5, 'archer', o.helmet, null), { y: 0.02 }), part(bow, k.color.woodDark, { x: -0.06, y: 0.22, z: -0.08, sx: 0.5, sy: 0.5, sz: 0.5 })];
}

/**
 * Two horsemen in file, with team saddle cloths: lancers or horse archers.
 * When hit the riders are thrown and the horses run off the board.
 */
export function kitCavalry(k: KitStyle, o: CavalryOptions): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('armor', body);
    const coats = o.coats ?? ['#6e4a30', '#d8c8a8'];
    const horses: Group[] = [];
    const heads: Group[] = [];
    const riders: Group[] = [];
    [[-0.38, 0.1], [0.42, -0.1]].forEach(([x, z], i) => {
      const h = horse(new Color(coats[i]!), MANE);
      const g = new Group();
      g.position.set(x!, 0, z!);
      g.scale.setScalar(1.15);
      g.add(piece(k, body, `cav-horse-${o.key}-${i}`, () => [...h.body, part(new BoxGeometry(0.22, 0.02, 0.2), k.tint.cloth, { y: 0.44 }), part(new BoxGeometry(0.24, 0.012, 0.21), k.color.accent, { y: 0.432 })]));
      const head = new Group();
      head.position.set(...h.headPivot);
      head.add(piece(k, body, `cav-horse-head-${o.key}-${i}`, () => h.head));
      g.add(head);
      const r = new Group();
      r.position.set(0.02, 0.38, 0);
      r.add(piece(k, body, `cav-rider-${o.key}`, () => rider(k, o)));
      g.add(r);
      model.add(g);
      horses.push(g);
      heads.push(head);
      riders.push(r);
    });
    const anchor = new Group();
    anchor.position.set(0.1, 0.42, 0.05);
    riders[1]!.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      horses.forEach((g, i) => {
        g.position.y = Math.abs(Math.sin(time * 1.6 + phase + i)) * 0.012;
        heads[i]!.rotation.z = Math.sin(time * 2.3 + phase + i * 1.4) * 0.14;
        riders[i]!.rotation.y = Math.sin(time * 0.5 + phase + i) * (o.arms === 'bow' ? 0.6 : 0.25);
      });
    };

    model.wreck = async (ctx) => {
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      anchor.visible = false;
      const jobs: Promise<void>[] = [];
      riders.forEach((r, i) => {
        model.attach(r);
        jobs.push(throwPart(ctx, r, new Vector3(r.position.x + 0.2, 0.02, (i ? -1 : 1) * 0.35), 0.3, 0.7, new Vector3(0, 0, 0), new Vector3((i ? -1 : 1) * 1.3, 0.4, 0.2)));
      });
      horses.forEach((g, i) => jobs.push(bolt(ctx, g, new Vector3(-1.6 - i * 0.3, 0, (i ? -1 : 1) * 0.9), 1.4)));
      await Promise.all(jobs);
    };
    return model;
  };
}
