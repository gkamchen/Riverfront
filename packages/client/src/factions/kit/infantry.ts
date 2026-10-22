import { BoxGeometry, CylinderGeometry, Group, TorusGeometry, Vector3 } from 'three';
import { lathe, part, ring } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { piece } from './common';
import { HEAD_SCALE, HEAD_Y, figureBody, headgear, ornamentBand, shield, weapon, moved, type Parts } from './pieces';
import type { KitStyle } from './style';

function standBase(k: KitStyle): Parts {
  return [
    part(lathe([[0, 0], [0.27, 0], [0.28, 0.03], [0.25, 0.07], [0.2, 0.09], [0, 0.09]], 18), k.color.stoneDark),
    part(ring(0.22, 0.012, 0.07), k.tint.trim),
    ...moved(ornamentBand(k, k.motifs.ornament, 0.3), { y: 0.05, z: -0.26 }),
  ];
}

/** Foot soldier: helmet, shield and weapon all follow the kit parameters. */
export interface RecruitOptions {
  /** A small team-coloured banner on a pole across the back (sashimono). */
  backBanner?: boolean;
  /** Extra pieces merged into the body (shoulder plates, a pomegranate butt...). */
  extras?: (k: KitStyle) => Parts;
  /** Cache key suffix when extras differ. */
  variant?: string;
}

export function kitRecruit(k: KitStyle, options: RecruitOptions = {}): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const p = k.params;
    const variant = options.variant ?? '';
    const model = new UnitModel('recruit', body);
    model.add(piece(k, body, 'recruit-base', () => standBase(k)));
    const tilt = new Group();
    const torso = new Group();
    torso.position.y = 0.09;
    torso.add(piece(k, body, `recruit-body-${p.weapon}${variant}`, () => [...figureBody(k), ...weapon(k, p.weapon), ...(options.extras?.(k) ?? [])]));
    let banner: Group | null = null;
    if (options.backBanner) {
      banner = new Group();
      banner.position.set(0.02, 0.3, 0.13);
      banner.add(piece(k, body, 'recruit-sashimono', () => [
        part(new CylinderGeometry(0.008, 0.008, 0.62, 5), k.color.woodDark, { y: 0.31 }),
        part(new BoxGeometry(0.004, 0.24, 0.11), 'main', { y: 0.48, z: 0.06 }),
        part(new BoxGeometry(0.006, 0.05, 0.05), k.color.accent, { y: 0.5, z: 0.06 }),
      ]));
      torso.add(banner);
    }
    const guard = piece(k, body, `recruit-shield-${p.shield}`, () => shield(k, p.shield));
    torso.add(guard);
    const helmet = piece(k, body, `recruit-helmet-${p.helmet}`, () => headgear(k, p.helmet));
    helmet.position.y = HEAD_Y;
    helmet.scale.setScalar(HEAD_SCALE);
    torso.add(helmet);
    tilt.add(torso);
    model.add(tilt);

    const phase = Math.random() * 6;
    model.idle = (time) => {
      const breath = Math.sin(time * 2.4 + phase);
      torso.scale.set(1 - breath * 0.008, 1 + breath * 0.02, 1 - breath * 0.008);
      torso.rotation.z = Math.sin(time * 0.9 + phase) * 0.03;
      helmet.rotation.y = Math.sin(time * 0.5 + phase) * 0.25;
      guard.rotation.y = Math.sin(time * 0.7 + phase) * 0.06;
      if (banner) banner.rotation.z = Math.sin(time * 1.6 + phase) * 0.06;
    };

    model.wreck = async (ctx) => {
      torso.scale.set(1, 1, 1);
      torso.rotation.z = 0;
      model.attach(helmet);
      model.attach(guard);
      const angle = ctx.random() * Math.PI * 2;
      const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
      const helmetDone = throwPart(ctx, helmet, new Vector3(dir.x * 0.42, 0.075, dir.z * 0.42), 0.45, 0.7, new Vector3(dir.z * 9, 2, -dir.x * 9), new Vector3(Math.PI / 2, angle, 0));
      const shieldDone = throwPart(ctx, guard, new Vector3(-0.25, 0.02, -0.25), 0.2, 0.6, new Vector3(-1.2, 0.5, 0), new Vector3(-Math.PI / 2, 0.3, 0));
      if (banner) {
        model.attach(banner);
        void throwPart(ctx, banner, new Vector3(0.3, 0.02, 0.35), 0.3, 0.8, new Vector3(0, 0, 0), new Vector3(Math.PI / 2, 0.6, 0));
      }
      tilt.position.set(0, 0.09, 0.2);
      torso.position.set(0, 0, -0.2);
      const fall = topple(ctx, tilt, 'x', Math.PI / 2 - 0.2, 0.9, 0.08);
      await Promise.all([helmetDone, shieldDone, fall]);
    };
    return model;
  };
}

// ------------------------------------------------------------------ archer

const BOW_RADIUS = 0.2;
const BOW_ARC = Math.PI * 0.7;
const STRING_Z = -BOW_RADIUS * Math.cos(BOW_ARC / 2);
const YUMI_RADIUS = BOW_RADIUS * 1.9;
const YUMI_ARC = BOW_ARC * 0.62;

function bowGeometry(k: KitStyle, composite: boolean, yumi = false): Parts {
  // The Japanese yumi is tall and gripped below its middle.
  const arc = new TorusGeometry(yumi ? YUMI_RADIUS : BOW_RADIUS, 0.011, 4, 18, yumi ? YUMI_ARC : BOW_ARC);
  arc.rotateZ(-(yumi ? YUMI_ARC : BOW_ARC) / 2);
  arc.rotateY(Math.PI / 2);
  // Shift the taller arc so its string lines up with the standard one, gripped low.
  if (yumi) arc.translate(0, 0.1, YUMI_RADIUS * Math.cos(YUMI_ARC / 2) + STRING_Z);
  const parts: Parts = [part(arc, composite ? k.color.woodDark : k.color.wood)];
  if (composite) {
    for (const side of [-1, 1]) {
      const tip = new TorusGeometry(0.05, 0.009, 4, 6, Math.PI * 0.6);
      tip.rotateY(Math.PI / 2);
      parts.push(part(tip, k.color.accent, { y: side * BOW_RADIUS * Math.sin(BOW_ARC / 2), z: STRING_Z - 0.04, rx: side > 0 ? 0 : Math.PI }));
    }
  }
  parts.push(part(new BoxGeometry(0.03, 0.06, 0.03), k.color.accent, { z: -BOW_RADIUS }));
  return parts;
}

function wallArc(k: KitStyle): Parts {
  const parts: Parts = [part(lathe([[0, 0], [0.33, 0], [0.31, 0.03], [0, 0.03]], 18), k.color.stoneDark)];
  for (let row = 0; row < 2; row++) {
    const n = row === 0 ? 5 : 4;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.42;
      parts.push(part(new BoxGeometry(0.15, 0.1, 0.09), row === 0 ? k.color.stone : k.color.stoneDark, { x: Math.cos(a) * 0.29, y: 0.08 + row * 0.1, z: Math.sin(a) * 0.29, ry: -a + Math.PI / 2 }));
    }
  }
  parts.push(...moved(ornamentBand(k, k.motifs.ornament, 0.36, k.tint.trim), { y: 0.21, z: -0.3 }));
  return parts;
}

/** Bow or crossbow archer behind a low stone wall; draws, holds and looses. */
export function kitSniper(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const p = k.params;
    const model = new UnitModel('sniper', body);
    const wall = piece(k, body, 'sniper-wall', () => wallArc(k));
    model.add(wall);
    const tilt = new Group();
    const figure = new Group();
    figure.position.y = 0.03;
    figure.add(piece(k, body, 'sniper-figure', () => figureBody(k, 0.92, 'archer')));
    const helmet = piece(k, body, `sniper-helmet-${p.helmet}`, () => headgear(k, p.helmet === 'corinthian' ? 'cap' : p.helmet));
    helmet.position.y = HEAD_Y * 0.92;
    helmet.scale.setScalar(HEAD_SCALE * 0.92);
    figure.add(helmet);

    // Bow held out in front at shoulder height; the string is its own mesh so it can be drawn.
    const bow = new Group();
    bow.position.set(-0.04, 0.36, -0.12);
    const crossbow = p.ranged === 'crossbow';
    if (crossbow) bow.rotation.z = Math.PI / 2;
    bow.add(piece(k, body, `sniper-bow-${p.ranged}`, () => bowGeometry(k, p.ranged === 'composite', p.ranged === 'yumi')));
    const bowString = piece(k, body, 'sniper-string', () => [part(new BoxGeometry(0.006, BOW_RADIUS * 2 * Math.sin(BOW_ARC / 2), 0.006), k.color.rope)]);
    bowString.position.z = STRING_Z;
    if (p.ranged === 'yumi') {
      bowString.scale.y = (YUMI_RADIUS * Math.sin(YUMI_ARC / 2)) / (BOW_RADIUS * Math.sin(BOW_ARC / 2));
      bowString.position.y = 0.1;
    }
    const arrow = piece(k, body, 'sniper-arrow', () => [
      part(new CylinderGeometry(0.006, 0.006, 0.36, 5), k.color.wood, { rx: Math.PI / 2, z: -0.18 }),
      part(new CylinderGeometry(0, 0.016, 0.04, 5), k.color.metal, { rx: -Math.PI / 2, z: -0.37 }),
      part(new BoxGeometry(0.03, 0.002, 0.04), k.tint.trim, { z: 0.0 }),
    ]);
    bowString.add(arrow);
    bow.add(bowString);
    if (crossbow) bow.add(piece(k, body, 'sniper-stock', () => [part(new BoxGeometry(0.04, 0.04, 0.34), k.color.woodDark, { z: -0.06 })]));
    figure.add(bow);
    tilt.add(figure);
    model.add(tilt);

    const phase = Math.random() * 6;
    model.idle = (time) => {
      figure.rotation.y = Math.sin(time * 0.35 + phase) * 0.35;
      // Draw over a second, hold, loose with a snap, then nock a new arrow.
      const cycle = (time * 0.22 + phase) % 1;
      const draw = cycle < 0.25 ? cycle / 0.25 : cycle < 0.6 ? 1 : cycle < 0.62 ? 1 - (cycle - 0.6) / 0.02 : 0;
      bowString.position.z = STRING_Z + draw * 0.13;
      arrow.visible = cycle < 0.61 || cycle > 0.8;
      const breath = Math.sin(time * 1.8 + phase);
      figure.scale.set(1, 1 + breath * 0.012, 1);
    };

    model.wreck = async (ctx) => {
      figure.scale.set(1, 1, 1);
      bowString.position.z = STRING_Z;
      model.attach(bow);
      const side = ctx.random() < 0.5 ? -1 : 1;
      const bowDone = throwPart(ctx, bow, new Vector3(side * 0.42, 0.03, 0.18), 0.55, 0.75, new Vector3(Math.PI * 3, 0, 0), new Vector3(Math.PI / 2, side * 1.2, 0));
      model.attach(helmet);
      const helmetDone = throwPart(ctx, helmet, new Vector3(-side * 0.3, 0.06, 0.3), 0.3, 0.6, new Vector3(4, 1, 2), new Vector3(Math.PI / 2, 0.5, 0));
      tilt.position.set(0, 0.03, -0.12);
      figure.position.set(0, 0, 0.12);
      const slump = topple(ctx, tilt, 'x', -1.0, 0.8, 0.1);
      const spill = lerpTo(ctx, 0.6, (e) => wall.scale.set(1 + e * 0.1, 1 - e * 0.35, 1 + e * 0.1));
      await Promise.all([bowDone, helmetDone, slump, spill]);
    };
    return model;
  };
}

