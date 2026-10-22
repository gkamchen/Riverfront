import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry, Vector3, type Mesh } from 'three';
import { part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { flicker, piece } from '../kit/common';
import { flame, moved, ornamentBand, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/**
 * Observatório: a round tower on a two-step platform, topped by a small dome
 * with sighting slots, a priests' house and a sky-reading stone. When struck
 * the dome splits off, the drum cracks and slumps.
 */
export function mayaObservatory(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const house = piece(k, body, 'my-house', () => [
      part(new BoxGeometry(0.46, 0.08, 0.4), k.color.stoneDark, { y: 0.04 }),
      part(new BoxGeometry(0.4, 0.22, 0.32), k.color.stone, { y: 0.19 }),
      part(new BoxGeometry(0.12, 0.16, 0.01), k.color.dark, { y: 0.16, z: -0.165 }),
      part(new BoxGeometry(0.44, 0.08, 0.36), 'dark', { y: 0.34 }),
      ...moved(ornamentBand(k, 'zigzag', 0.36, k.color.accent), { y: 0.34, z: -0.185 }),
    ]);
    house.position.copy(ANT_A);
    model.add(house);
    const stone = piece(k, body, 'my-sky-stone', () => [part(new CylinderGeometry(0.16, 0.18, 0.08, 12), k.color.stone, { y: 0.04 }), part(new CylinderGeometry(0.09, 0.09, 0.02, 12), 'glow', { y: 0.09 }), part(new BoxGeometry(0.03, 0.3, 0.03), k.color.stoneDark, { x: 0.12, y: 0.15 })]);
    stone.position.copy(ANT_C);
    model.add(stone);
    const base = piece(k, body, 'my-obs-base', () => [
      part(new BoxGeometry(0.62, 0.1, 0.62), k.color.stoneDark, { y: 0.05 }),
      part(new BoxGeometry(0.5, 0.1, 0.5), k.color.stone, { y: 0.15 }),
      part(new BoxGeometry(0.16, 0.2, 0.12), k.color.stone, { y: 0.1, z: -0.34, rx: -0.5 }),
    ]);
    base.position.copy(ANT_B);
    model.add(base);
    const drum = new Group();
    drum.position.set(ANT_B.x, 0.2, ANT_B.z);
    drum.add(piece(k, body, 'my-obs-drum', () => [
      part(new CylinderGeometry(0.19, 0.21, 0.5, 18), k.color.stone, { y: 0.25 }),
      part(new CylinderGeometry(0.2, 0.2, 0.04, 18), k.tint.trim, { y: 0.48 }),
      part(new BoxGeometry(0.1, 0.16, 0.01), k.color.dark, { y: 0.16, z: -0.205 }),
    ]));
    model.add(drum);
    const dome = piece(k, body, 'my-obs-dome', () => [
      part(new SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.color.stone, { y: 0 }),
      ...[0, 1, 2].map((i) => part(new BoxGeometry(0.03, 0.06, 0.02), k.color.dark, { x: Math.sin(i * 1.2 - 1.2) * 0.17, y: 0.07, z: -Math.cos(i * 1.2 - 1.2) * 0.17, ry: i * 1.2 - 1.2 })),
      part(new BoxGeometry(0.05, 0.08, 0.05), k.color.accent, { y: 0.2 }),
    ]);
    dome.position.set(ANT_B.x, 0.2 + 0.5, ANT_B.z);
    model.add(dome);
    const anchor = new Group();
    anchor.position.set(ANT_B.x + 0.12, 0.2 + 0.78, ANT_B.z);
    model.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      dome.rotation.y = Math.sin(time * 0.12 + phase) * 0.6;
      body.userData.unit.lights.value = 0.7 + 0.3 * Math.sin(time * 0.9 + phase);
    };

    model.wreck = async (ctx) => {
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, 0.8, ANT_B.z)));
      anchor.visible = false;
      await shudder(ctx, drum, 0.03, 0.18);
      model.attach(dome);
      const top = throwPart(ctx, dome, new Vector3(ANT_C.x + 0.2, 0.05, ANT_C.z - 0.35), 0.35, 0.8, new Vector3(2, 1, 2), new Vector3(Math.PI / 2, 0.5, 0.2));
      const slump = lerpTo(ctx, 0.7, (e) => {
        drum.scale.set(1 + e * 0.1, 1 - e * 0.55, 1 + e * 0.1);
        drum.rotation.z = -e * 0.15;
      }, 0.15);
      const stoneDown = topple(ctx, stone, 'x', 1.2, 0.7, 0.3);
      ctx.emit('dust', model.worldOf(new Vector3(ANT_B.x, 0.3, ANT_B.z)));
      await Promise.all([top, slump, stoneDown]);
    };
    return model;
  };
}

/**
 * Estela: a carved standing stone with glyph bands glowing in the team colour
 * and a round altar before it. When struck the glyphs flicker out, the stone
 * leans and falls onto its altar.
 */
export function mayaStela(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    model.add(piece(k, body, 'my-stela-ground', () => [
      part(new BoxGeometry(0.7, 0.05, 0.7), k.color.stoneDark, { y: 0.025 }),
      part(new CylinderGeometry(0.16, 0.18, 0.1, 14), k.color.stone, { y: 0.1, z: -0.2 }),
    ]));
    const slab = new Group();
    slab.position.set(0, 0.05, 0.1);
    slab.add(piece(k, body, 'my-stela', () => {
      const parts: Parts = [part(new BoxGeometry(0.3, 0.72, 0.14), k.color.stone, { y: 0.36 })];
      for (let i = 0; i < 4; i++) {
        parts.push(part(new BoxGeometry(0.09, 0.09, 0.01), 'glow', { x: -0.065, y: 0.14 + i * 0.13, z: -0.072 }));
        parts.push(part(new BoxGeometry(0.09, 0.09, 0.01), 'glow', { x: 0.065, y: 0.14 + i * 0.13, z: -0.072 }));
      }
      parts.push(part(new BoxGeometry(0.32, 0.05, 0.15), k.color.accent, { y: 0.73 }));
      return parts;
    }));
    model.add(slab);
    const flames = [flame(0.45)];
    flames[0]!.position.set(0, 0.15 + flames[0]!.position.y, -0.2);
    model.add(flames[0]!);

    const phase = Math.random() * 6;
    model.idle = (time) => {
      body.userData.unit.lights.value = 0.7 + 0.35 * Math.max(0, Math.sin(time * 1.5 + phase));
      flicker(flames, time + phase, 1);
    };

    model.wreck = async (ctx) => {
      for (let i = 0; i < 3; i++) {
        ctx.emit('arc', model.worldOf(new Vector3(0, 0.5, 0)));
        body.userData.unit.lights.value = i % 2 ? 0.2 : 2.2;
        await ctx.tweens.wait(0.1);
      }
      body.userData.unit.lights.value = 0;
      for (const f of flames) f.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      await topple(ctx, slab, 'x', -1.3, 0.9);
    };
    return model;
  };
}

/** One shrine on the twin temple: a room with a tall roof, its own colour. */
function shrine(k: KitStyle, roofTint: 'main' | 'dark'): Parts {
  return [
    part(new BoxGeometry(0.34, 0.2, 0.3), k.color.secondary, { y: 0.1 }),
    part(new BoxGeometry(0.1, 0.14, 0.01), k.color.dark, { y: 0.07, z: -0.155 }),
    part(new BoxGeometry(0.36, 0.2, 0.32), roofTint, { y: 0.3 }),
    ...[-0.12, 0, 0.12].map((x) => part(new BoxGeometry(0.05, 0.08, 0.33), k.color.accent, { x, y: 0.43 })),
  ];
}

/**
 * Templo Duplo: a stepped pyramid with twin stairways and two shrines on top,
 * each with its own colour. When struck the shrines are thrown down and the
 * terraces settle.
 */
export function aztecTwinTemple(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const tierH = 0.16;
    const tiers: Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const w = 1.72 - i * 0.3;
      const t = piece(k, body, `az-tier-${i}`, () => [
        part(new BoxGeometry(w, tierH, w * 0.9), i % 2 ? k.color.stone : k.color.stoneDark, { y: tierH / 2 }),
        part(new BoxGeometry(w + 0.01, 0.025, w * 0.9 + 0.01), k.tint.trim, { y: tierH - 0.02 }),
        ...(i === 0 ? moved(ornamentBand(k, k.motifs.ornament, w * 0.7), { y: tierH * 0.5, z: -w * 0.45 - 0.01 }) : []),
      ]);
      t.position.y = i * tierH;
      model.add(t);
      tiers.push(t);
    }
    const stairs = piece(k, body, 'az-stairs', () => [-0.2, 0.2].flatMap((x) => [
      part(new BoxGeometry(0.26, 0.05, 1.0), k.color.secondary, { x, y: 0.32, z: -0.48, rx: -0.6 }),
      part(new BoxGeometry(0.03, 0.09, 1.0), k.color.accent, { x: x + (x < 0 ? -0.14 : 0.14), y: 0.34, z: -0.48, rx: -0.6 }),
    ]));
    model.add(stairs);
    const shrines = (['main', 'dark'] as const).map((tint, i) => {
      const s = piece(k, body, `az-shrine-${tint}`, () => shrine(k, tint));
      s.position.set(i ? 0.22 : -0.22, 4 * tierH, 0.05);
      model.add(s);
      return s;
    });
    const anchor = new Group();
    anchor.position.set(0, 4 * tierH + 0.75, 0.05);
    const pole = piece(k, body, 'az-pole', () => [part(new CylinderGeometry(0.008, 0.01, 0.35, 6), k.color.wood, { y: 0.17 })]);
    pole.position.set(0, 4 * tierH + 0.4, 0.05);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.03, 0.2);
      anchor.visible = false;
      pole.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(0, 4 * tierH + 0.3, 0)));
      const jobs: Promise<void>[] = [];
      shrines.forEach((s, i) => {
        model.attach(s);
        jobs.push(throwPart(ctx, s, new Vector3(i ? 0.85 : -0.85, 0.05, -0.6 + i * 0.2), 0.5, 0.85, new Vector3(2, 2, 1), new Vector3(0.3, i ? 1.2 : -1.2, (i ? 1 : -1) * Math.PI / 2)));
      });
      [...tiers].reverse().forEach((t, i) => jobs.push(lerpTo(ctx, 0.5, (e) => {
        t.scale.set(1 + e * 0.06, 1 - e * 0.5, 1 + e * 0.06);
        t.position.y = (3 - i) * tierH * (1 - e * 0.5);
      }, 0.15 + i * 0.1)));
      jobs.push(lerpTo(ctx, 0.5, (e) => (stairs.scale.y = 1 - e * 0.5), 0.2));
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      await Promise.all(jobs);
    };
    return model;
  };
}

/**
 * Serpente Emplumada: a great stone serpent head with a collar of feathers in
 * team colours and glowing eyes, on a low plinth. When struck the eyes dim,
 * the head cracks from the collar and falls forward.
 */
export function aztecFeatheredSerpent(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    model.add(piece(k, body, 'az-serpent-plinth', () => [
      part(new BoxGeometry(0.7, 0.06, 0.7), k.color.stoneDark, { y: 0.03 }),
      part(new BoxGeometry(0.5, 0.1, 0.5), k.color.stone, { y: 0.11 }),
      ...moved(ornamentBand(k, k.motifs.ornament, 0.44, k.tint.trim), { y: 0.11, z: -0.255 }),
    ]));
    // A ruff of feathers fanned out in a disc behind the head.
    const collar = new Group();
    collar.position.set(0, 0.34, 0.08);
    collar.add(piece(k, body, 'az-serpent-ruff', () => {
      const parts: Parts = [part(new CylinderGeometry(0.13, 0.13, 0.05, 16), k.color.stone, { rx: Math.PI / 2 })];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const tint = i % 3 === 0 ? 'main' : i % 3 === 1 ? k.color.accent : k.color.primary.clone().lerp(k.color.secondary, 0.2);
        parts.push(part(new ConeGeometry(0.045, 0.2, 5), tint, { x: Math.cos(a) * 0.2, y: Math.sin(a) * 0.2, z: 0.01, rz: a - Math.PI / 2, sz: 0.4 }));
      }
      return parts;
    }));
    model.add(collar);
    const head = new Group();
    head.position.set(0, 0.22, 0);
    head.add(piece(k, body, 'az-serpent-head', () => [
      part(new BoxGeometry(0.22, 0.17, 0.24), k.color.stone, { y: 0.12, z: -0.02 }),
      part(new BoxGeometry(0.18, 0.08, 0.16), k.color.stone, { y: 0.1, z: -0.2 }),
      part(new SphereGeometry(0.06, 10, 8), k.color.stone, { y: 0.11, z: -0.28, sx: 1.4, sy: 0.7 }),
      part(new BoxGeometry(0.17, 0.03, 0.12), k.color.dark, { y: 0.055, z: -0.22 }),
      part(new BoxGeometry(0.2, 0.035, 0.08), k.color.stone, { y: 0.21, z: -0.1 }),
      part(new SphereGeometry(0.032, 8, 6), 'glow', { x: -0.075, y: 0.18, z: -0.14 }),
      part(new SphereGeometry(0.032, 8, 6), 'glow', { x: 0.075, y: 0.18, z: -0.14 }),
      ...[-0.06, 0.06].map((x) => part(new ConeGeometry(0.014, 0.06, 4), k.color.cloth, { x, y: 0.03, z: -0.27, rx: Math.PI })),
      part(new BoxGeometry(0.015, 0.012, 0.1), k.color.accent, { y: 0.05, z: -0.34 }),
    ]));
    model.add(head);

    const phase = Math.random() * 6;
    model.idle = (time) => {
      body.userData.unit.lights.value = 0.7 + 0.35 * Math.max(0, Math.sin(time * 1.2 + phase));
      collar.rotation.z = Math.sin(time * 0.6 + phase) * 0.08;
    };

    model.wreck = async (ctx) => {
      for (let i = 0; i < 3; i++) {
        ctx.emit('arc', model.worldOf(new Vector3(0, 0.4, -0.15)));
        body.userData.unit.lights.value = i % 2 ? 0.2 : 2.2;
        await ctx.tweens.wait(0.1);
      }
      body.userData.unit.lights.value = 0;
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      const fall = topple(ctx, head, 'x', -1.1, 0.8);
      const spread = lerpTo(ctx, 0.6, (e) => collar.scale.set(1 + e * 0.3, 1 - e * 0.5, 1 + e * 0.3));
      await Promise.all([fall, spread]);
    };
    return model;
  };
}
