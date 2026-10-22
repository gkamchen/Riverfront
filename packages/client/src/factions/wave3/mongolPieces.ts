import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry, TorusGeometry, Vector3, type Mesh } from 'three';
import { part } from '../../units/parts';
import { Puffs, UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { piece } from '../kit/common';
import { figure, moved, ornamentBand, wheel, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

interface Ger {
  cover: Group;
  lattice: Mesh;
  crown: Mesh;
}

/** Felt cover of a ger: drum wall and roof, with team bands. */
function gerCover(k: KitStyle, r: number): Parts {
  return [
    part(new CylinderGeometry(r, r, 0.26, 16, 1, true), k.color.cloth, { y: 0.13 }),
    part(new CylinderGeometry(r + 0.004, r + 0.004, 0.035, 16, 1, true), 'main', { y: 0.2 }),
    part(new CylinderGeometry(r + 0.004, r + 0.004, 0.02, 16, 1, true), 'main', { y: 0.06 }),
    part(new ConeGeometry(r + 0.04, 0.2, 16, 1, true), k.color.cloth, { y: 0.36 }),
    ...moved(ornamentBand(k, 'knot', r * 1.2, k.color.accent), { y: 0.2, z: -r - 0.006 }),
  ];
}

/** Lattice wall and roof poles left standing when the felt goes. */
function gerFrame(k: KitStyle, r: number): Parts {
  const parts: Parts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    parts.push(part(new BoxGeometry(0.012, 0.26, 0.012), k.color.wood, { x: Math.cos(a) * r * 0.97, y: 0.13, z: Math.sin(a) * r * 0.97, rz: 0.4, ry: -a }));
    parts.push(part(new BoxGeometry(0.01, 0.01, r), k.color.woodDark, { x: Math.cos(a) * r * 0.5, y: 0.37, z: Math.sin(a) * r * 0.5, ry: -a + Math.PI / 2, rx: 0.42 }));
  }
  parts.push(part(new BoxGeometry(0.12, 0.18, 0.03), k.color.accent, { y: 0.09, z: -r }));
  return parts;
}

/**
 * Acampamento de Gers: three felt tents around a hearth, a cart and a tethered
 * standard. When struck the felt covers are blown off, the lattice walls fold
 * and the roof rings drop.
 */
export function mongolGerCamp(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'mn-camp-ground', () => [
      part(new CylinderGeometry(0.86, 0.88, 0.04, 20), k.color.stoneDark, { y: 0.02 }),
      part(new CylinderGeometry(0.1, 0.12, 0.05, 10), k.color.stone, { y: 0.05 }),
    ]));
    const gers: Ger[] = [];
    for (const [x, z, r] of [[-0.42, -0.3, 0.36], [0.4, -0.32, 0.32], [0.0, 0.42, 0.34]] as const) {
      const lattice = piece(k, body, `mn-ger-frame-${r}`, () => gerFrame(k, r));
      lattice.position.set(x, 0.04, z);
      model.add(lattice);
      const cover = new Group();
      cover.position.set(x, 0.04, z);
      cover.add(piece(k, body, `mn-ger-cover-${r}`, () => gerCover(k, r)));
      model.add(cover);
      const crown = piece(k, body, 'mn-ger-crown', () => [part(new TorusGeometry(0.055, 0.014, 5, 12), k.color.woodDark, { rx: Math.PI / 2 }), part(new BoxGeometry(0.1, 0.01, 0.01), k.color.woodDark), part(new BoxGeometry(0.01, 0.01, 0.1), k.color.woodDark)]);
      crown.position.set(x, 0.04 + 0.46, z);
      model.add(crown);
      gers.push({ cover, lattice, crown });
    }
    const cart = new Group();
    cart.position.set(0.55, 0.04, 0.42);
    cart.add(piece(k, body, 'mn-cart', () => [part(new BoxGeometry(0.34, 0.1, 0.22), k.color.wood, { y: 0.17 }), part(new BoxGeometry(0.36, 0.02, 0.24), 'dark', { y: 0.23 }), part(new BoxGeometry(0.4, 0.02, 0.02), k.color.woodDark, { x: -0.3, y: 0.12, rz: 0.2 })]));
    for (const s of [-1, 1]) {
      const w = piece(k, body, 'mn-cart-wheel', () => wheel(k, 0.1, 6));
      w.position.set(0, 0.1, s * 0.13);
      cart.add(w);
    }
    model.add(cart);
    const smoke = new Puffs(new Vector3(0.0, 0.04 + 0.5, 0.42), 5, 1, 0.05);
    model.add(smoke.group);
    const anchor = new Group();
    anchor.position.set(-0.75, 0.95, 0.5);
    const pole = piece(k, body, 'mn-camp-pole', () => [part(new CylinderGeometry(0.01, 0.012, 0.9, 6), k.color.wood, { y: 0.45 }), part(new ConeGeometry(0.03, 0.08, 6), k.color.accent, { y: 0.94 })]);
    pole.position.set(-0.75, 0.04, 0.5);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    model.idle = (_time, dt) => smoke.update(dt);

    model.wreck = async (ctx) => {
      smoke.enabled = false;
      smoke.group.visible = false;
      anchor.visible = false;
      await shudder(ctx, model, 0.03, 0.18);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      const jobs: Promise<void>[] = [];
      gers.forEach((g, i) => {
        // The felt is blown up and off; the lattice folds; the crown ring drops.
        const away = new Vector3(g.cover.position.x * 1.8 + (i - 1) * 0.3, 0.02, g.cover.position.z * 1.8);
        jobs.push(ctx.tweens.wait(i * 0.12).then(() => throwPart(ctx, g.cover, away, 0.55, 0.85, new Vector3(1.5, 2, 1), new Vector3(Math.PI / 2 - 0.3, i, 0.4))));
        jobs.push(lerpTo(ctx, 0.6, (e) => {
          g.lattice.scale.set(1 + e * 0.15, 1 - e * 0.75, 1 + e * 0.15);
          g.crown.position.y = 0.5 - e * 0.36;
          g.crown.rotation.x = e * 0.6;
        }, 0.25 + i * 0.1));
      });
      jobs.push(topple(ctx, cart, 'x', 1.2, 0.8, 0.2));
      jobs.push(topple(ctx, pole, 'z', 1.3, 0.9, 0.1));
      await Promise.all(jobs);
    };
    return model;
  };
}

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/**
 * Estandarte de Crina: a tall spirit banner of horsehair tassels on a trident
 * head, a scout's small ger and a watch fire. When struck the standard falls
 * across the board and the tassels scatter.
 */
export function mongolStandard(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const tent = piece(k, body, 'mn-scout-ger', () => [...gerCover(k, 0.26), ...gerFrame(k, 0.26)]);
    tent.position.copy(ANT_A);
    model.add(tent);
    const fire = piece(k, body, 'mn-fire', () => [
      ...[0, 1, 2, 3, 4].map((i) => part(new SphereGeometry(0.05, 6, 4), k.color.stone, { x: Math.cos(i * 1.26) * 0.12, y: 0.03, z: Math.sin(i * 1.26) * 0.12 })),
      part(new SphereGeometry(0.06, 8, 6), 'glow', { y: 0.05, sy: 0.6 }),
      ...moved(figure(k, 0.5, 'archer', k.params.helmet, null), { x: 0.2, z: 0.12, ry: -2.2 }),
    ]);
    fire.position.copy(ANT_C);
    model.add(fire);
    const standard = new Group();
    standard.position.copy(ANT_B);
    standard.add(piece(k, body, 'mn-standard', () => {
      const parts: Parts = [
        part(new CylinderGeometry(0.2, 0.24, 0.08, 12), k.color.stone, { y: 0.04 }),
        part(new CylinderGeometry(0.018, 0.022, 1.4, 8), k.color.wood, { y: 0.74 }),
        // The trident head and the ring of tassels below it.
        part(new ConeGeometry(0.03, 0.14, 6), k.color.metal, { y: 1.52 }),
        part(new ConeGeometry(0.018, 0.09, 5), k.color.metal, { x: -0.06, y: 1.48, rz: 0.4 }),
        part(new ConeGeometry(0.018, 0.09, 5), k.color.metal, { x: 0.06, y: 1.48, rz: -0.4 }),
        part(new TorusGeometry(0.07, 0.012, 5, 14), k.color.accent, { y: 1.4, rx: Math.PI / 2 }),
      ];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        parts.push(part(new CylinderGeometry(0.02, 0.006, 0.34, 5), i % 3 === 0 ? 'main' : k.color.dark, { x: Math.cos(a) * 0.07, y: 1.22, z: Math.sin(a) * 0.07 }));
      }
      return parts;
    }));
    model.add(standard);
    const anchor = new Group();
    anchor.position.set(0.02, 1.15, 0);
    standard.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      standard.rotation.z = Math.sin(time * 0.8 + phase) * 0.02;
      standard.rotation.x = Math.sin(time * 0.6 + phase) * 0.015;
      body.userData.unit.lights.value = 0.7 + 0.3 * Math.abs(Math.sin(time * 7 + phase));
    };

    model.wreck = async (ctx) => {
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, 1.4, ANT_B.z)));
      anchor.visible = false;
      const fall = topple(ctx, standard, 'z', -1.45, 1.0, 0.1);
      const tentDown = lerpTo(ctx, 0.6, (e) => (tent.scale.y = 1 - e * 0.6), 0.2);
      ctx.emit('smoke', model.worldOf(new Vector3(ANT_C.x, 0.2, ANT_C.z)));
      await Promise.all([fall, tentDown]);
    };
    return model;
  };
}
