import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, SphereGeometry, TorusGeometry, Vector3, type Object3D } from 'three';
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

/** Curved hip roof with a small front gable, eaves at y = 0. */
function castleRoof(k: KitStyle, w: number): Parts {
  return [
    part(new ConeGeometry(w * 0.8, 0.14, 4, 1, true), 'dark', { y: 0.07, ry: Math.PI / 4 }),
    part(new BoxGeometry(w * 0.62, 0.05, w * 0.62), k.color.woodDark, { y: 0.02 }),
    part(new ConeGeometry(0.07, 0.08, 3), 'dark', { y: 0.1, z: -w * 0.32, rx: -0.3 }),
  ];
}

/** Stone lantern (tōrō) with a glowing fire box. */
function stoneLantern(k: KitStyle): Parts {
  return [
    part(new CylinderGeometry(0.09, 0.11, 0.05, 6), k.color.stone, { y: 0.025 }),
    part(new CylinderGeometry(0.035, 0.045, 0.2, 6), k.color.stone, { y: 0.15 }),
    part(new BoxGeometry(0.13, 0.1, 0.13), k.color.stone, { y: 0.3 }),
    part(new BoxGeometry(0.07, 0.06, 0.135), 'glow', { y: 0.3 }),
    part(new ConeGeometry(0.13, 0.08, 6), k.color.stone, { y: 0.39 }),
    part(new SphereGeometry(0.02, 6, 4), k.color.stone, { y: 0.44 }),
  ];
}

/**
 * Torre do Castelo: a stone base and three plastered tiers with curved roofs,
 * golden fish on the ridge, a gate house and a stone lantern. A ninja crouches
 * on the roof. When struck the ninja vanishes in smoke and the keep comes
 * apart tier by tier, from the top down.
 */
export function japanCastleKeep(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const gate = piece(k, body, 'jp-gatehouse', () => [
      part(new BoxGeometry(0.5, 0.12, 0.4), k.color.stoneDark, { y: 0.06 }),
      part(new BoxGeometry(0.4, 0.2, 0.32), k.color.secondary, { y: 0.22 }),
      part(new BoxGeometry(0.42, 0.03, 0.34), k.color.woodDark, { y: 0.18 }),
      part(new BoxGeometry(0.14, 0.16, 0.01), k.color.woodDark, { y: 0.2, z: -0.165 }),
      ...moved(castleRoof(k, 0.5), { y: 0.32 }),
    ]);
    gate.position.copy(ANT_A);
    model.add(gate);
    const lantern = piece(k, body, 'jp-lantern', () => stoneLantern(k));
    lantern.position.copy(ANT_C);
    model.add(lantern);

    const keep = new Group();
    keep.position.copy(ANT_B);
    keep.add(piece(k, body, 'jp-keep-base', () => [
      part(new CylinderGeometry(0.3, 0.38, 0.3, 4), k.color.stone, { y: 0.15, ry: Math.PI / 4 }),
      part(new CylinderGeometry(0.302, 0.382, 0.012, 4), k.color.stoneDark, { y: 0.1, ry: Math.PI / 4 }),
    ]));
    model.add(keep);
    const tiers: Group[] = [];
    let parent: Object3D = keep;
    const sizes = [0.42, 0.34, 0.26];
    sizes.forEach((w, i) => {
      const tier = new Group();
      tier.position.y = i === 0 ? 0.3 : 0.32;
      tier.add(piece(k, body, `jp-keep-tier-${i}`, () => [
        part(new BoxGeometry(w, 0.2, w), k.color.secondary, { y: 0.1 }),
        part(new BoxGeometry(w + 0.01, 0.025, w + 0.01), k.color.woodDark, { y: 0.17 }),
        part(new BoxGeometry(w * 0.3, 0.06, 0.01), k.color.dark, { y: 0.1, z: -w / 2 - 0.005 }),
        ...moved(castleRoof(k, w + 0.12), { y: 0.2 }),
        ...(i === sizes.length - 1
          ? [-1, 1].map((s) => part(new ConeGeometry(0.025, 0.09, 5), k.color.accent, { x: s * 0.07, y: 0.36, rz: s * 0.4 }))
          : []),
      ]));
      parent.add(tier);
      tiers.push(tier);
      parent = tier;
    });
    // The ninja: crouched on the second roof, watching the river.
    const ninja = piece(k, body, 'jp-ninja', () => moved([
      part(new SphereGeometry(0.1, 10, 8), k.color.dark, { y: 0.1, sy: 0.9 }),
      part(new SphereGeometry(0.07, 10, 8), k.color.dark, { y: 0.24 }),
      part(new BoxGeometry(0.1, 0.018, 0.02), k.color.skin, { y: 0.25, z: -0.065 }),
      part(new BoxGeometry(0.02, 0.012, 0.13), 'main', { y: 0.29, z: 0.05 }),
      part(new BoxGeometry(0.012, 0.012, 0.2), k.color.metal, { x: 0.05, y: 0.18, z: 0.08, rx: 0.8 }),
    ], { sx: 0.7, sy: 0.7, sz: 0.7 }));
    ninja.position.set(0.15, 0.24, -0.12);
    tiers[1]!.add(ninja);
    const anchor = new Group();
    anchor.position.set(0, 0.42, 0);
    tiers[2]!.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      ninja.rotation.y = Math.sin(time * 0.6 + phase) * 0.7;
      ninja.position.y = 0.24 + Math.max(0, Math.sin(time * 0.35 + phase) - 0.8) * 0.12;
      body.userData.unit.lights.value = 0.75 + 0.25 * Math.sin(time * 2 + phase);
    };

    model.wreck = async (ctx) => {
      ctx.emit('smoke', ninja.getWorldPosition(new Vector3()));
      ninja.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, 1.2, ANT_B.z)));
      await shudder(ctx, keep, 0.03, 0.18);
      // Top tier first, then the next: each one is shed off the keep.
      const jobs: Promise<void>[] = [];
      [...tiers].reverse().forEach((tier, i) => {
        jobs.push(
          ctx.tweens.wait(i * 0.22).then(() => {
            model.attach(tier);
            const out = new Vector3(ANT_B.x + 0.35 + i * 0.2, 0.04 + i * 0.04, ANT_B.z + (i % 2 ? -0.35 : 0.3));
            return throwPart(ctx, tier, out, 0.25 + i * 0.05, 0.7, new Vector3(0, 0, 0), new Vector3((i % 2 ? 1 : -1) * 0.5, i * 0.6, -1.2 + i * 0.3));
          }),
        );
      });
      jobs.push(lerpTo(ctx, 0.6, (e) => (gate.scale.y = 1 - e * 0.3), 0.4));
      jobs.push(topple(ctx, lantern, 'x', 1.4, 0.8, 0.3));
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(ANT_B.x, 0.2, ANT_B.z)));
    };
    return model;
  };
}

/**
 * Portão Torii: a vermilion gate with a black curved lintel, a glowing plaque
 * and a rope with paper streamers. When struck a pillar gives way, the gate
 * falls back and the lintel slides off.
 */
export function japanTorii(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    const red = k.color.accent;
    model.add(piece(k, body, 'jp-torii-ground', () => [
      part(new BoxGeometry(0.74, 0.04, 0.5), k.color.stone, { y: 0.02 }),
      ...[-1, 1].map((s) => part(new CylinderGeometry(0.06, 0.07, 0.06, 10), k.color.dark, { x: s * 0.24, y: 0.07 })),
    ]));
    const gate = new Group();
    gate.position.y = 0.04;
    gate.add(piece(k, body, 'jp-torii', () => {
      const parts: Parts = [];
      for (const s of [-1, 1]) parts.push(part(new CylinderGeometry(0.036, 0.042, 0.62, 10), red, { x: s * 0.24, y: 0.31 }));
      parts.push(part(new BoxGeometry(0.62, 0.05, 0.05), red, { y: 0.48 }));
      parts.push(part(new BoxGeometry(0.06, 0.1, 0.03), 'glow', { y: 0.55, z: -0.02 }));
      parts.push(part(new BoxGeometry(0.8, 0.045, 0.07), red, { y: 0.6 }));
      parts.push(part(new BoxGeometry(0.84, 0.04, 0.08), k.color.dark, { y: 0.645 }));
      for (const s of [-1, 1]) parts.push(part(new BoxGeometry(0.1, 0.04, 0.08), k.color.dark, { x: s * 0.44, y: 0.66, rz: -s * 0.25 }));
      parts.push(part(new TorusGeometry(0.24, 0.012, 4, 14, Math.PI), k.color.rope, { y: 0.44, rz: Math.PI }));
      for (const x of [-0.12, 0, 0.12]) parts.push(part(new BoxGeometry(0.03, 0.08, 0.004), k.color.cloth, { x, y: 0.32 }));
      return parts;
    }));
    model.add(gate);
    const offering = piece(k, body, 'jp-torii-offering', () => [
      part(lathe([[0, 0], [0.06, 0], [0.07, 0.03], [0, 0.03]], 10), k.color.metal, { y: 0.04 }),
      part(new SphereGeometry(0.035, 8, 6), 'glow', { y: 0.09 }),
    ]);
    offering.position.set(0, 0, 0.16);
    model.add(offering);
    const flames = [flame(0.35)];
    flames[0]!.position.set(0, 0.1 + flames[0]!.position.y, 0.16);
    model.add(flames[0]!);

    const phase = Math.random() * 6;
    model.idle = (time) => {
      body.userData.unit.lights.value = 0.75 + 0.3 * Math.max(0, Math.sin(time * 2.2 + phase));
      flicker(flames, time + phase, 1);
    };

    model.wreck = async (ctx) => {
      const top = () => model.worldOf(new Vector3(0, 0.6, 0));
      for (let i = 0; i < 3; i++) {
        ctx.emit('arc', top());
        body.userData.unit.lights.value = i % 2 ? 0.2 : 2.2;
        await ctx.tweens.wait(0.1);
      }
      body.userData.unit.lights.value = 0;
      for (const f of flames) f.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      // One pillar buckles, then the whole gate falls backwards.
      const lean = lerpTo(ctx, 0.3, (e) => (gate.rotation.z = e * 0.12));
      await lean;
      await topple(ctx, gate, 'x', 1.35, 0.9);
    };
    return model;
  };
}

/** Samurai details: lacquered shoulder guards and a plated skirt. */
export function samuraiArmour(k: KitStyle): Parts {
  const parts: Parts = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) parts.push(part(new BoxGeometry(0.09, 0.025, 0.11), i % 2 ? k.color.dark : 'main', { x: s * 0.15, y: 0.44 - i * 0.03, rz: -s * 0.35 }));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(part(new BoxGeometry(0.08, 0.1, 0.012), i % 2 ? k.color.dark : 'main', { x: Math.sin(a) * 0.15, y: 0.15, z: Math.cos(a) * 0.15, ry: a }));
  }
  return parts;
}

