import { BoxGeometry, ConeGeometry, CylinderGeometry, DodecahedronGeometry, ExtrudeGeometry, Group, Shape, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { part } from '../../units/parts';
import { Puffs, UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { piece } from '../kit/common';
import { figure, hull, moved, ornamentBand, shield, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

/**
 * Drakkar: a clinker longship with a carved dragon prow, a row of round
 * shields in team colours and a striped sail. When sunk the prow breaks off,
 * the mast goes over and the hull settles low in the water.
 */
export function vikingLongship(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('amphibian', body);
    const craft = new Group();
    craft.position.y = 0.08;
    model.add(craft);
    craft.add(piece(k, body, 'vk-hull', () => [
      ...hull(k, 'longship'),
      // Strakes along the hull.
      ...[-1, 1].map((s) => part(new BoxGeometry(1.3, 0.012, 0.01), k.color.woodDark, { y: 0.03, z: s * 0.185 })),
      part(new TorusGeometry(0.16, 0.03, 6, 12, Math.PI * 0.75), k.color.wood, { x: 0.66, y: 0.18, rz: -0.1 }),
    ]));
    const prow = new Group();
    prow.position.set(-0.68, 0.12, 0);
    prow.add(piece(k, body, 'vk-prow', () => [
      part(new TorusGeometry(0.13, 0.032, 6, 12, Math.PI * 0.6), k.color.wood, { x: 0.02, y: 0.04, rz: Math.PI * 0.4 }),
      part(new BoxGeometry(0.12, 0.06, 0.06), k.color.woodDark, { x: -0.1, y: 0.2 }),
      part(new BoxGeometry(0.08, 0.025, 0.05), k.color.woodDark, { x: -0.16, y: 0.17 }),
      part(new ConeGeometry(0.012, 0.06, 4), k.color.woodDark, { x: -0.06, y: 0.25, z: 0.02, rz: 0.6 }),
      part(new ConeGeometry(0.012, 0.06, 4), k.color.woodDark, { x: -0.06, y: 0.25, z: -0.02, rz: 0.6 }),
      part(new SphereGeometry(0.012, 6, 4), k.color.accent, { x: -0.12, y: 0.215, z: 0.032 }),
      part(new SphereGeometry(0.012, 6, 4), k.color.accent, { x: -0.12, y: 0.215, z: -0.032 }),
    ]));
    craft.add(prow);
    const mast = new Group();
    mast.position.set(0.02, 0.08, 0);
    mast.add(piece(k, body, 'vk-mast', () => {
      const parts: Parts = [
        part(new CylinderGeometry(0.014, 0.018, 0.85, 6), k.color.wood, { y: 0.42 }),
        part(new CylinderGeometry(0.008, 0.008, 0.66, 6), k.color.wood, { y: 0.76, rx: Math.PI / 2 }),
      ];
      // Vertical stripes: team colour alternating with undyed wool.
      for (let i = 0; i < 5; i++) parts.push(part(new BoxGeometry(0.008, 0.42, 0.12), i % 2 ? k.color.cloth : 'main', { x: 0.01, y: 0.54, z: -0.24 + i * 0.12 }));
      return parts;
    }));
    craft.add(mast);
    const oars: Group[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const oar = new Group();
        oar.position.set(-0.36 + i * 0.22, 0.1, side * 0.19);
        const blade = piece(k, body, 'vk-oar', () => [part(new BoxGeometry(0.012, 0.012, 0.34), k.color.woodDark, { z: 0.17 }), part(new BoxGeometry(0.05, 0.006, 0.07), k.color.wood, { z: 0.34 })]);
        blade.rotation.x = 0.55;
        blade.scale.z = side;
        oar.add(blade);
        craft.add(oar);
        oars.push(oar);
      }
    }
    const crew = piece(k, body, 'vk-crew', () => [...moved(figure(k, 0.45, 'officer', 'nasal', 'axe'), { x: 0.48 }), ...moved(figure(k, 0.42, 'soldier', 'nasal', null), { x: -0.38 })]);
    crew.position.y = 0.08;
    craft.add(crew);
    const anchor = new Group();
    anchor.position.set(0.02, 0.9, 0);
    mast.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      craft.position.y = 0.08 + Math.sin(time * 1.7 + phase) * 0.016;
      craft.rotation.x = Math.sin(time * 1.1 + phase) * 0.035;
      craft.rotation.z = Math.sin(time * 0.8 + phase) * 0.015;
      mast.rotation.x = Math.sin(time * 0.9 + phase) * 0.02;
      oars.forEach((oar, i) => {
        const side = i < oars.length / 2 ? 1 : -1;
        const stroke = time * 2.1 + phase;
        oar.rotation.y = Math.sin(stroke) * 0.35 * side;
        oar.rotation.x = Math.max(0, Math.cos(stroke)) * 0.2 * side;
      });
    };

    model.wreck = async (ctx) => {
      ctx.emit('splash', model.worldOf(new Vector3(0, 0.1, 0)));
      const side = ctx.random() < 0.5 ? -1 : 1;
      model.attach(prow);
      const head = throwPart(ctx, prow, new Vector3(-0.95, 0.02, side * 0.35), 0.35, 0.8, new Vector3(2, 1, 3), new Vector3(Math.PI / 2, 0.4, 0.3));
      const mastFall = topple(ctx, mast, 'x', side * 1.25, 1.0, 0.1);
      // It goes down by the stern and settles low, decks awash.
      const sink = lerpTo(ctx, 1.6, (e) => {
        craft.rotation.x = side * 0.35 * e;
        craft.rotation.z = -0.16 * e;
        craft.position.y = 0.08 - e * 0.22;
      });
      const oarsDrop = lerpTo(ctx, 0.8, (e) => oars.forEach((o) => (o.rotation.x = e * 0.7)));
      const crewDown = topple(ctx, crew, 'z', 1.2, 0.7, 0.1);
      await Promise.all([head, mastFall, sink, oarsDrop, crewDown]);
      ctx.emit('splash', model.worldOf(new Vector3(0.3, 0.05, 0)));
    };
    return model;
  };
}

const LH_LEN = 1.7;
const LH_DEPTH = 0.9;
const LH_WALL = 0.32;

/** One side of the turf roof, hinged at its eave so it can fold in. */
function roofHalf(k: KitStyle): Parts {
  const width = Math.hypot(LH_DEPTH / 2 + 0.08, 0.42);
  return [
    part(new BoxGeometry(LH_LEN + 0.12, 0.05, width), k.color.wood, { z: width / 2 }),
    part(new BoxGeometry(LH_LEN + 0.08, 0.05, width - 0.04), k.color.secondary, { y: 0.045, z: width / 2 }),
    part(new BoxGeometry(LH_LEN + 0.14, 0.02, 0.05), 'dark', { y: 0.01, z: 0.02 }),
  ];
}

/**
 * Casa Comprida: the jarl's longhouse with bowed timber walls, a turf roof,
 * carved crossed gables and shields hung on the walls. When destroyed the
 * roof folds in, the gables fly and the walls lean out.
 */
export function vikingLonghouse(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'vk-lh-floor', () => [part(new BoxGeometry(1.86, 0.05, 1.2), k.color.stoneDark, { y: 0.025 })]));
    const walls: Group[] = [];
    for (const s of [-1, 1]) {
      const wall = new Group();
      wall.position.set(0, 0.05, s * (LH_DEPTH / 2));
      wall.add(piece(k, body, 'vk-lh-wall', () => {
        const parts: Parts = [];
        // Slightly bowed, like a hull: five panels angled in plan.
        for (let i = 0; i < 5; i++) {
          const x = -LH_LEN / 2 + (i + 0.5) * (LH_LEN / 5);
          const bow = Math.sin((Math.PI * (i + 0.5)) / 5) * 0.05;
          parts.push(part(new BoxGeometry(LH_LEN / 5 + 0.01, LH_WALL, 0.05), i % 2 ? k.color.wood : k.color.woodDark, { x, y: LH_WALL / 2, z: bow }));
        }
        parts.push(...moved(ornamentBand(k, 'knot', LH_LEN * 0.8, k.color.accent), { y: LH_WALL - 0.05, z: 0.08 }));
        return parts;
      }));
      // Shields hung along the wall, facing out.
      const shields = piece(k, body, 'vk-lh-shields', () => [-0.5, 0, 0.5].flatMap((x) => moved(shield(k, 'round'), { x: x + 0.17, y: -0.12, z: 0.13, sx: 0.8, sy: 0.8, sz: 0.8, ry: Math.PI })));
      shields.scale.z = s;
      shields.position.z = s * 0.04;
      wall.add(shields);
      model.add(wall);
      walls.push(wall);
    }
    model.add(piece(k, body, 'vk-lh-ends', () => [-1, 1].flatMap((s) => [
      part(new BoxGeometry(0.05, LH_WALL, LH_DEPTH), k.color.woodDark, { x: s * (LH_LEN / 2), y: 0.05 + LH_WALL / 2 }),
      part(new BoxGeometry(0.02, 0.22, 0.18), k.color.dark, { x: s * (LH_LEN / 2 + 0.02), y: 0.16 }),
    ])));
    const gable = new Shape();
    gable.moveTo(-LH_DEPTH / 2, 0);
    gable.lineTo(LH_DEPTH / 2, 0);
    gable.lineTo(0, 0.4);
    gable.closePath();
    model.add(piece(k, body, 'vk-lh-gables', () => [-1, 1].map((s) => {
      const g = new ExtrudeGeometry(gable, { depth: 0.04, bevelEnabled: false });
      g.rotateY(Math.PI / 2);
      return part(g, k.color.wood, { x: s * (LH_LEN / 2) - 0.02, y: 0.05 + LH_WALL });
    })));
    const roofs = [-1, 1].map((s) => {
      const holder = new Group();
      holder.position.set(0, 0.05 + LH_WALL, s * (LH_DEPTH / 2 + 0.06));
      holder.rotation.y = s > 0 ? Math.PI : 0;
      const tilt = new Group();
      tilt.rotation.x = -Math.atan2(0.42, LH_DEPTH / 2 + 0.06);
      tilt.add(piece(k, body, 'vk-lh-roof', () => roofHalf(k)));
      holder.add(tilt);
      model.add(holder);
      return tilt;
    });
    const pitch = Math.atan2(0.42, LH_DEPTH / 2 + 0.06);
    const finials = [-1, 1].map((s) => {
      const f = piece(k, body, 'vk-lh-finial', () => [
        part(new BoxGeometry(0.03, 0.3, 0.04), k.color.woodDark, { y: 0.12, rx: 0.6 }),
        part(new BoxGeometry(0.03, 0.3, 0.04), k.color.woodDark, { y: 0.12, rx: -0.6 }),
        part(new SphereGeometry(0.03, 6, 4), k.color.accent, { y: 0.24, z: 0.08 }),
        part(new SphereGeometry(0.03, 6, 4), k.color.accent, { y: 0.24, z: -0.08 }),
      ]);
      f.position.set(s * (LH_LEN / 2 + 0.02), 0.05 + LH_WALL + 0.4, 0);
      model.add(f);
      return f;
    });
    const smoke = new Puffs(new Vector3(0.2, 0.05 + LH_WALL + 0.46, 0), 6, 1.2, 0.055);
    model.add(smoke.group);
    const anchor = new Group();
    anchor.position.set(-LH_LEN / 2 - 0.02, 1.05, 0);
    model.add(anchor);
    model.flagAnchor = anchor;

    model.idle = (_time, dt) => smoke.update(dt);

    model.wreck = async (ctx) => {
      smoke.enabled = false;
      smoke.group.visible = false;
      anchor.visible = false;
      await shudder(ctx, model, 0.035, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.4, 0)));
      const fold = roofs.map((r, i) => ctx.tweens.run(0.75, (t) => (r.rotation.x = -pitch + t * t * (pitch + 0.5)), { delay: i * 0.1 }));
      const lean = walls.map((w, i) => topple(ctx, w, 'x', (i ? 1 : -1) * 0.45, 0.8, 0.2));
      const flies = finials.map((f, i) => {
        model.attach(f);
        return throwPart(ctx, f, new Vector3((i ? 1 : -1) * 1.15, 0.05, (i ? -0.4 : 0.4)), 0.5, 0.85, new Vector3(2, 3, 1), new Vector3(Math.PI / 2, 1, 0));
      });
      await Promise.all([...fold, ...lean, ...flies]);
    };
    return model;
  };
}

/**
 * Pedra Rúnica: a raised runestone on a cairn, its carved serpent band glowing
 * in the team colour. When struck it cracks and the halves fall apart.
 */
export function vikingRunestone(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    model.add(piece(k, body, 'vk-cairn', () => {
      const parts: Parts = [part(new BoxGeometry(0.7, 0.04, 0.7), k.color.stoneDark, { y: 0.02 })];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        parts.push(part(new DodecahedronGeometry(0.09, 0), k.color.stone.clone().multiplyScalar(0.8 + (i % 3) * 0.1), { x: Math.cos(a) * 0.24, y: 0.06, z: Math.sin(a) * 0.24, sy: 0.7 }));
      }
      return parts;
    }));
    const halves = [-1, 1].map((s) => {
      const half = new Group();
      half.position.set(s * 0.06, 0.06, 0);
      half.add(piece(k, body, `vk-rune-${s}`, () => {
        const parts: Parts = [
          part(new BoxGeometry(0.12, 0.62, 0.1), k.color.stone, { y: 0.31 }),
          part(new SphereGeometry(0.12, 10, 6, s > 0 ? 0 : Math.PI, Math.PI, 0, Math.PI / 2), k.color.stone, { y: 0.62, sz: 0.42 }),
        ];
        // Serpent band (an arc per half) and a line of runes, glowing.
        parts.push(part(new TorusGeometry(0.1, 0.012, 4, 10, Math.PI), 'glow', { y: 0.42, z: -0.052, rz: s > 0 ? -Math.PI / 2 : Math.PI / 2 }));
        for (let r = 0; r < 4; r++) parts.push(part(new BoxGeometry(0.012, 0.035, 0.004), 'glow', { x: s * 0.03, y: 0.12 + r * 0.06, z: -0.052, rz: (r % 2 ? 0.4 : -0.4) * s }));
        return parts;
      }));
      model.add(half);
      return half;
    });
    const glow = piece(k, body, 'vk-rune-ember', () => [part(new SphereGeometry(0.04, 8, 6), 'glow', { y: 0.06, z: -0.2 })]);
    model.add(glow);

    const phase = Math.random() * 6;
    model.idle = (time) => {
      body.userData.unit.lights.value = 0.7 + 0.4 * Math.max(0, Math.sin(time * 1.4 + phase));
    };

    model.wreck = async (ctx) => {
      const top = () => model.worldOf(new Vector3(0, 0.6, 0));
      for (let i = 0; i < 3; i++) {
        ctx.emit('arc', top());
        body.userData.unit.lights.value = i % 2 ? 0.2 : 2.2;
        await ctx.tweens.wait(0.11);
      }
      body.userData.unit.lights.value = 0;
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      // The stone splits down the middle; each half falls its own way.
      const split = halves.map((h, i) => topple(ctx, h, 'z', (i ? -1 : 1) * 1.1, 0.8, i * 0.06));
      const slide = lerpTo(ctx, 0.5, (e) => halves.forEach((h, i) => (h.position.x = (i ? 1 : -1) * (0.06 + e * 0.1))));
      await Promise.all([...split, slide]);
    };
    return model;
  };
}

