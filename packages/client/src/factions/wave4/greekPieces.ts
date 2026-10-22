import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Vector3 } from 'three';
import { part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { piece } from '../kit/common';
import { column, figure, figureBody, headOn, moved, shield, weapon, wheel, type Parts } from '../kit/pieces';
import type { KitStyle } from '../kit/style';

// ------------------------------------------------------------------ Macedon

/** One storey of the helepolis: a hide-clad box with iron bands and shuttered ports. */
function storey(k: KitStyle, w: number, d: number, h: number, ports: number): Parts {
  const hide = k.color.secondary.clone().lerp(new Color('#9a7a54'), 0.55);
  const parts: Parts = [
    part(new BoxGeometry(w, h, d), hide, { y: h / 2 }),
    part(new BoxGeometry(w + 0.012, 0.025, d + 0.012), k.color.metalDark, { y: 0.02 }),
    part(new BoxGeometry(w + 0.012, 0.025, d + 0.012), k.color.metalDark, { y: h - 0.02 }),
  ];
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) parts.push(part(new BoxGeometry(0.03, h, 0.03), k.color.woodDark, { x, y: h / 2, z }));
  // Ports on the long faces, their shutters propped open in team colour.
  for (let i = 0; i < ports; i++) {
    const x = -w / 2 + (i + 0.5) * (w / ports);
    for (const s of [-1, 1]) {
      parts.push(part(new BoxGeometry(0.07, 0.08, 0.01), k.color.dark, { x, y: h * 0.55, z: s * (d / 2 + 0.004) }));
      parts.push(part(new BoxGeometry(0.075, 0.012, 0.06), 'main', { x, y: h * 0.55 + 0.05, z: s * (d / 2 + 0.03), rx: s * 0.6 }));
    }
  }
  return parts;
}

/**
 * Helépolis: the great siege tower on eight wheels, four hide-clad storeys
 * with shuttered ports, a stone thrower on the top deck and a crew at the
 * push beams. When struck the upper storeys are thrown down one after the
 * other and the base settles on broken wheels.
 */
export function macedonHelepolis(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('artillery', body);
    const base = new Group();
    base.add(piece(k, body, 'mc-helepolis-chassis', () => {
      const parts: Parts = [part(new BoxGeometry(1.3, 0.1, 0.84), k.color.woodDark, { y: 0.2 })];
      for (const x of [-0.5, -0.17, 0.17, 0.5]) for (const z of [-0.45, 0.45]) parts.push(...moved(wheel(k, 0.16, 8), { x, y: 0.16, z }));
      // Push beams out the back and the crew leaning on them.
      for (const z of [-0.25, 0.25]) {
        parts.push(part(new BoxGeometry(0.5, 0.04, 0.04), k.color.wood, { x: 0.85, y: 0.24, z }));
        parts.push(...moved(figure(k, 0.46, 'soldier', k.params.helmet, null), { x: 1.1, z, ry: Math.PI / 2, rz: 0.25 }));
      }
      return parts;
    }));
    model.add(base);
    const storeys: Group[] = [];
    let y = 0.25;
    const sizes = [[1.0, 0.76, 0.34, 4], [0.84, 0.64, 0.3, 3], [0.68, 0.54, 0.28, 3], [0.52, 0.44, 0.26, 2]] as const;
    sizes.forEach(([w, d, h, ports], i) => {
      const g = new Group();
      g.position.set(0.05, y, 0);
      g.add(piece(k, body, `mc-storey-${i}`, () => storey(k, w, d, h, ports)));
      model.add(g);
      storeys.push(g);
      y += h;
    });
    const top = new Group();
    top.position.set(0.05, y, 0);
    top.add(piece(k, body, 'mc-helepolis-top', () => {
      const parts: Parts = [part(new BoxGeometry(0.56, 0.04, 0.48), k.color.wood, { y: 0.02 })];
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) parts.push(part(new BoxGeometry(0.08, 0.08, 0.03), k.color.wood, { x: -0.21 + i * 0.14, y: 0.08, z: s * 0.225 }));
      // A small stone thrower with its arm cocked.
      parts.push(part(new BoxGeometry(0.2, 0.05, 0.14), k.color.woodDark, { y: 0.07 }));
      parts.push(part(new BoxGeometry(0.03, 0.03, 0.3), k.color.wood, { x: 0.02, y: 0.16, rx: 0.0, ry: Math.PI / 2, rz: 0.9 }));
      parts.push(...moved(figure(k, 0.36, 'officer', k.params.helmet, null), { x: 0.16, y: 0.04, z: 0.1, ry: Math.PI / 2 }));
      return parts;
    }));
    model.add(top);
    storeys.push(top);
    // Drawbridge hinged under the second storey, raised against the front.
    const bridge = new Group();
    bridge.position.set(-0.45, 0.6, 0);
    bridge.add(piece(k, body, 'mc-bridge', () => [part(new BoxGeometry(0.03, 0.42, 0.32), k.color.wood, { y: 0.21 }), part(new BoxGeometry(0.035, 0.05, 0.33), 'main', { y: 0.4 })]));
    model.add(bridge);
    const anchor = new Group();
    anchor.position.set(-0.2, 0.3, 0.15);
    top.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      const sway = Math.sin(time * 0.7 + phase) * 0.006;
      storeys.forEach((s, i) => (s.rotation.x = sway * (i + 1)));
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      await shudder(ctx, model, 0.02, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 1.2, 0)));
      const jobs: Promise<void>[] = [];
      // From the top down: thrown off to alternate sides.
      for (let i = storeys.length - 1; i >= 2; i--) {
        const s = storeys[i]!;
        const side = i % 2 ? 1 : -1;
        const delay = (storeys.length - 1 - i) * 0.18;
        jobs.push(ctx.tweens.wait(delay).then(() => throwPart(ctx, s, new Vector3(side * 0.1 - 0.3 * (storeys.length - i), 0.06, side * (0.55 + 0.1 * i)), 0.25, 0.8, new Vector3(0, 0, 0), new Vector3(side * 1.4, 0.4 * i, 0.3))));
      }
      jobs.push(topple(ctx, bridge, 'z', 1.5, 0.7, 0.2));
      jobs.push(lerpTo(ctx, 0.6, (e) => {
        base.position.y = -e * 0.06;
        base.rotation.x = e * 0.06;
        storeys[0]!.position.y = 0.25 - e * 0.06;
        storeys[1]!.position.y = 0.59 - e * 0.08;
        storeys[1]!.rotation.z = e * 0.15;
      }, 0.5));
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(-0.3, 0.2, 0.5)));
    };
    return model;
  };
}

// ------------------------------------------------------------------ Sparta

const CRIMSON = new Color('#8a1a1a');

/** The crimson cloak over a hoplite's back. */
export function spartanCloak(): Parts {
  return [
    part(new CylinderGeometry(0.17, 0.23, 0.42, 12, 1, true, Math.PI * 0.55, Math.PI * 0.9), CRIMSON, { y: 0.24, ry: Math.PI }),
    part(new CylinderGeometry(0.06, 0.06, 0.03, 8), new Color('#c8a040'), { x: -0.1, y: 0.44, z: -0.05 }),
  ];
}

/** A hoplite behind his shield, spear up: one file of the wall. */
function shieldFile(k: KitStyle, rear: boolean): Parts {
  const man: Parts = [...figureBody(k), ...spartanCloak(), ...headOn(k, 'corinthian'), ...weapon(k, 'spear')];
  if (!rear) man.push(...moved(shield(k, 'lambda'), { x: 0.19, z: -0.12, sx: 1.2, sy: 1.2, sz: 1.2 }));
  return moved(man, { sx: 0.55, sy: 0.55, sz: 0.55 });
}

/**
 * Muralha de Escudos: a curved front of hoplites behind overlapping lambda
 * shields on a low stone step, a second rank behind them and the commander
 * in a crimson cloak. When struck the files rock back and go down like
 * dominoes, shields flat on the ground.
 */
export function spartanShieldWall(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    model.add(piece(k, body, 'sp-wall-ground', () => [
      part(new BoxGeometry(1.84, 0.04, 1.84), k.color.stoneDark, { y: 0.02 }),
      part(new CylinderGeometry(0.95, 0.95, 0.08, 24, 1, false, Math.PI * 0.62, Math.PI * 0.76), k.color.stone, { y: 0.06, z: 0.35 }),
      part(new BoxGeometry(0.5, 0.012, 0.3), k.color.stone.clone().multiplyScalar(0.9), { x: 0.3, y: 0.045, z: 0.55 }),
      ...moved(figure(k, 0.62, 'officer', 'corinthian', 'spear'), { x: 0.3, y: 0.05, z: 0.55 }),
      ...moved(spartanCloak(), { x: 0.3, y: 0.05, z: 0.55, sx: 0.62, sy: 0.62, sz: 0.62 }),
    ]));
    const files: Group[] = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.5 + (i - (n - 1) / 2) * 0.24;
      const holder = new Group();
      holder.position.set(-Math.cos(a) * 0.95, 0.1, 0.35 - Math.sin(a) * 0.95);
      holder.rotation.y = (i - (n - 1) / 2) * 0.24;
      const tilt = new Group();
      tilt.add(piece(k, body, 'sp-file-front', () => shieldFile(k, false)));
      holder.add(tilt);
      model.add(holder);
      files.push(tilt);
    }
    // The rear rank shows only as a hedge of spear points over the shields.
    model.add(piece(k, body, 'sp-wall-spears', () => {
      const parts: Parts = [];
      for (let i = 0; i < 9; i++) {
        const x = -0.72 + i * 0.18;
        const z = 0.05 + Math.abs(x) * 0.25;
        parts.push(part(new CylinderGeometry(0.008, 0.008, 0.9, 5), k.color.woodDark, { x, y: 0.5, z }));
        parts.push(part(new ConeGeometry(0.018, 0.06, 5), k.color.metal, { x, y: 0.98, z }));
      }
      return parts;
    }));
    const anchor = new Group();
    anchor.position.set(0.5, 0.95, 0.65);
    model.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      files.forEach((f, i) => (f.position.y = Math.max(0, Math.sin(time * 1.6 + phase + i * 0.4)) * 0.006));
    };

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, -0.4)));
      const jobs = files.map((f, i) => topple(ctx, f, 'x', -1.4, 0.7, i * 0.09));
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.1, 0.2)));
    };
    return model;
  };
}

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

/** A straight run of a Doric stoa along x, length `len`, columns on its −z face. */
function stoaRun(k: KitStyle, len: number): Parts {
  const parts: Parts = [
    part(new BoxGeometry(len, 0.06, 0.42), k.color.stone, { y: 0.03 }),
    part(new BoxGeometry(len, 0.4, 0.06), k.color.stone.clone().multiplyScalar(0.9), { y: 0.26, z: 0.17 }),
    part(new BoxGeometry(len + 0.04, 0.05, 0.46), k.color.stone, { y: 0.49 }),
    part(new BoxGeometry(len + 0.045, 0.025, 0.465), 'main', { y: 0.47 }),
    part(new BoxGeometry(len + 0.04, 0.05, 0.28), k.tint.roof, { y: 0.55, z: -0.1, rx: -0.25 }),
    part(new BoxGeometry(len + 0.04, 0.05, 0.28), k.tint.roof, { y: 0.55, z: 0.1, rx: 0.25 }),
  ];
  const n = Math.max(2, Math.round(len / 0.16));
  for (let i = 0; i < n; i++) parts.push(...moved(column(k, 'doric', 0.4, 0.03), { x: -len / 2 + (i + 0.5) * (len / n), y: 0.06, z: -0.15 }));
  return parts;
}

/**
 * Ágora: an L-shaped Doric stoa round the square, with a herald on the
 * speaker's step under a crimson banner. When struck the roofs drop and the
 * colonnades fold; the herald steps down.
 */
export function spartanAgora(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const runA = new Group();
    runA.position.set(ANT_A.x - 0.15, 0, (ANT_A.z + ANT_B.z) / 2);
    runA.rotation.y = -Math.PI / 2;
    runA.add(piece(k, body, 'sp-stoa-long', () => stoaRun(k, 1.5)));
    model.add(runA);
    const runB = new Group();
    runB.position.set((ANT_B.x + ANT_C.x) / 2 + 0.2, 0, ANT_C.z + 0.15);
    runB.add(piece(k, body, 'sp-stoa-short', () => stoaRun(k, 0.9)));
    model.add(runB);
    const herald = new Group();
    herald.position.set(ANT_B.x + 0.25, 0, ANT_B.z - 0.15);
    herald.add(piece(k, body, 'sp-bema', () => [
      part(new BoxGeometry(0.26, 0.08, 0.26), k.color.stone, { y: 0.04 }),
      part(new BoxGeometry(0.18, 0.06, 0.18), k.color.stone, { y: 0.11 }),
      ...moved(figure(k, 0.42, 'officer', 'none', null), { y: 0.14, ry: Math.PI * 0.75 }),
      part(new CylinderGeometry(0.008, 0.008, 0.8, 5), k.color.woodDark, { x: 0.1, y: 0.4, z: 0.1 }),
      part(new BoxGeometry(0.005, 0.24, 0.16), CRIMSON, { x: 0.1, y: 0.66, z: 0.19 }),
      part(new ConeGeometry(0.025, 0.06, 6), k.color.accent, { x: 0.1, y: 0.82, z: 0.1 }),
    ]));
    model.add(herald);
    const anchor = new Group();
    anchor.position.set(0.1, 0.78, 0.1);
    herald.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      anchor.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(ANT_A.x, 0.4, 0)));
      const jobs = [runA, runB].map((r, i) => lerpTo(ctx, 0.8, (e) => {
        r.scale.y = 1 - e * 0.6;
        r.rotation.z = (i ? 1 : -1) * e * 0.08;
      }, i * 0.2));
      jobs.push(topple(ctx, herald, 'z', 0.2, 0.5, 0.1));
      await Promise.all(jobs);
      ctx.emit('dust', model.worldOf(new Vector3(ANT_C.x, 0.2, ANT_C.z)));
    };
    return model;
  };
}

