import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry, TorusGeometry, Vector3, type Mesh } from 'three';
import { lathe, part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { piece } from '../kit/common';
import { figure, moved, ornamentBand, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

/** One half of the great bombard's barrel (they were cast in two and screwed together). */
function barrelHalf(k: KitStyle, front: boolean): Parts {
  const bronze = k.color.accent;
  const parts: Parts = [part(new CylinderGeometry(front ? 0.15 : 0.17, front ? 0.16 : 0.18, 0.62, 18), bronze, { rz: Math.PI / 2 })];
  for (const x of front ? [-0.26, 0.05, 0.28] : [-0.25, 0, 0.26]) parts.push(part(new TorusGeometry(front ? 0.165 : 0.185, 0.02, 6, 18), bronze.clone().multiplyScalar(0.8), { x, ry: Math.PI / 2 }));
  if (front) parts.push(part(new CylinderGeometry(0.11, 0.11, 0.02, 16), k.color.dark, { x: -0.315, rz: Math.PI / 2 }));
  else parts.push(part(new SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), bronze, { x: 0.31, rz: -Math.PI / 2 }));
  return parts;
}

/**
 * Canhão Gigante: a great bronze bombard in two cast halves on a timber cradle,
 * with stone shot stacked beside it and its gunner. When destroyed the halves
 * part, the front one rolls off the cradle and the timbers give way.
 */
export function ottomanGreatCannon(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('artillery', body);
    const cradle = new Group();
    cradle.add(piece(k, body, 'ot-cradle', () => {
      const parts: Parts = [];
      for (const z of [-0.18, 0.18]) parts.push(part(new BoxGeometry(1.5, 0.1, 0.1), k.color.wood, { y: 0.1, z }));
      for (const x of [-0.6, -0.2, 0.2, 0.6]) parts.push(part(new BoxGeometry(0.1, 0.16, 0.48), k.color.woodDark, { x, y: 0.12 }));
      // Stone shot and the powder kegs.
      for (const [x, z] of [[1.05, -0.2], [1.2, -0.12], [1.12, 0.02]] as const) parts.push(part(new SphereGeometry(0.09, 10, 8), k.color.stone, { x, y: 0.09, z }));
      parts.push(part(lathe([[0, 0], [0.07, 0], [0.08, 0.06], [0.07, 0.12], [0, 0.12]], 10), k.color.woodDark, { x: 1.1, z: 0.25 }));
      parts.push(...moved(ornamentBand(k, k.motifs.ornament, 1.2, k.tint.trim), { y: 0.1, z: -0.235 }));
      return parts;
    }));
    model.add(cradle);
    const back = piece(k, body, 'ot-barrel-back', () => barrelHalf(k, false));
    back.position.set(0.32, 0.36, 0);
    const front = piece(k, body, 'ot-barrel-front', () => barrelHalf(k, true));
    front.position.set(-0.3, 0.355, 0);
    const gun = new Group();
    gun.add(back, front);
    model.add(gun);
    const gunner = piece(k, body, 'ot-gunner', () => figure(k, 0.6, 'officer', k.params.helmet, null));
    gunner.position.set(0.95, 0, 0.32);
    model.add(gunner);
    const anchor = new Group();
    anchor.position.set(1.2, 0.55, 0.3);
    model.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      gun.rotation.z = -0.04 - Math.max(0, Math.sin(time * 0.3 + phase)) * 0.05;
      gunner.rotation.y = Math.sin(time * 0.5 + phase) * 0.4;
    };

    model.wreck = async (ctx) => {
      ctx.emit('smoke', model.worldOf(new Vector3(-0.6, 0.4, 0)));
      ctx.emit('sparks', model.worldOf(new Vector3(0, 0.45, 0)));
      anchor.visible = false;
      await shudder(ctx, gun, 0.03, 0.2);
      model.attach(front);
      const roll = throwPart(ctx, front, new Vector3(-0.75, 0.16, 0.55), 0.2, 0.9, new Vector3(0, 0, 0), new Vector3(1.6, 0.6, Math.PI / 2 - 0.2));
      const sag = lerpTo(ctx, 0.7, (e) => {
        back.position.y = 0.36 - e * 0.16;
        back.rotation.z = e * 0.2;
        cradle.scale.y = 1 - e * 0.45;
        cradle.rotation.x = e * 0.08;
      }, 0.1);
      const down = topple(ctx, gunner, 'z', -1.3, 0.7, 0.1);
      await Promise.all([roll, sag, down]);
    };
    return model;
  };
}

/**
 * Fortaleza de Rumeli: curtain walls between three great round towers under
 * lead cone roofs. When breached the roofs are thrown, the towers crumble and
 * the walls tilt.
 */
export function ottomanFortress(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'ot-fort-ground', () => [part(new BoxGeometry(1.8, 0.04, 1.8), k.color.stoneDark, { y: 0.02 })]));
    const walls: Group[] = [];
    for (const [x, z, ry, len] of [[0, -0.55, 0, 1.1], [-0.55, 0.12, Math.PI / 2, 1.0], [0.55, 0.12, Math.PI / 2, 1.0]] as const) {
      // The yaw lives on an outer group so the inner one can tip about its own long axis.
      const holder = new Group();
      holder.position.set(x, 0.04, z);
      holder.rotation.y = ry;
      const w = new Group();
      holder.add(w);
      w.add(piece(k, body, `ot-wall-${len}`, () => {
        const parts: Parts = [part(new BoxGeometry(len, 0.42, 0.14), k.color.stone, { y: 0.21 }), part(new BoxGeometry(len + 0.01, 0.03, 0.15), k.tint.trim, { y: 0.36 })];
        for (let i = 0; i < 6; i++) parts.push(part(new BoxGeometry(0.08, 0.07, 0.15), k.color.stone, { x: -len / 2 + 0.08 + i * ((len - 0.16) / 5), y: 0.455 }));
        return parts;
      }));
      model.add(holder);
      walls.push(w);
    }
    const towers: Mesh[] = [];
    const caps: Mesh[] = [];
    for (const [x, z, r, h] of [[-0.58, -0.58, 0.26, 0.75], [0.58, -0.58, 0.22, 0.65], [0.0, 0.6, 0.3, 0.85]] as const) {
      const t = piece(k, body, `ot-tower-${r}`, () => [
        part(new CylinderGeometry(r, r + 0.03, h, 16), k.color.stone, { y: h / 2 }),
        part(new CylinderGeometry(r + 0.012, r + 0.012, 0.04, 16), k.tint.trim, { y: h - 0.06 }),
        part(new BoxGeometry(0.05, 0.12, 0.01), k.color.dark, { y: h * 0.6, z: -r - 0.002 }),
      ]);
      t.position.set(x, 0.04, z);
      model.add(t);
      towers.push(t);
      const cap = piece(k, body, `ot-cap-${r}`, () => [part(new ConeGeometry(r + 0.05, r * 1.4, 16), k.color.metal, { y: r * 0.7 }), part(new SphereGeometry(0.025, 6, 4), k.color.accent, { y: r * 1.4 + 0.02 })]);
      cap.position.set(x, 0.04 + h, z);
      model.add(cap);
      caps.push(cap);
    }
    const anchor = new Group();
    anchor.position.set(0.02, 0.04 + 0.85 + 0.6, 0.6);
    model.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.035, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.4, 0)));
      anchor.visible = false;
      const jobs: Promise<void>[] = [];
      caps.forEach((cap, i) => {
        model.attach(cap);
        const out = new Vector3(cap.position.x * 1.6 + 0.2, 0.05, cap.position.z * 1.6);
        jobs.push(throwPart(ctx, cap, out, 0.5, 0.85, new Vector3(2, 1, 2), new Vector3(Math.PI * 0.6, i, 0.3)));
      });
      towers.forEach((t, i) => jobs.push(lerpTo(ctx, 0.7, (e) => {
        t.scale.set(1 + e * 0.08, 1 - e * 0.55, 1 + e * 0.08);
        t.rotation.z = (i % 2 ? 1 : -1) * e * 0.12;
      }, 0.15 + i * 0.1)));
      walls.forEach((w, i) => jobs.push(topple(ctx, w, 'x', (i === 0 ? -1 : 1) * 1.2, 0.85, 0.2 + i * 0.08)));
      await Promise.all(jobs);
    };
    return model;
  };
}

/** Janissary details: a long coat with the skirt split at the front. */
export function janissaryCoat(k: KitStyle): Parts {
  return [
    part(lathe([[0.175, 0], [0.17, 0.14], [0.155, 0.26], [0, 0.26]], 14), 'dark'),
    part(new BoxGeometry(0.03, 0.24, 0.01), k.color.accent, { y: 0.13, z: -0.172 }),
  ];
}
