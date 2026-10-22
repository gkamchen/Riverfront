import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Group, SphereGeometry, TorusGeometry, Vector3, type Mesh } from 'three';
import { part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { bolt, flicker, piece } from '../kit/common';
import { elephant, figure, flame, glowMesh, moved, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

// ------------------------------------------------------------------ Incas

/** A many-sided fitted stone, cut to sit tight against its neighbours. */
function fittedStone(k: KitStyle, variant: number): Parts {
  const g = new DodecahedronGeometry(0.15, 0);
  return [part(g, k.color.stone.clone().multiplyScalar(0.85 + (variant % 3) * 0.08), { sx: 1.25 + (variant % 2) * 0.2, sy: 0.85, sz: 0.7, ry: variant * 0.7 })];
}

/**
 * Muralha de Pedra Encaixada: a zigzag rampart of great fitted stones with a
 * trapezoid gateway and a small watch house. When breached the stones tumble
 * out one by one, from the top courses down.
 */
export function incaFittedWall(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'in-ground', () => [part(new BoxGeometry(1.8, 0.04, 1.8), k.color.stoneDark, { y: 0.02 })]));
    const stones: Mesh[] = [];
    // Zigzag in plan: the wall turns every 0.45.
    const path = [[-0.85, -0.45], [-0.4, -0.7], [0.05, -0.45], [0.5, -0.7], [0.85, -0.45]] as const;
    let v = 0;
    for (let row = 0; row < 3; row++) {
      for (let seg = 0; seg < path.length - 1; seg++) {
        const [x0, z0] = path[seg]!;
        const [x1, z1] = path[seg + 1]!;
        for (let j = 0; j < 2; j++) {
          const t = (j + 0.5 + (row % 2) * 0.25) / 2.25;
          const s = piece(k, body, `in-stone-${v % 4}`, () => fittedStone(k, v % 4));
          s.position.set(x0 + (x1 - x0) * t, 0.13 + row * 0.2, z0 + (z1 - z0) * t);
          s.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
          s.scale.setScalar(1 - row * 0.08);
          model.add(s);
          stones.push(s);
          v++;
        }
      }
    }
    const gate = piece(k, body, 'in-gate', () => [
      part(new CylinderGeometry(0.22, 0.3, 0.5, 4), k.color.stone, { y: 0.25, ry: Math.PI / 4, sz: 0.5 }),
      part(new CylinderGeometry(0.08, 0.12, 0.34, 4), k.color.dark, { y: 0.17, z: -0.12, ry: Math.PI / 4, sz: 0.3 }),
      part(new BoxGeometry(0.4, 0.04, 0.2), k.tint.trim, { y: 0.48 }),
    ]);
    gate.position.set(0, 0.04, 0.2);
    model.add(gate);
    const house = piece(k, body, 'in-house', () => [
      part(new BoxGeometry(0.5, 0.3, 0.4), k.color.stone, { y: 0.15 }),
      part(new BoxGeometry(0.1, 0.18, 0.01), k.color.dark, { y: 0.1, z: -0.205 }),
      part(new ConeGeometry(0.42, 0.34, 4), k.color.secondary, { y: 0.47, ry: Math.PI / 4 }),
    ]);
    house.position.set(0.45, 0.04, 0.55);
    model.add(house);
    const anchor = new Group();
    anchor.position.set(-0.6, 0.95, 0.5);
    const pole = piece(k, body, 'in-pole', () => [part(new CylinderGeometry(0.01, 0.012, 0.9, 6), k.color.wood, { y: 0.45 })]);
    pole.position.set(-0.6, 0.04, 0.5);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.03, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, -0.5)));
      anchor.visible = false;
      const jobs: Promise<void>[] = [];
      // Top courses first: each stone tips out and rolls a little way.
      [...stones].reverse().forEach((s, i) => {
        if (i % 2) return;
        const out = new Vector3(s.position.x + (ctx.random() - 0.5) * 0.3, 0.1, s.position.z - 0.25 - ctx.random() * 0.25);
        jobs.push(ctx.tweens.wait(i * 0.035).then(() => throwPart(ctx, s, out, 0.12, 0.45, new Vector3(1, 0.5, 0.5), new Vector3(ctx.random() * 2, s.rotation.y, ctx.random() * 2))));
      });
      jobs.push(lerpTo(ctx, 0.6, (e) => (gate.scale.y = 1 - e * 0.4), 0.3));
      jobs.push(lerpTo(ctx, 0.6, (e) => (house.scale.y = 1 - e * 0.5), 0.35));
      jobs.push(topple(ctx, pole, 'z', 1.3, 0.8, 0.1));
      await Promise.all(jobs);
    };
    return model;
  };
}

// ------------------------------------------------------------------ Celts

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/**
 * Círculo de Pedras: a ring of standing stones around a glowing hearth, a
 * robed druid with a staff at its centre. When struck the light gutters, the
 * druid walks away and the stones fall outwards.
 */
export function celtStoneCircle(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    model.add(piece(k, body, 'ce-circle-ground', () => [part(new CylinderGeometry(0.38, 0.4, 0.04, 18), k.color.secondary, { y: 0.02 }), part(new CylinderGeometry(0.06, 0.07, 0.04, 10), 'glow', { y: 0.05, z: 0.08 })]));
    const stones: Group[] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const g = new Group();
      g.position.set(Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3);
      g.rotation.y = -a;
      g.add(piece(k, body, `ce-stone-${i % 3}`, () => [part(new BoxGeometry(0.07, 0.3 + (i % 3) * 0.06, 0.1), k.color.stone.clone().multiplyScalar(0.85 + (i % 3) * 0.08), { y: 0.15 + (i % 3) * 0.03 })]));
      model.add(g);
      stones.push(g);
    }
    const druid = new Group();
    druid.position.set(0, 0.04, -0.04);
    druid.add(piece(k, body, 'ce-druid', () => [
      ...moved(figure(k, 0.46, 'archer', 'none', null), {}),
      part(new SphereGeometry(0.05, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), new Color('#e8e2d4'), { y: 0.3, sy: 1.2 }),
      part(new CylinderGeometry(0.008, 0.008, 0.42, 5), k.color.woodDark, { x: 0.09, y: 0.21, z: -0.03 }),
      part(new SphereGeometry(0.018, 6, 4), 'glow', { x: 0.09, y: 0.43, z: -0.03 }),
    ]));
    model.add(druid);
    const flames = [flame(0.4), flame(0.3)];
    flames.forEach((f, i) => {
      f.position.set(i * 0.03, 0.06 + f.position.y, 0.09);
      model.add(f);
    });

    const phase = Math.random() * 6;
    model.idle = (time) => {
      body.userData.unit.lights.value = 0.75 + 0.3 * Math.max(0, Math.sin(time * 1.3 + phase));
      druid.rotation.y = Math.sin(time * 0.4 + phase) * 0.8;
      flicker(flames, time + phase, 1);
    };

    model.wreck = async (ctx) => {
      for (let i = 0; i < 3; i++) {
        ctx.emit('arc', model.worldOf(new Vector3(0, 0.25, 0)));
        body.userData.unit.lights.value = i % 2 ? 0.2 : 2.2;
        await ctx.tweens.wait(0.1);
      }
      body.userData.unit.lights.value = 0;
      for (const f of flames) f.visible = false;
      const leave = bolt(ctx, druid, new Vector3(0.9, 0, 0.6), 1.2);
      const fall = stones.map((s, i) => topple(ctx, s, 'z', -1.3 - ctx.random() * 0.2, 0.7, 0.1 + i * 0.06));
      await Promise.all([leave, ...fall]);
    };
    return model;
  };
}

/**
 * Torre Redonda: a tall round stone tower with a conical cap and a high door,
 * a thatched roundhouse and a beacon fire. When struck the cap is thrown and
 * the upper drum topples.
 */
export function celtRoundTower(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const hut = piece(k, body, 'ce-roundhouse', () => [
      part(new CylinderGeometry(0.24, 0.24, 0.18, 14), k.color.secondary, { y: 0.09 }),
      part(new ConeGeometry(0.31, 0.32, 14), k.color.wood, { y: 0.34 }),
      part(new BoxGeometry(0.08, 0.13, 0.01), k.color.dark, { y: 0.07, z: -0.24 }),
    ]);
    hut.position.copy(ANT_A);
    model.add(hut);
    const beacon = piece(k, body, 'ce-beacon', () => [...[0, 1, 2, 3, 4].map((i) => part(new BoxGeometry(0.2, 0.03, 0.03), k.color.woodDark, { y: 0.02 + i * 0.03, ry: i * 1.1 })), part(new SphereGeometry(0.05, 8, 6), 'glow', { y: 0.15 })]);
    beacon.position.copy(ANT_C);
    model.add(beacon);
    const fires = [flame(0.6), flame(0.45)];
    fires.forEach((f, i) => {
      f.position.set(ANT_C.x + i * 0.04, 0.16 + f.position.y, ANT_C.z);
      model.add(f);
    });
    const lower = piece(k, body, 'ce-tower-low', () => [part(new CylinderGeometry(0.16, 0.19, 0.7, 14), k.color.stone, { y: 0.35 }), part(new BoxGeometry(0.06, 0.12, 0.01), k.color.dark, { y: 0.5, z: -0.17 })]);
    lower.position.copy(ANT_B);
    model.add(lower);
    const upper = new Group();
    upper.position.set(ANT_B.x, 0.7, ANT_B.z);
    upper.add(piece(k, body, 'ce-tower-up', () => [
      part(new CylinderGeometry(0.14, 0.16, 0.55, 14), k.color.stone, { y: 0.275 }),
      ...[0, 1, 2, 3].map((i) => part(new BoxGeometry(0.04, 0.08, 0.01), k.color.dark, { x: Math.sin(i * Math.PI / 2) * 0.142, y: 0.48, z: -Math.cos(i * Math.PI / 2) * 0.142, ry: i * Math.PI / 2 })),
      part(new CylinderGeometry(0.15, 0.15, 0.03, 14), k.tint.trim, { y: 0.3 }),
    ]));
    model.add(upper);
    const cap = piece(k, body, 'ce-tower-cap', () => [part(new ConeGeometry(0.16, 0.3, 14), k.color.stoneDark, { y: 0.15 })]);
    cap.position.y = 0.55;
    upper.add(cap);
    const anchor = new Group();
    anchor.position.set(0, 0.85, 0);
    upper.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    let alive = true;
    model.idle = (time) => {
      if (alive) flicker(fires, time + phase, 1);
    };

    model.wreck = async (ctx) => {
      alive = false;
      for (const f of fires) f.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, 1.2, ANT_B.z)));
      anchor.visible = false;
      model.attach(cap);
      const capOff = throwPart(ctx, cap, new Vector3(ANT_C.x + 0.3, 0.05, ANT_C.z - 0.4), 0.5, 0.85, new Vector3(2, 1, 3), new Vector3(Math.PI / 2, 0.4, 0.3));
      const fall = topple(ctx, upper, 'z', -1.35, 1.0, 0.15);
      const hutDown = lerpTo(ctx, 0.6, (e) => (hut.scale.y = 1 - e * 0.4), 0.4);
      await Promise.all([capOff, fall, hutDown]);
    };
    return model;
  };
}

/** A gold torque at the neck and a chequered cloak over one shoulder. */
export function celtTorque(k: KitStyle): Parts {
  return [
    part(new TorusGeometry(0.06, 0.012, 6, 14), k.color.accent, { y: 0.47, rx: Math.PI / 2 }),
    ...[0, 1, 2, 3].map((i) => part(new BoxGeometry(0.06, 0.12, 0.015), i % 2 ? k.color.secondary : 'dark', { x: -0.1 + (i % 2) * 0.05, y: 0.36 - Math.floor(i / 2) * 0.12, z: 0.14 })),
  ];
}

// ------------------------------------------------------------------ Carthage

const GREY = new Color('#8a8580');
const IVORY = new Color('#efe6cf');

/**
 * Elefante de Guerra: an elephant carrying a small fighting tower with team
 * shields, a mahout at the neck and two crew. When struck the tower slides
 * off, the crew fall, and the elephant walks away off the board.
 */
export function carthageWarElephant(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('armor', body);
    const beast = new Group();
    beast.add(piece(k, body, 'ca-elephant', () => [...elephant(GREY, IVORY), part(new BoxGeometry(0.42, 0.03, 0.44), k.tint.cloth, { y: 0.58 }), part(new BoxGeometry(0.44, 0.02, 0.46), k.color.accent, { y: 0.565 })]));
    beast.scale.setScalar(1.35);
    model.add(beast);
    const mahout = piece(k, body, 'ca-mahout', () => figure(k, 0.42, 'soldier', 'cap', null));
    mahout.position.set(-0.42, 0.78, 0);
    model.add(mahout);
    const tower = new Group();
    tower.position.set(0.08, 0.8, 0);
    tower.add(piece(k, body, 'ca-tower', () => {
      const parts: Parts = [part(new BoxGeometry(0.38, 0.22, 0.34), k.color.wood, { y: 0.11 }), part(new BoxGeometry(0.4, 0.03, 0.36), k.color.woodDark, { y: 0.23 })];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(part(new BoxGeometry(0.07, 0.07, 0.07), k.color.wood, { x: sx * 0.16, y: 0.28, z: sz * 0.14 }));
      for (const s of [-1, 1]) for (const x of [-0.1, 0.1]) parts.push(part(new CylinderGeometry(0.06, 0.06, 0.012, 12), 'main', { x, y: 0.12, z: s * 0.175, rx: Math.PI / 2 }));
      parts.push(...moved(figure(k, 0.38, 'officer', k.params.helmet, 'spear'), { x: 0.05, y: 0.04 }));
      return parts;
    }));
    model.add(tower);
    const anchor = new Group();
    anchor.position.set(0.15, 0.5, 0.12);
    tower.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      beast.rotation.z = Math.sin(time * 1.1 + phase) * 0.02;
      tower.rotation.z = Math.sin(time * 1.1 + phase) * 0.03;
      beast.position.y = Math.abs(Math.sin(time * 1.1 + phase)) * 0.008;
    };

    model.wreck = async (ctx) => {
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      anchor.visible = false;
      model.attach(tower);
      const towerOff = throwPart(ctx, tower, new Vector3(0.55, 0.02, 0.4), 0.3, 0.8, new Vector3(0, 0, 0), new Vector3(0.3, 0.4, -1.4));
      model.attach(mahout);
      const mahoutOff = throwPart(ctx, mahout, new Vector3(-0.5, 0.02, -0.4), 0.3, 0.7, new Vector3(0, 0, 0), new Vector3(1.4, 0.2, 0));
      const away = bolt(ctx, beast, new Vector3(-1.8, 0, 0.9), 1.8);
      await Promise.all([towerOff, mahoutOff, away]);
    };
    return model;
  };
}

/**
 * Muralha do Porto: the round naval harbour, a ring of walls with ship sheds
 * around an inner basin and the admiral's tower on its island. When struck
 * the ring breaks in sections and the tower falls into the basin.
 */
export function carthageHarbor(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'ca-harbor-basin', () => [
      part(new CylinderGeometry(0.86, 0.88, 0.04, 28), k.color.stoneDark, { y: 0.02 }),
      part(new CylinderGeometry(0.6, 0.6, 0.02, 28), k.color.primary.clone().lerp(new Color('#2a7aa8'), 0.6), { y: 0.05 }),
    ]));
    const sections: Group[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const holder = new Group();
      holder.position.set(Math.sin(a) * 0.72, 0.04, Math.cos(a) * 0.72);
      holder.rotation.y = a;
      const tilt = new Group();
      holder.add(tilt);
      tilt.add(piece(k, body, 'ca-ring', () => {
        const parts: Parts = [part(new BoxGeometry(0.62, 0.3, 0.12), k.color.stone, { y: 0.15 }), part(new BoxGeometry(0.63, 0.03, 0.13), k.tint.trim, { y: 0.27 })];
        for (const x of [-0.18, 0, 0.18]) parts.push(part(new BoxGeometry(0.1, 0.14, 0.01), k.color.dark, { x, y: 0.09, z: -0.062 }));
        return parts;
      }));
      if (i !== 3) {
        model.add(holder);
        sections.push(tilt);
      }
    }
    const island = new Group();
    island.add(piece(k, body, 'ca-island', () => [
      part(new CylinderGeometry(0.22, 0.24, 0.1, 16), k.color.stone, { y: 0.07 }),
      part(new CylinderGeometry(0.12, 0.14, 0.5, 12), k.color.stone, { y: 0.37 }),
      part(new CylinderGeometry(0.15, 0.15, 0.04, 12), k.tint.trim, { y: 0.6 }),
      part(new ConeGeometry(0.15, 0.18, 12), 'dark', { y: 0.71 }),
    ]));
    model.add(island);
    const light = glowMesh(new SphereGeometry(0.04, 8, 6));
    light.position.y = 0.66;
    island.add(light);
    const anchor = new Group();
    anchor.position.set(0.06, 0.95, 0.06);
    island.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      light.visible = Math.sin(time * 2 + phase) > -0.3;
    };

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.03, 0.2);
      ctx.emit('splash', model.worldOf(new Vector3(0, 0.1, 0)));
      anchor.visible = false;
      light.visible = false;
      const jobs = sections.map((s, i) => topple(ctx, s, 'x', 1.25, 0.8, 0.08 + i * 0.07));
      jobs.push(topple(ctx, island, 'z', 1.2, 0.9, 0.2));
      ctx.emit('dust', model.worldOf(new Vector3(0.4, 0.2, 0.4)));
      await Promise.all(jobs);
    };
    return model;
  };
}
