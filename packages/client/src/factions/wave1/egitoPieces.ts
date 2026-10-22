import { Color as ThreeColor, BoxGeometry, ConeGeometry, CylinderGeometry, Group, Matrix4, Quaternion, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry, type Color } from 'three';
import { lathe, part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { flicker, piece } from '../kit/common';
import { figure, flame, glowMesh, hull, moved, ornamentBand, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

/** Aswan rose granite for the obelisk. */
const GRANITE = new ThreeColor('#b98272');

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/** Pylon gateway: two sloped towers with a cavetto cornice around a doorway. */
function pylon(k: KitStyle): Parts {
  const parts: Parts = [part(new BoxGeometry(0.62, 0.04, 0.4), k.color.stoneDark, { y: 0.02 })];
  for (const s of [-1, 1]) {
    parts.push(part(new CylinderGeometry(0.13, 0.17, 0.46, 4), k.color.stone, { x: s * 0.17, y: 0.27, ry: Math.PI / 4, sz: 0.75 }));
    parts.push(part(new BoxGeometry(0.22, 0.04, 0.2), k.tint.trim, { x: s * 0.17, y: 0.51 }));
    parts.push(part(new BoxGeometry(0.012, 0.3, 0.008), 'glow', { x: s * 0.17, y: 0.28, z: -0.13 }));
  }
  parts.push(part(new BoxGeometry(0.12, 0.3, 0.16), k.color.stoneDark, { y: 0.17 }));
  parts.push(part(new BoxGeometry(0.16, 0.05, 0.18), k.color.accent, { y: 0.34 }));
  return parts;
}

/**
 * Obelisco: a granite needle with a gilded pyramidion and glowing inscriptions,
 * a pylon gate on the first cell and an offering brazier on the last. When hit,
 * the shaft snaps in half and the top crashes towards the brazier.
 */
export function egyptObelisk(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const gate = piece(k, body, 'eg-pylon', () => pylon(k));
    gate.position.copy(ANT_A);
    model.add(gate);
    const altar = piece(k, body, 'eg-offering', () => [
      part(new BoxGeometry(0.3, 0.16, 0.26), k.color.stone, { y: 0.08 }),
      ...moved(ornamentBand(k, 'lotus', 0.26), { y: 0.1, z: -0.135 }),
      part(lathe([[0, 0], [0.08, 0.01], [0.1, 0.05], [0, 0.03]], 12), k.color.accent, { y: 0.16 }),
      part(new SphereGeometry(0.05, 8, 6), 'glow', { y: 0.19, sy: 0.4 }),
    ]);
    altar.position.copy(ANT_C);
    model.add(altar);
    const altarFlames = [flame(0.7), flame(0.5)];
    altarFlames.forEach((f, i) => {
      f.position.set(ANT_C.x + i * 0.03, 0.2 + f.position.y, ANT_C.z);
      model.add(f);
    });

    const base = new Group();
    base.position.copy(ANT_B);
    base.add(piece(k, body, 'eg-obelisk-low', () => [
      part(new BoxGeometry(0.5, 0.06, 0.5), k.color.stoneDark, { y: 0.03 }),
      part(new BoxGeometry(0.4, 0.06, 0.4), k.tint.trim, { y: 0.09 }),
      part(new CylinderGeometry(0.14, 0.17, 0.66, 4), GRANITE, { y: 0.45, ry: Math.PI / 4 }),
      part(new BoxGeometry(0.03, 0.5, 0.01), 'glow', { y: 0.46, z: -0.115 }),
      part(new BoxGeometry(0.01, 0.5, 0.03), 'glow', { x: 0.115, y: 0.46 }),
    ]));
    const upper = new Group();
    upper.position.y = 0.78;
    upper.add(piece(k, body, 'eg-obelisk-up', () => [
      part(new CylinderGeometry(0.1, 0.14, 0.62, 4), GRANITE, { y: 0.31, ry: Math.PI / 4 }),
      part(new BoxGeometry(0.025, 0.46, 0.01), 'glow', { y: 0.3, z: -0.092 }),
    ]));
    const pyramidion = piece(k, body, 'eg-pyramidion', () => [part(new ConeGeometry(0.1, 0.14, 4), k.color.accent, { y: 0.07, ry: Math.PI / 4 })]);
    pyramidion.position.y = 0.62;
    upper.add(pyramidion);
    base.add(upper);
    model.add(base);
    const glint = glowMesh(new SphereGeometry(0.05, 8, 6));
    glint.position.y = 0.72;
    upper.add(glint);
    const anchor = new Group();
    const pole = piece(k, body, 'eg-gate-pole', () => [part(new CylinderGeometry(0.008, 0.01, 0.5, 6), k.color.wood, { y: 0.25 })]);
    pole.position.set(ANT_A.x + 0.3, 0.04, ANT_A.z);
    anchor.position.set(ANT_A.x + 0.3, 0.52, ANT_A.z);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      flicker(altarFlames, time + phase, 1);
      const g = Math.max(0, Math.sin(time * 0.7 + phase) - 0.9) * 10;
      glint.visible = g > 0.05;
      glint.scale.setScalar(0.4 + g);
      body.userData.unit.lights.value = 0.7 + 0.3 * Math.sin(time * 1.2 + phase);
    };

    model.wreck = async (ctx) => {
      glint.visible = false;
      for (const f of altarFlames) f.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, 1.0, ANT_B.z)));
      await shudder(ctx, base, 0.03, 0.18);
      ctx.emit('dust', model.worldOf(new Vector3(ANT_B.x, 0.75, ANT_B.z)));
      const snap = lerpTo(ctx, 0.2, (e) => (upper.rotation.x = 0.05 * e)).then(() => topple(ctx, upper, 'z', -1.4, 1.0));
      model.attach(pyramidion);
      const cap = throwPart(ctx, pyramidion, new Vector3(ANT_C.x + 0.25, 0.04, ANT_C.z - 0.35), 0.5, 1.0, new Vector3(2, 3, 4), new Vector3(Math.PI * 0.55, 0.8, 0.4));
      const gateShake = lerpTo(ctx, 0.6, (e) => (gate.scale.y = 1 - e * 0.25), 0.3);
      pole.visible = false;
      anchor.visible = false;
      await Promise.all([snap, cap, gateShake]);
    };
    return model;
  };
}

/** Thin cylinder from a to b (legs). */
function limb(a: Vector3, b: Vector3, radius: number, tint: Color): BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new CylinderGeometry(radius * 0.8, radius, dir.length(), 5);
  g.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()), new Vector3(1, 1, 1)));
  return part(g, tint);
}

function scarabBody(k: KitStyle): Parts {
  const gold = k.color.accent;
  const parts: Parts = [
    part(new SphereGeometry(0.13, 16, 10), gold, { y: 0.07, sx: 1.25, sy: 0.6, sz: 1 }),
    // Lapis wing cases with a gold seam.
    part(new SphereGeometry(0.133, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), k.color.primary, { y: 0.07, sx: 1.25, sy: 0.62 }),
    part(new BoxGeometry(0.2, 0.012, 0.012), gold, { x: 0.03, y: 0.152 }),
    part(new SphereGeometry(0.07, 12, 8), gold, { x: -0.17, y: 0.06, sx: 0.9, sy: 0.6, sz: 1.3 }),
    part(new SphereGeometry(0.045, 10, 6), gold, { x: -0.25, y: 0.05, sy: 0.6, sz: 1.4 }),
  ];
  // Two pairs of legs splayed onto the plinth, the front pair raised to hold the sun.
  for (const s of [-1, 1]) {
    for (const x of [0.12, -0.02]) {
      const knee = new Vector3(x, 0.08, s * 0.16);
      parts.push(limb(new Vector3(x, 0.06, s * 0.08), knee, 0.012, gold));
      parts.push(limb(knee, new Vector3(x + 0.05, 0.0, s * 0.22), 0.01, gold));
    }
    parts.push(limb(new Vector3(-0.2, 0.06, s * 0.06), new Vector3(-0.3, 0.13, s * 0.07), 0.011, gold));
    parts.push(limb(new Vector3(-0.3, 0.13, s * 0.07), new Vector3(-0.33, 0.2, s * 0.04), 0.009, gold));
  }
  return parts;
}

/**
 * Escaravelho Sagrado: a golden scarab on a lotus plinth, rolling a glowing
 * sun disc above its head. When struck the disc dims and drops, and the statue
 * tips off its base.
 */
export function egyptScarab(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('generator', body);
    model.add(piece(k, body, 'eg-scarab-plinth', () => [
      part(new BoxGeometry(0.72, 0.05, 0.72), k.color.stoneDark, { y: 0.025 }),
      part(new CylinderGeometry(0.28, 0.32, 0.12, 4), k.color.stone, { y: 0.11, ry: Math.PI / 4 }),
      part(new BoxGeometry(0.42, 0.025, 0.42), k.tint.trim, { y: 0.18 }),
      ...moved(ornamentBand(k, 'lotus', 0.4), { y: 0.11, z: -0.22 }),
    ]));
    const statue = new Group();
    statue.position.y = 0.19;
    const beetle = piece(k, body, 'eg-scarab', () => scarabBody(k));
    statue.add(beetle);
    const disc = new Group();
    disc.position.set(-0.36, 0.28, 0);
    disc.add(piece(k, body, 'eg-sun-disc', () => [
      part(new CylinderGeometry(0.13, 0.13, 0.03, 20), k.color.accent, { rz: Math.PI / 2 }),
      part(new CylinderGeometry(0.09, 0.09, 0.035, 18), 'glow', { rz: Math.PI / 2 }),
      part(new TorusGeometry(0.13, 0.012, 5, 20), k.tint.trim, { ry: Math.PI / 2 }),
    ]));
    const halo = glowMesh(new SphereGeometry(0.05, 10, 8));
    disc.add(halo);
    statue.add(disc);
    model.add(statue);

    const phase = Math.random() * 6;
    let alive = true;
    model.idle = (time) => {
      if (!alive) return;
      const push = Math.sin(time * 1.4 + phase);
      statue.rotation.z = push * 0.04;
      disc.rotation.x += 0.01;
      disc.position.y = 0.28 + Math.sin(time * 2 + phase) * 0.008;
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.6 + phase);
      body.userData.unit.lights.value = 0.8 + 0.4 * pulse;
      halo.scale.setScalar(0.8 + pulse * 0.5);
    };

    model.wreck = async (ctx) => {
      alive = false;
      const sun = () => model.worldOf(new Vector3(-0.27, 0.5, 0));
      for (let i = 0; i < 3; i++) {
        ctx.emit('arc', sun());
        body.userData.unit.lights.value = i % 2 ? 0.2 : 2.4;
        halo.visible = i % 2 === 0;
        await ctx.tweens.wait(0.1);
      }
      halo.visible = false;
      body.userData.unit.lights.value = 0;
      model.attach(disc);
      const drop = throwPart(ctx, disc, new Vector3(-0.42, 0.13, 0.3), 0.25, 0.7, new Vector3(0, 0, 0), new Vector3(Math.PI / 2, 0, Math.PI / 2));
      const tip = lerpTo(ctx, 0.8, (e) => {
        statue.rotation.z = -e * 0.5;
        statue.rotation.x = e * 0.25;
        statue.position.set(e * 0.12, 0.19 - e * 0.08, e * 0.05);
      }, 0.1);
      ctx.emit('smoke', sun());
      await Promise.all([drop, tip]);
    };
    return model;
  };
}

/**
 * Barca Solar: a papyrus-bundle barque with curled ends, a canopied shrine in
 * team cloth and a sun disc riding on top. It lists and settles when sunk.
 */
export function egyptSolarBarque(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('amphibian', body);
    const craft = new Group();
    craft.position.y = 0.08;
    model.add(craft);
    craft.add(piece(k, body, 'eg-barque-hull', () => hull(k, 'reed')));
    const shrine = new Group();
    shrine.position.set(0.05, 0.1, 0);
    shrine.add(piece(k, body, 'eg-barque-shrine', () => [
      part(new BoxGeometry(0.42, 0.04, 0.26), k.color.woodDark, { y: 0.02 }),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(new CylinderGeometry(0.012, 0.014, 0.26, 6), k.color.accent, { x: sx * 0.18, y: 0.15, z: sz * 0.11 }))),
      part(new BoxGeometry(0.44, 0.03, 0.28), k.tint.cloth, { y: 0.29 }),
      part(new BoxGeometry(0.46, 0.02, 0.3), k.color.accent, { y: 0.31 }),
      part(new BoxGeometry(0.4, 0.12, 0.012), k.tint.cloth, { y: 0.2, z: 0.12 }),
      part(new BoxGeometry(0.4, 0.12, 0.012), k.tint.cloth, { y: 0.2, z: -0.12 }),
      ...moved(ornamentBand(k, 'lotus', 0.4), { y: 0.25, z: -0.13 }),
    ]));
    const sun = new Group();
    sun.position.y = 0.42;
    sun.add(piece(k, body, 'eg-barque-sun', () => [part(new CylinderGeometry(0.09, 0.09, 0.025, 18), k.color.accent, { rx: Math.PI / 2 }), part(new CylinderGeometry(0.06, 0.06, 0.03, 16), 'glow', { rx: Math.PI / 2 })]));
    shrine.add(sun);
    craft.add(shrine);
    const steersman = piece(k, body, 'eg-barque-crew', () => figure(k, 0.5, 'officer', k.params.helmet, null));
    steersman.position.set(0.55, 0.1, 0);
    craft.add(steersman);
    const oar = new Group();
    oar.position.set(0.66, 0.16, 0.12);
    oar.add(piece(k, body, 'eg-barque-oar', () => [part(new BoxGeometry(0.014, 0.46, 0.014), k.color.wood, { y: -0.12, rx: 0.5 }), part(new BoxGeometry(0.08, 0.12, 0.012), k.color.accent, { y: -0.32, z: 0.11, rx: 0.5 })]));
    craft.add(oar);
    const anchor = new Group();
    anchor.position.set(-0.2, 0.46, 0);
    shrine.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      craft.position.y = 0.08 + Math.sin(time * 1.6 + phase) * 0.014;
      craft.rotation.x = Math.sin(time * 1.0 + phase) * 0.025;
      sun.rotation.z = Math.sin(time * 0.5 + phase) * 0.15;
      oar.rotation.x = Math.sin(time * 0.9 + phase) * 0.2;
      body.userData.unit.lights.value = 0.8 + 0.2 * Math.sin(time * 2 + phase);
    };

    model.wreck = async (ctx) => {
      ctx.emit('splash', model.worldOf(new Vector3(0, 0.1, 0)));
      const side = ctx.random() < 0.5 ? -1 : 1;
      const canopy = lerpTo(ctx, 0.6, (e) => {
        shrine.scale.y = 1 - e * 0.5;
        shrine.rotation.x = side * e * 0.3;
      });
      model.attach(sun);
      const disc = throwPart(ctx, sun, new Vector3(-0.4, 0.06, side * 0.25), 0.3, 0.7, new Vector3(2, 0, 0), new Vector3(Math.PI / 2, 0, 0));
      const list = lerpTo(ctx, 1.2, (e) => {
        craft.rotation.x = side * 0.3 * e;
        craft.rotation.z = -0.1 * e;
        craft.position.y = 0.08 - e * 0.1;
      });
      const crew = topple(ctx, steersman, 'z', 1.3, 0.7, 0.1);
      await Promise.all([canopy, disc, list, crew]);
    };
    return model;
  };
}

