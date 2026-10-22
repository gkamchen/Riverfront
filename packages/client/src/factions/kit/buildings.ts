import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Mesh,
  type Object3D,
} from 'three';
import { lathe, part } from '../../units/parts';
import { Puffs, UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, shudder, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import type { FortStyle, TowerStyle } from '../types';
import { flicker, piece } from './common';
import { column, flame, glowMesh, headgear, moved, ornamentBand, roof, type Parts } from './pieces';
import type { KitStyle } from './style';

// ------------------------------------------------------------------ antenna (L of 3)

const ANT_A = new Vector3(-1 / 3, 0, -2 / 3);
const ANT_B = new Vector3(-1 / 3, 0, 1 / 3);
const ANT_C = new Vector3(2 / 3, 0, 1 / 3);

interface TowerShape {
  lower: Parts;
  /** Built from its own base (y = 0 at `split`). */
  upper: Parts;
  split: number;
  /** Height of the fire / light above `split`, or null. */
  fire: number | null;
  top: number;
}

function towerShape(k: KitStyle, style: TowerStyle): TowerShape {
  const stone = k.color.stone;
  const dark = k.color.stoneDark;
  switch (style) {
    case 'obelisk':
      return {
        lower: [
          part(new BoxGeometry(0.46, 0.08, 0.46), dark, { y: 0.04 }),
          part(new CylinderGeometry(0.15, 0.19, 0.66, 4), stone, { y: 0.41, ry: Math.PI / 4 }),
          part(new BoxGeometry(0.03, 0.5, 0.012), 'glow', { y: 0.42, z: -0.12 }),
        ],
        upper: [
          part(new CylinderGeometry(0.11, 0.15, 0.62, 4), stone, { y: 0.31, ry: Math.PI / 4 }),
          part(new BoxGeometry(0.025, 0.45, 0.012), 'glow', { y: 0.3, z: -0.092 }),
          part(new ConeGeometry(0.11, 0.14, 4), k.color.accent, { y: 0.69, ry: Math.PI / 4 }),
        ],
        split: 0.74,
        fire: null,
        top: 1.5,
      };
    case 'lighthouse':
      return {
        lower: [part(new BoxGeometry(0.5, 0.48, 0.5), stone, { y: 0.24 }), part(new BoxGeometry(0.54, 0.04, 0.54), k.tint.trim, { y: 0.5 }), part(new CylinderGeometry(0.2, 0.22, 0.24, 8), stone, { y: 0.64 })],
        upper: [
          part(new CylinderGeometry(0.17, 0.2, 0.24, 8), stone, { y: 0.12 }),
          part(new CylinderGeometry(0.13, 0.15, 0.22, 12), dark, { y: 0.35 }),
          ...[0, 1, 2, 3, 4, 5].map((i) => part(new BoxGeometry(0.02, 0.16, 0.02), k.color.metal, { x: Math.cos(i) * 0.12, y: 0.55, z: Math.sin(i) * 0.12 })),
          part(new SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), k.tint.roof, { y: 0.63 }),
        ],
        split: 0.76,
        fire: 0.5,
        top: 1.55,
      };
    case 'pagoda': {
      const tier = (y: number, s: number): Parts => [part(new BoxGeometry(0.34 * s, 0.22, 0.34 * s), k.color.wood, { y: y + 0.11 }), ...moved(roof(k, 'pagoda', 0.5 * s, 0.5 * s), { y: y + 0.2, sy: 0.5 })];
      return { lower: [...tier(0, 1.1), ...tier(0.32, 1)], upper: [...tier(0, 0.9), ...tier(0.3, 0.8), part(new ConeGeometry(0.02, 0.25, 6), k.color.accent, { y: 0.7 })], split: 0.64, fire: null, top: 1.5 };
    }
    case 'spire':
      return {
        lower: [part(new CylinderGeometry(0.16, 0.2, 0.8, 12), stone, { y: 0.4 }), ...moved(ornamentBand(k, k.motifs.ornament, 0.3, k.tint.trim), { y: 0.6, z: -0.17 })],
        upper: [
          part(new CylinderGeometry(0.22, 0.18, 0.06, 12), k.tint.trim, { y: 0.03 }),
          part(new CylinderGeometry(0.12, 0.14, 0.4, 12), stone, { y: 0.26 }),
          part(new CylinderGeometry(0.17, 0.14, 0.05, 12), k.color.accent, { y: 0.48 }),
          part(new ConeGeometry(0.13, 0.26, 12), k.tint.roof, { y: 0.63 }),
          part(new SphereGeometry(0.025, 6, 4), k.color.accent, { y: 0.78 }),
        ],
        split: 0.8,
        fire: null,
        top: 1.6,
      };
    case 'stele':
      return {
        lower: [part(new BoxGeometry(0.5, 0.1, 0.3), dark, { y: 0.05 }), part(new BoxGeometry(0.36, 0.55, 0.12), stone, { y: 0.37 })],
        upper: [
          part(new BoxGeometry(0.34, 0.45, 0.11), stone, { y: 0.22 }),
          part(new CylinderGeometry(0.17, 0.17, 0.11, 14, 1, false, -Math.PI / 2, Math.PI), stone, { y: 0.45, rx: Math.PI / 2, ry: Math.PI / 2 }),
          part(new CylinderGeometry(0.07, 0.07, 0.02, 14), 'glow', { y: 0.38, z: -0.06, rx: Math.PI / 2 }),
          ...moved(ornamentBand(k, k.motifs.ornament, 0.3), { y: 0.1, z: -0.06 }),
        ],
        split: 0.64,
        fire: null,
        top: 1.3,
      };
    case 'watchtower':
      return {
        lower: [
          part(new BoxGeometry(0.44, 0.7, 0.44), stone, { y: 0.35 }),
          part(new BoxGeometry(0.06, 0.16, 0.01), k.color.dark, { y: 0.45, z: -0.225 }),
          ...moved(ornamentBand(k, k.motifs.ornament, 0.36, k.tint.trim), { y: 0.66, z: -0.225 }),
        ],
        upper: [
          part(new BoxGeometry(0.42, 0.3, 0.42), stone, { y: 0.15 }),
          part(new BoxGeometry(0.54, 0.05, 0.54), dark, { y: 0.32 }),
          ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(new BoxGeometry(0.08, 0.1, 0.08), stone, { x: sx * 0.23, y: 0.39, z: sz * 0.23 }))),
          ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(new CylinderGeometry(0.012, 0.012, 0.28, 5), k.color.wood, { x: sx * 0.2, y: 0.48, z: sz * 0.2 }))),
          ...moved(roof(k, k.motifs.roof === 'flat' ? 'pyramid' : k.motifs.roof, 0.48, 0.48), { y: 0.62 }),
        ],
        split: 0.7,
        fire: 0.36,
        top: 1.5,
      };
  }
}

function hut(k: KitStyle): Parts {
  return [
    part(new BoxGeometry(0.5, 0.3, 0.44), k.color.stone, { y: 0.15 }),
    part(new BoxGeometry(0.13, 0.2, 0.01), k.color.dark, { x: -0.1, y: 0.1, z: -0.225 }),
    ...moved(ornamentBand(k, k.motifs.ornament, 0.44, k.tint.trim), { y: 0.27, z: -0.225 }),
    ...moved(roof(k, k.motifs.roof, 0.5, 0.44), { y: 0.3 }),
  ];
}

function brazier(k: KitStyle): Parts {
  return [
    ...[0, 1, 2].map((i) => part(new CylinderGeometry(0.01, 0.012, 0.22, 5), k.color.metal, { x: Math.cos(i * 2.1) * 0.07, y: 0.1, z: Math.sin(i * 2.1) * 0.07, rz: Math.cos(i * 2.1) * 0.15, rx: -Math.sin(i * 2.1) * 0.15 })),
    part(lathe([[0, 0], [0.08, 0.01], [0.11, 0.06], [0.1, 0.065], [0, 0.03]], 12), k.color.metal, { y: 0.2 }),
    part(new SphereGeometry(0.06, 8, 6), 'glow', { y: 0.24, sy: 0.4 }),
  ];
}

/** Lookout on the L: a tower (by kit style), a small house and a brazier. */
export function kitAntenna(k: KitStyle, style: TowerStyle = k.params.tower): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('antenna', body);
    const shape = towerShape(k, style);
    model.add(moveTo(piece(k, body, 'antenna-hut', () => hut(k)), ANT_A));
    const camp = moveTo(piece(k, body, 'antenna-brazier', () => [...brazier(k), part(new BoxGeometry(0.16, 0.12, 0.14), k.color.woodDark, { x: 0.2, y: 0.06, z: 0.12 })]), ANT_C);
    model.add(camp);
    const campFlames = [flame(0.8), flame(0.6)];
    campFlames.forEach((f, i) => {
      f.position.set(ANT_C.x + (i ? 0.03 : -0.02), 0.28 + f.position.y, ANT_C.z + (i ? 0.02 : 0));
      model.add(f);
    });

    const tower = new Group();
    tower.position.copy(ANT_B);
    tower.add(piece(k, body, `antenna-lower-${style}`, () => shape.lower));
    const upper = new Group();
    upper.position.y = shape.split;
    upper.add(piece(k, body, `antenna-upper-${style}`, () => shape.upper));
    tower.add(upper);
    model.add(tower);
    const topFlames: Object3D[] = [];
    if (shape.fire !== null) {
      for (let i = 0; i < 3; i++) {
        const f = flame(style === 'lighthouse' ? 1.1 : 0.8);
        f.position.set((i - 1) * 0.04, shape.fire + f.position.y, (i % 2) * 0.03);
        upper.add(f);
        topFlames.push(f);
      }
    }
    if (style === 'lighthouse') {
      const light = glowMesh(new SphereGeometry(0.07, 10, 8));
      light.position.y = shape.fire! + 0.06;
      upper.add(light);
      topFlames.push(light);
    }
    const anchor = new Group();
    anchor.position.set(0.12, shape.top - shape.split - 0.25, 0.12);
    upper.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    let alive = true;
    model.idle = (time) => {
      if (!alive) return;
      flicker(campFlames, time + phase, 1);
      flicker(topFlames, time + phase * 2, style === 'lighthouse' ? 1.1 : 0.9);
    };

    model.wreck = async (ctx) => {
      alive = false;
      ctx.emit('sparks', model.worldOf(new Vector3(ANT_B.x, shape.top, ANT_B.z)));
      for (const f of [...topFlames, ...campFlames]) f.visible = false;
      ctx.emit('smoke', model.worldOf(new Vector3(ANT_C.x, 0.3, ANT_C.z)));
      const buckle = lerpTo(ctx, 0.25, (e) => (upper.rotation.x = 0.06 * e)).then(() => topple(ctx, upper, 'z', -1.3, 0.95));
      const shake = shudder(ctx, camp, 0.03, 0.25);
      await Promise.all([buckle, shake]);
      ctx.emit('dust', model.worldOf(new Vector3(ANT_C.x, 0.1, ANT_C.z)));
    };
    return model;
  };
}

function moveTo<T extends Object3D>(object: T, at: Vector3): T {
  object.position.add(at);
  return object;
}

// ------------------------------------------------------------------ bunker (2x2)

const B_HALF = 0.88;

/** Fortress of the faction: walls, pyramid, dome, shield dome, acropolis... */
export function kitBunker(k: KitStyle, style: FortStyle = k.params.fort): UnitFactory {
  switch (style) {
    case 'pyramid':
      return pyramidFort(k);
    case 'dome':
      return domeFort(k, false);
    case 'testudo':
      return domeFort(k, true);
    case 'acropolis':
      return acropolisFort(k);
    case 'stepped':
    case 'ziggurat':
      return steppedFort(k, style);
    case 'walls':
    case 'palisade':
      return wallFort(k, style);
  }
}

function wallFort(k: KitStyle, style: 'walls' | 'palisade'): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const palisade = style === 'palisade';
    const H = palisade ? 0.5 : 0.42;
    const T = 0.14;
    const wallParts = (len: number, front: boolean): Parts => {
      const parts: Parts = [];
      if (palisade) {
        const n = Math.round(len / 0.11);
        for (let i = 0; i < n; i++) {
          const x = -len / 2 + (i + 0.5) * (len / n);
          if (front && Math.abs(x) < 0.12) continue;
          parts.push(part(new CylinderGeometry(0.045, 0.05, H, 6), i % 2 ? k.color.wood : k.color.woodDark, { x, y: H / 2 }));
          parts.push(part(new ConeGeometry(0.045, 0.08, 6), k.color.woodDark, { x, y: H + 0.04 }));
        }
        parts.push(part(new BoxGeometry(len, 0.04, 0.03), k.tint.trim, { y: H * 0.6, z: -0.05 }));
      } else {
        parts.push(part(new BoxGeometry(len, H, T), k.color.stone, { y: H / 2 }));
        for (let i = 0; i < 7; i++) parts.push(part(new BoxGeometry(0.11, 0.08, T + 0.01), k.color.stone, { x: -len / 2 + 0.08 + i * ((len - 0.16) / 6), y: H + 0.04 }));
        parts.push(part(new BoxGeometry(len + 0.01, 0.035, T + 0.012), k.tint.trim, { y: H - 0.04 }));
        if (front) {
          parts.push(part(new BoxGeometry(0.24, 0.28, 0.02), k.color.dark, { y: 0.14, z: -T / 2 - 0.005 }));
          parts.push(...moved(ornamentBand(k, k.motifs.ornament, len * 0.6), { y: H - 0.1, z: -T / 2 - 0.01 }));
        }
      }
      return parts;
    };
    // Each wall pivots on its own footing line so it can fall outwards.
    const wall = (key: string, front: boolean, x: number, z: number, ry: number) => {
      const holder = new Group();
      holder.position.set(x, 0, z);
      holder.add(piece(k, body, `bunker-${style}-${key}`, () => moved(wallParts(B_HALF * 2 - 0.2, front), { ry })));
      model.add(holder);
      return holder;
    };
    const front = wall('front', true, 0, -B_HALF + T / 2, 0);
    const back = wall('back', false, 0, B_HALF - T / 2, 0);
    const left = wall('side', false, -B_HALF + T / 2, 0, Math.PI / 2);
    const right = wall('side', false, B_HALF - T / 2, 0, Math.PI / 2);

    const towers: Mesh[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const t = piece(k, body, `bunker-${style}-tower`, () =>
          palisade
            ? [part(new CylinderGeometry(0.06, 0.06, 0.72, 6), k.color.wood, { y: 0.36 }), part(new BoxGeometry(0.22, 0.04, 0.22), k.color.woodDark, { y: 0.66 }), ...moved(roof(k, 'tent', 0.24, 0.24), { y: 0.7 })]
            : [part(new CylinderGeometry(0.14, 0.15, 0.6, 10), k.color.stone, { y: 0.3 }), part(new CylinderGeometry(0.16, 0.16, 0.05, 10), k.tint.trim, { y: 0.6 }), ...moved(roof(k, k.motifs.roof === 'dome' ? 'dome' : 'conical', 0.3, 0.3), { y: 0.625 })],
        );
        t.position.set(sx * (B_HALF - 0.08), 0, sz * (B_HALF - 0.08));
        model.add(t);
        towers.push(t);
      }
    }
    const keep = piece(k, body, `bunker-${style}-keep`, () => [part(new BoxGeometry(0.62, 0.4, 0.62), palisade ? k.color.woodDark : k.color.stoneDark, { y: 0.2 }), part(new BoxGeometry(0.3, 0.03, 0.02), 'glow', { y: 0.3, z: -0.32 })]);
    model.add(keep);
    const keepRoof = piece(k, body, `bunker-${style}-keeproof`, () => roof(k, palisade ? 'tent' : k.motifs.roof, 0.66, 0.66));
    keepRoof.position.y = 0.4;
    model.add(keepRoof);
    const anchor = new Group();
    anchor.position.set(0.1, 1.05, 0.1);
    const pole = piece(k, body, 'bunker-pole', () => [part(new CylinderGeometry(0.01, 0.012, 0.7, 6), k.color.wood, { y: 0.35 })]);
    pole.position.set(0.1, 0.4, 0.1);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.04, 0.22);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      anchor.visible = false;
      model.attach(keepRoof);
      const roofOff = throwPart(ctx, keepRoof, new Vector3(0.75, 0.03, -1.05), 0.6, 0.85, new Vector3(2, 3, 1), new Vector3(0.3, 2, Math.PI * 0.9));
      const tip = 1.3 + ctx.random() * 0.15;
      const walls = [topple(ctx, front, 'x', -tip, 0.8), topple(ctx, right, 'z', -tip * 0.92, 0.85, 0.08), topple(ctx, back, 'x', tip * 0.95, 0.85, 0.14), topple(ctx, left, 'z', tip, 0.9, 0.05)];
      const sink = lerpTo(ctx, 0.7, (e) => {
        towers.forEach((t, i) => {
          t.scale.y = 1 - e * (0.55 + i * 0.08);
          t.rotation.z = (i % 2 ? 1 : -1) * e * 0.2;
        });
        keep.scale.y = 1 - 0.7 * e;
        pole.rotation.z = e * 1.2;
      }, 0.1);
      await Promise.all([roofOff, sink, ...walls]);
    };
    return model;
  };
}

function pyramidFort(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const half = 0.84;
    const height = 1.0;
    const slices = 4;
    const capAt = 0.82;
    model.add(piece(k, body, 'pyramid-base', () => [
      part(new BoxGeometry(1.78, 0.05, 1.78), k.color.stoneDark, { y: 0.025 }),
      part(new BoxGeometry(1.72, 0.03, 1.72), k.tint.trim, { y: 0.06 }),
      part(new BoxGeometry(0.16, 0.16, 0.05), k.color.dark, { y: 0.15, z: -half + 0.1 }),
    ]));
    const layers: Mesh[] = [];
    for (let i = 0; i < slices; i++) {
      const y0 = 0.05 + (capAt - 0.05) * (i / slices);
      const y1 = 0.05 + (capAt - 0.05) * ((i + 1) / slices);
      const r0 = half * (1 - (y0 - 0.05) / (height - 0.05)) * Math.SQRT2;
      const r1 = half * (1 - (y1 - 0.05) / (height - 0.05)) * Math.SQRT2;
      const layer = piece(k, body, `pyramid-layer-${i}`, () => [
        part(new CylinderGeometry(r1, r0, y1 - y0, 4), i % 2 ? k.color.stone : k.color.stone.clone().multiplyScalar(0.94), { y: (y1 - y0) / 2, ry: Math.PI / 4 }),
        ...(i === 1 ? moved(ornamentBand(k, k.motifs.ornament, r1 * 1.1, k.tint.trim), { y: 0.02, z: -(r0 + r1) / 2 / Math.SQRT2 - 0.01 }) : []),
      ]);
      layer.position.y = y0;
      model.add(layer);
      layers.push(layer);
    }
    const capR = half * (1 - (capAt - 0.05) / (height - 0.05)) * Math.SQRT2;
    const cap = piece(k, body, 'pyramid-cap', () => [part(new ConeGeometry(capR, height - capAt, 4), k.color.accent, { y: (height - capAt) / 2, ry: Math.PI / 4 })]);
    cap.position.y = capAt;
    model.add(cap);
    const anchor = new Group();
    anchor.position.set(half - 0.05, 0.62, -half + 0.05);
    const pole = piece(k, body, 'pyramid-pole', () => [part(new CylinderGeometry(0.01, 0.012, 0.56, 6), k.color.wood, { y: 0.28 })]);
    pole.position.set(half - 0.05, 0.08, -half + 0.05);
    model.add(pole, anchor);
    model.flagAnchor = anchor;
    const glint = glowMesh(new SphereGeometry(0.08, 10, 8));
    glint.position.y = height + 0.02;
    glint.visible = false;
    model.add(glint);

    const phase = Math.random() * 6;
    model.idle = (time) => {
      // The gilded capstone catches the sun now and then.
      const g = Math.max(0, Math.sin(time * 0.6 + phase) - 0.96) * 25;
      glint.visible = g > 0.02;
      glint.scale.setScalar(0.3 + g * 0.5);
    };

    model.wreck = async (ctx) => {
      // Capstone flash, then the courses slump from the top down.
      glint.visible = true;
      ctx.emit('arc', model.worldOf(new Vector3(0, height, 0)));
      await ctx.tweens.run(0.3, (t) => glint.scale.setScalar(0.5 + t * 3.5));
      glint.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(0, height, 0)));
      model.attach(cap);
      const capOff = throwPart(ctx, cap, new Vector3(0.95, 0.06, -0.6), 0.7, 0.9, new Vector3(3, 2, 2), new Vector3(Math.PI * 0.6, 1.4, 0.8));
      pole.visible = false;
      anchor.visible = false;
      const slump = layers
        .slice()
        .reverse()
        .map((layer, i) => {
          const y0 = layer.position.y;
          return lerpTo(ctx, 0.55, (e) => {
            layer.scale.set(1 + e * 0.12, 1 - e * 0.45, 1 + e * 0.12);
            layer.position.y = y0 - e * (0.06 + (layers.length - i) * 0.04);
          }, i * 0.12);
        });
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      await Promise.all([capOff, ...slump]);
    };
    return model;
  };
}

function domeFort(k: KitStyle, shields: boolean): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const R = 0.78;
    const drumH = shields ? 0.06 : 0.3;
    const drum = piece(k, body, `dome-drum-${shields}`, () =>
      shields
        ? [part(new CylinderGeometry(R, R + 0.04, drumH, 24), k.color.stoneDark, { y: drumH / 2 })]
        : [
            part(new CylinderGeometry(R, R + 0.05, drumH, 24), k.color.stone, { y: drumH / 2 }),
            ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => part(new BoxGeometry(0.08, 0.14, 0.03), k.color.dark, { x: Math.sin((i / 8) * Math.PI * 2) * (R + 0.005), y: 0.15, z: -Math.cos((i / 8) * Math.PI * 2) * (R + 0.005), ry: -(i / 8) * Math.PI * 2 })),
            part(new TorusGeometry(R + 0.01, 0.018, 4, 32), k.tint.trim, { rx: Math.PI / 2, y: drumH - 0.02 }),
          ],
    );
    model.add(drum);
    const sectors = 8;
    const wedges: Mesh[] = [];
    for (let i = 0; i < sectors; i++) {
      const phi = (i / sectors) * Math.PI * 2;
      const wedge = piece(k, body, `dome-wedge-${shields}-${i}`, () => {
        if (!shields) return [part(new SphereGeometry(R, 6, 8, phi, (Math.PI * 2) / sectors, 0, Math.PI / 2), k.tint.roof), part(new SphereGeometry(R + 0.006, 2, 8, phi, 0.03, 0, Math.PI / 2), k.color.accent)];
        // Overlapping rectangular shields laid on the dome, in rows.
        const parts: Parts = [part(new SphereGeometry(R - 0.03, 4, 6, phi, (Math.PI * 2) / sectors, 0, Math.PI / 2), k.color.dark)];
        for (let row = 0; row < 4; row++) {
          // theta: elevation above the rim; each shield lies tangent to the dome.
          const theta = 0.22 + row * 0.36;
          const perRow = row === 3 ? 1 : 2;
          for (let j = 0; j < perRow; j++) {
            const a = sectorAngle(phi + ((j + 0.5) / perRow) * ((Math.PI * 2) / sectors));
            const x = Math.sin(a) * Math.cos(theta) * R;
            const z = Math.cos(a) * Math.cos(theta) * R;
            const y = Math.sin(theta) * R;
            const plate = new BoxGeometry(0.26, 0.3, 0.03);
            plate.rotateX(-theta);
            plate.rotateY(a);
            parts.push(part(plate, k.tint.shield, { x, y, z }));
            parts.push(part(new SphereGeometry(0.03, 6, 4), k.color.accent, { x: x * 1.04, y: y * 1.04, z: z * 1.04 }));
          }
        }
        return parts;
      });
      wedge.position.y = drumH;
      model.add(wedge);
      wedges.push(wedge);
    }
    // Soldiers peeking out from under the front shields.
    const peek = shields ? piece(k, body, 'testudo-faces', () => [-0.3, 0, 0.3].flatMap((x) => [part(new SphereGeometry(0.07, 10, 8), k.color.skin, { x, y: 0.12, z: -R + 0.03 }), ...moved(headgear(k, k.params.helmet), { x, y: 0.13, z: -R + 0.03, sx: 0.8, sy: 0.8, sz: 0.8 })])) : null;
    if (peek) model.add(peek);
    const lantern = piece(k, body, `dome-lantern-${shields}`, () =>
      shields ? [part(new CylinderGeometry(0.012, 0.014, 0.45, 6), k.color.wood, { y: 0.22 }), part(new SphereGeometry(0.04, 8, 6), k.color.accent, { y: 0.47 })] : [part(new CylinderGeometry(0.1, 0.12, 0.14, 10), k.color.stone, { y: 0.07 }), part(new ConeGeometry(0.12, 0.16, 10), k.tint.roof, { y: 0.22 }), part(new SphereGeometry(0.03, 6, 4), k.color.accent, { y: 0.32 })],
    );
    lantern.position.y = drumH + R - 0.02;
    model.add(lantern);
    const anchor = new Group();
    anchor.position.set(0, drumH + R + 0.4, 0);
    model.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      if (!shields) return;
      // The shield wall breathes a little, like men shifting their grip.
      wedges.forEach((w, i) => (w.position.y = drumH + Math.max(0, Math.sin(time * 1.3 + i * 0.8 + phase)) * 0.006));
    };

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.035, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.3, 0)));
      anchor.visible = false;
      // The dome bursts: each sector flies outwards and lands around the base.
      const shards = wedges.map((w, i) => {
        const a = sectorAngle(((i + 0.5) / sectors) * Math.PI * 2);
        const out = new Vector3(Math.sin(a) * 0.55, -drumH - (shields ? 0.2 : 0.35), Math.cos(a) * 0.55);
        return throwPart(ctx, w, w.position.clone().add(out), 0.5 + ctx.random() * 0.3, 0.8 + ctx.random() * 0.2, new Vector3(0, 0, 0), new Vector3(Math.cos(a) * 0.9, ctx.random() * 0.6, -Math.sin(a) * 0.9));
      });
      model.attach(lantern);
      const top = throwPart(ctx, lantern, new Vector3(0.6, 0.05, -0.9), 0.8, 0.9, new Vector3(3, 2, 1), new Vector3(Math.PI / 2, 1, 0));
      const sink = lerpTo(ctx, 0.6, (e) => {
        drum.scale.y = 1 - e * 0.6;
        if (peek) {
          peek.rotation.x = e * 1.3;
          peek.position.y = -e * 0.05;
        }
      }, 0.15);
      await Promise.all([...shards, top, sink]);
    };
    return model;
  };
}

/** Sphere segments measure azimuth from −x; this turns it into atan2(x, z) form. */
function sectorAngle(phi: number): number {
  return phi - Math.PI / 2;
}

function acropolisFort(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const hillH = 0.24;
    const hill = piece(k, body, 'acropolis-hill', () => {
      const parts: Parts = [part(new BoxGeometry(1.7, 0.08, 1.7), k.color.stoneDark, { y: 0.04 })];
      const seeds = [[-0.55, -0.5], [0.5, -0.55], [-0.6, 0.45], [0.55, 0.5], [0, -0.6], [0, 0.6], [-0.65, 0], [0.65, 0], [0, 0]];
      seeds.forEach(([x, z], i) => parts.push(part(new DodecahedronGeometry(0.42, 0), k.color.stoneDark.clone().multiplyScalar(0.9 + (i % 3) * 0.06), { x: x!, y: 0.08, z: z!, sy: 0.38, ry: i })));
      parts.push(part(new BoxGeometry(1.36, 0.06, 1.0), k.color.stone, { y: hillH + 0.03 }));
      parts.push(part(new BoxGeometry(1.24, 0.05, 0.88), k.color.stone, { y: hillH + 0.085 }));
      // Steps up the front of the rock.
      for (let i = 0; i < 4; i++) parts.push(part(new BoxGeometry(0.34, 0.06, 0.1), k.color.stone, { y: 0.03 + i * 0.06, z: -0.8 + i * 0.09 }));
      return parts;
    });
    model.add(hill);
    const base = hillH + 0.11;
    const colH = 0.5;
    const cols: Group[] = [];
    const xs = [-0.5, -0.25, 0, 0.25, 0.5];
    const spots: Array<[number, number]> = [...xs.map((x): [number, number] => [x, -0.34]), ...xs.map((x): [number, number] => [x, 0.34]), [-0.5, 0], [0.5, 0]];
    for (const [x, z] of spots) {
      const c = piece(k, body, 'acropolis-column', () => column(k, k.motifs.column === 'none' ? 'doric' : k.motifs.column, colH, 0.045));
      const g = new Group();
      g.position.set(x, base, z);
      g.add(c);
      model.add(g);
      cols.push(g);
    }
    const cella = piece(k, body, 'acropolis-cella', () => [part(new BoxGeometry(0.66, colH * 0.92, 0.42), k.color.stone.clone().multiplyScalar(0.9), { y: colH * 0.46 }), part(new BoxGeometry(0.14, 0.26, 0.01), k.color.dark, { y: 0.13, z: -0.215 })]);
    cella.position.y = base;
    model.add(cella);
    const roofPiece = piece(k, body, 'acropolis-roof', () => [
      part(new BoxGeometry(1.24, 0.08, 0.86), k.color.stone, { y: 0.04 }),
      ...moved(ornamentBand(k, k.motifs.ornament, 1.1, k.tint.trim), { y: 0.04, z: -0.435 }),
      ...moved(roof(k, 'gable', 1.2, 0.84), { y: 0.08 }),
    ]);
    roofPiece.position.y = base + colH;
    model.add(roofPiece);
    const anchor = new Group();
    anchor.position.set(0.72, 0.85, 0.7);
    const pole = piece(k, body, 'acropolis-pole', () => [part(new CylinderGeometry(0.01, 0.012, 0.72, 6), k.color.wood, { y: 0.36 })]);
    pole.position.set(0.72, 0.15, 0.7);
    model.add(pole, anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.03, 0.2);
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.5, 0)));
      anchor.visible = false;
      // Columns topple outwards one after another; the roof drops onto the cella.
      const falls = cols.map((c, i) => {
        const [x, z] = spots[i]!;
        const axis = Math.abs(z) > 0.2 ? 'x' : 'z';
        const angle = axis === 'x' ? (z < 0 ? -1.45 : 1.45) : x < 0 ? 1.45 : -1.45;
        return topple(ctx, c, axis, angle * (0.85 + ctx.random() * 0.2), 0.8, 0.15 + i * 0.05);
      });
      const roofDrop = lerpTo(ctx, 0.7, (e) => {
        roofPiece.position.y = base + colH - e * (colH * 0.55);
        roofPiece.rotation.z = e * 0.18;
        roofPiece.rotation.x = -e * 0.1;
        cella.scale.y = 1 - e * 0.5;
        pole.rotation.z = -e * 1.3;
      }, 0.35);
      await Promise.all([...falls, roofDrop]);
    };
    return model;
  };
}

function steppedFort(k: KitStyle, style: 'stepped' | 'ziggurat'): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('bunker', body);
    const tiers: Mesh[] = [];
    const count = style === 'stepped' ? 4 : 3;
    const tierH = style === 'stepped' ? 0.17 : 0.22;
    for (let i = 0; i < count; i++) {
      const w = 1.72 - i * (style === 'stepped' ? 0.32 : 0.42);
      const d = style === 'stepped' ? w : w * 0.85;
      const t = piece(k, body, `${style}-tier-${i}`, () => [
        part(new BoxGeometry(w, tierH, d), i % 2 ? k.color.stone : k.color.stoneDark, { y: tierH / 2 }),
        part(new BoxGeometry(w + 0.01, 0.025, d + 0.01), k.tint.trim, { y: tierH - 0.02 }),
        ...(i === 0 ? moved(ornamentBand(k, k.motifs.ornament, w * 0.8), { y: tierH * 0.5, z: -d / 2 - 0.01 }) : []),
      ]);
      t.position.y = i * tierH;
      model.add(t);
      tiers.push(t);
    }
    const stair = piece(k, body, `${style}-stair`, () => [part(new BoxGeometry(0.3, 0.05, count * tierH * 1.6), k.color.stone, { y: (count * tierH) / 2, z: -0.55, rx: -Math.atan2(count * tierH, 0.8) })]);
    model.add(stair);
    const shrine = piece(k, body, `${style}-shrine`, () => [
      part(new BoxGeometry(0.42, 0.26, 0.36), k.color.stone, { y: 0.13 }),
      part(new BoxGeometry(0.12, 0.18, 0.01), k.color.dark, { y: 0.09, z: -0.185 }),
      part(new BoxGeometry(0.3, 0.03, 0.02), 'glow', { y: 0.22, z: -0.185 }),
      ...moved(roof(k, k.motifs.roof, 0.46, 0.4), { y: 0.26 }),
    ]);
    shrine.position.y = count * tierH;
    model.add(shrine);
    const anchor = new Group();
    anchor.position.set(0.15, count * tierH + 0.75, 0.1);
    model.add(anchor);
    model.flagAnchor = anchor;

    model.wreck = async (ctx) => {
      await shudder(ctx, model, 0.03, 0.2);
      anchor.visible = false;
      ctx.emit('sparks', model.worldOf(new Vector3(0, count * tierH + 0.3, 0)));
      model.attach(shrine);
      const top = throwPart(ctx, shrine, new Vector3(0.7, 0.05, -0.85), 0.6, 0.9, new Vector3(2, 2, 1), new Vector3(0.4, 1.4, Math.PI / 2));
      const sink = tiers
        .slice()
        .reverse()
        .map((t, i) => lerpTo(ctx, 0.5, (e) => {
          t.scale.set(1 + e * 0.06, 1 - e * 0.5, 1 + e * 0.06);
          t.position.y = (count - 1 - i) * tierH * (1 - e * 0.5);
        }, i * 0.1));
      const stairs = lerpTo(ctx, 0.5, (e) => (stair.scale.y = 1 - e * 0.5));
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      await Promise.all([top, stairs, ...sink]);
    };
    return model;
  };
}

// ------------------------------------------------------------------ generator (1x1 shrine)

/** Sacred source of energy: flame, orb, sun disc, crystal, tripod or scarab. */
export function kitGenerator(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const style = k.params.shrine;
    const model = new UnitModel('generator', body);
    const plinth = piece(k, body, 'shrine-plinth', () => [
      part(new BoxGeometry(0.72, 0.05, 0.72), k.color.stoneDark, { y: 0.025 }),
      part(new BoxGeometry(0.56, 0.12, 0.56), k.color.stone, { y: 0.11 }),
      part(new BoxGeometry(0.6, 0.025, 0.6), k.tint.trim, { y: 0.18 }),
      ...moved(ornamentBand(k, k.motifs.ornament, 0.5), { y: 0.11, z: -0.285 }),
    ]);
    model.add(plinth);
    const element = new Group();
    element.position.y = 0.19;
    model.add(element);
    const spinner = new Group();
    element.add(spinner);
    const flames: Object3D[] = [];
    let puffs: Puffs | null = null;

    switch (style) {
      case 'flame':
        element.add(piece(k, body, 'shrine-bowl', () => [
          part(new CylinderGeometry(0.06, 0.09, 0.16, 10), k.color.stone, { y: 0.08 }),
          part(lathe([[0, 0], [0.12, 0.01], [0.17, 0.08], [0.16, 0.09], [0, 0.04]], 14), k.color.metal, { y: 0.16 }),
          part(new SphereGeometry(0.1, 10, 6), 'glow', { y: 0.2, sy: 0.35 }),
        ]));
        for (let i = 0; i < 4; i++) {
          const f = flame(i === 0 ? 1.3 : 0.9);
          f.position.set(Math.cos(i * 1.7) * 0.05 * (i ? 1 : 0), 0.22 + f.position.y, Math.sin(i * 1.7) * 0.05 * (i ? 1 : 0));
          element.add(f);
          flames.push(f);
        }
        break;
      case 'orb':
        element.add(piece(k, body, 'shrine-pedestal', () => [part(new CylinderGeometry(0.05, 0.08, 0.2, 10), k.color.stone, { y: 0.1 }), part(lathe([[0, 0], [0.09, 0.0], [0.1, 0.03], [0, 0.03]], 12), k.color.accent, { y: 0.2 })]));
        spinner.position.y = 0.38;
        spinner.add(piece(k, body, 'shrine-orb', () => [part(new SphereGeometry(0.1, 16, 12), 'glow'), part(new TorusGeometry(0.15, 0.01, 6, 24), k.color.accent, { rx: 1.2 })]));
        break;
      case 'sun':
        element.add(piece(k, body, 'shrine-sun-post', () => [part(new BoxGeometry(0.08, 0.3, 0.06), k.color.stone, { y: 0.15 })]));
        spinner.position.y = 0.42;
        spinner.add(piece(k, body, 'shrine-sun', () => {
          const parts: Parts = [part(new CylinderGeometry(0.12, 0.12, 0.03, 18), k.color.accent, { rx: Math.PI / 2 }), part(new CylinderGeometry(0.07, 0.07, 0.035, 16), 'glow', { rx: Math.PI / 2 })];
          for (let i = 0; i < 12; i++) parts.push(part(new ConeGeometry(0.018, 0.08, 4), k.color.accent, { x: Math.cos((i / 12) * Math.PI * 2) * 0.16, y: Math.sin((i / 12) * Math.PI * 2) * 0.16, rz: (i / 12) * Math.PI * 2 - Math.PI / 2 }));
          return parts;
        }));
        break;
      case 'crystal':
        element.add(piece(k, body, 'shrine-crystal-base', () => [part(new CylinderGeometry(0.1, 0.12, 0.08, 6), k.color.stone, { y: 0.04 })]));
        spinner.position.y = 0.32;
        spinner.add(piece(k, body, 'shrine-crystal', () => [part(new OctahedronGeometry(0.12, 0), 'glow', { sy: 1.6 }), part(new OctahedronGeometry(0.05, 0), k.color.accent, { x: 0.12, y: -0.08, sy: 1.5 })]));
        break;
      case 'tripod':
      case 'scarab':
        element.add(piece(k, body, 'shrine-tripod', () => [
          ...[0, 1, 2].map((i) => part(new CylinderGeometry(0.012, 0.014, 0.42, 6), k.color.accent, { x: Math.cos(i * 2.094) * 0.1, y: 0.2, z: Math.sin(i * 2.094) * 0.1, rz: Math.cos(i * 2.094) * 0.22, rx: -Math.sin(i * 2.094) * 0.22 })),
          part(lathe([[0, 0], [0.1, 0.0], [0.14, 0.06], [0.13, 0.07], [0, 0.03]], 14), k.color.accent, { y: 0.4 }),
          part(new SphereGeometry(0.08, 10, 6), 'glow', { y: 0.44, sy: 0.3 }),
        ]));
        puffs = new Puffs(new Vector3(0, 0.62, 0), 6, 1.6, 0.05);
        element.add(puffs.group);
        break;
    }

    const phase = Math.random() * 6;
    let rate = 1;
    model.idle = (time, dt) => {
      const pulse = Math.sin(time * 3 + phase);
      body.userData.unit.lights.value = 0.75 + 0.25 * Math.max(0, pulse);
      spinner.rotation.y += dt * 0.9 * rate;
      if (style === 'orb' || style === 'crystal') spinner.position.y = (style === 'orb' ? 0.38 : 0.32) + Math.sin(time * 1.6 + phase) * 0.02;
      flicker(flames, time + phase, 1);
      puffs?.update(dt);
    };

    model.wreck = async (ctx) => {
      if (puffs) {
        puffs.enabled = false;
        puffs.group.visible = false;
      }
      const top = () => model.worldOf(new Vector3(0, 0.5, 0));
      const arcs = (async () => {
        for (let i = 0; i < 4; i++) {
          ctx.emit('arc', top());
          body.userData.unit.lights.value = i % 2 === 0 ? 2.2 : 0.2;
          for (const f of flames) f.visible = i % 2 === 0;
          await ctx.tweens.wait(0.12 + ctx.random() * 0.08);
        }
        body.userData.unit.lights.value = 0;
        for (const f of flames) f.visible = false;
        ctx.emit('smoke', top());
      })();
      model.attach(spinner);
      const fly = throwPart(ctx, spinner, new Vector3(0.38, 0.06, 0.32), 0.7, 0.85, new Vector3(4, 0, 3));
      const crumble = lerpTo(ctx, 0.8, (e) => {
        const wobble = Math.sin(e * Math.PI * 4) * (1 - e) * 0.06;
        element.scale.set(1 + wobble, 1 - e * 0.45, 1 - wobble);
        element.rotation.z = e * 0.2;
        rate = 1 - e;
      }, 0.2);
      await Promise.all([arcs, fly, crumble]);
    };
    return model;
  };
}

// ------------------------------------------------------------------ workshop (1x2 temple / forge)

const COL_X = [-0.66, -0.22, 0.22, 0.66];

/** Colonnaded workshop with a forge, kiln or loom inside and a smoking chimney. */
export function kitWorkshop(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('workshop', body);
    const style = k.params.workshop;
    const colStyle = k.motifs.column === 'none' ? 'square' : k.motifs.column;
    const H = 0.5;
    model.add(piece(k, body, `workshop-shell-${style}`, () => {
      const parts: Parts = [
        part(new BoxGeometry(1.84, 0.06, 0.88), k.color.stoneDark, { y: 0.03 }),
        part(new BoxGeometry(0.5, 0.04, 0.12), k.color.stone, { y: 0.02, z: -0.48 }),
        part(new BoxGeometry(1.7, H, 0.06), k.color.stone, { y: 0.06 + H / 2, z: 0.36 }),
        part(new BoxGeometry(0.06, H, 0.7), k.color.stone, { x: -0.82, y: 0.06 + H / 2 }),
        part(new BoxGeometry(0.06, H, 0.7), k.color.stone, { x: 0.82, y: 0.06 + H / 2 }),
      ];
      if (style === 'forge') {
        parts.push(part(new BoxGeometry(0.34, 0.18, 0.26), k.color.stoneDark, { x: 0.4, y: 0.15, z: 0.15 }));
        parts.push(part(new BoxGeometry(0.22, 0.05, 0.16), 'glow', { x: 0.4, y: 0.25, z: 0.12 }));
        parts.push(part(new BoxGeometry(0.16, 0.08, 0.08), k.color.metalDark, { x: -0.2, y: 0.18, z: -0.05 }));
        parts.push(part(new CylinderGeometry(0.04, 0.06, 0.12, 8), k.color.woodDark, { x: -0.2, y: 0.1, z: -0.05 }));
      } else if (style === 'kiln') {
        parts.push(part(new SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.color.stoneDark, { x: 0.35, y: 0.06, z: 0.1 }));
        parts.push(part(new BoxGeometry(0.12, 0.1, 0.02), 'glow', { x: 0.35, y: 0.12, z: -0.12 }));
        for (let i = 0; i < 4; i++) parts.push(part(lathe([[0, 0], [0.04, 0.01], [0.05, 0.06], [0.03, 0.1], [0.035, 0.12], [0, 0.12]], 8), k.color.secondary, { x: -0.5 + i * 0.12, y: 0.06, z: 0.2 }));
      } else {
        parts.push(part(new BoxGeometry(0.5, 0.36, 0.04), k.color.wood, { x: -0.1, y: 0.24, z: 0.1 }));
        parts.push(part(new BoxGeometry(0.44, 0.28, 0.01), k.tint.cloth, { x: -0.1, y: 0.25, z: 0.08 }));
        parts.push(part(new SphereGeometry(0.04, 6, 4), 'glow', { x: 0.45, y: 0.2, z: 0.1 }));
      }
      return parts;
    }));

    const cols = COL_X.map((x) => {
      const g = new Group();
      g.position.set(x, 0.06, -0.36);
      g.add(piece(k, body, `workshop-column-${colStyle}`, () => column(k, colStyle, H, 0.042)));
      model.add(g);
      return g;
    });
    const roofGroup = new Group();
    roofGroup.position.y = 0.06 + H;
    roofGroup.add(piece(k, body, 'workshop-roof', () => [
      part(new BoxGeometry(1.84, 0.08, 0.86), k.color.stone, { y: 0.04 }),
      ...moved(ornamentBand(k, k.motifs.ornament, 1.6, k.tint.trim), { y: 0.04, z: -0.435 }),
      // Round roofs only suit round or square plans; a long hall gets a gable instead.
      ...moved(roof(k, k.motifs.roof === 'conical' || k.motifs.roof === 'tent' || k.motifs.roof === 'dome' ? 'gable' : k.motifs.roof, 1.8, 0.84), { y: 0.08 }),
    ]));
    model.add(roofGroup);

    const stackPivot = new Group();
    stackPivot.position.set(0.55, 0.42, 0.22);
    stackPivot.add(piece(k, body, 'workshop-stack', () => [part(new CylinderGeometry(0.05, 0.06, 0.62, 8), k.color.stoneDark, { y: 0.31 }), part(new CylinderGeometry(0.07, 0.06, 0.04, 8), k.color.stone, { y: 0.63 })]));
    model.add(stackPivot);
    const steam = new Puffs(new Vector3(0.55, 1.08, 0.22), 6, 1.6, 0.05);
    steam.enabled = style !== 'loom';
    model.add(steam.group);

    const hammer = new Group();
    hammer.position.set(-0.08, 0.32, -0.05);
    hammer.add(piece(k, body, 'workshop-hammer', () => [part(new CylinderGeometry(0.008, 0.008, 0.16, 5), k.color.wood, { x: -0.08, rz: Math.PI / 2 }), part(new BoxGeometry(0.04, 0.05, 0.04), k.color.metal, { x: -0.16 })]));
    hammer.visible = style === 'forge';
    model.add(hammer);

    const phase = Math.random() * 6;
    model.idle = (time, dt) => {
      steam.update(dt);
      const beat = (time * 1.4 + phase) % 1;
      hammer.rotation.z = beat < 0.2 ? -beat * 4 : beat < 0.28 ? -0.8 + (beat - 0.2) * 12.5 : 0;
      body.userData.unit.lights.value = 0.8 + Math.sin(time * 9 + phase) * 0.1 + (beat > 0.26 && beat < 0.32 ? 0.5 : 0);
    };

    model.wreck = async (ctx) => {
      steam.enabled = false;
      steam.group.visible = false;
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.5, 0)));
      const falls = cols.map((c, i) => topple(ctx, c, i % 2 ? 'z' : 'x', (i % 2 ? (i < 2 ? 1 : -1) : -1) * (1.3 + ctx.random() * 0.2), 0.8, 0.05 + i * 0.08));
      const roofDrop = lerpTo(ctx, 0.7, (e) => {
        roofGroup.position.y = 0.06 + H - e * H * 0.6;
        roofGroup.rotation.z = e * 0.16;
        roofGroup.rotation.x = e * 0.12;
      }, 0.3);
      const chimney = topple(ctx, stackPivot, 'z', -1.35, 0.9, 0.1);
      model.attach(hammer);
      const tool = throwPart(ctx, hammer, new Vector3(-0.5, 0.05, -0.55), 0.3, 0.7, new Vector3(0, 3, 4));
      await Promise.all([...falls, roofDrop, chimney, tool]);
    };
    return model;
  };
}


// ------------------------------------------------------------------ tower (1x1 automatic)

/**
 * Automatic tower in the faction's style: a drum of stone (or timber) with
 * merlons and an ornament band, and on top a small weapon that sweeps on its
 * own (a scorpion, a small gun or a rocket rack, after the siege style). When
 * hit the weapon flies off, the roof goes and the top half topples.
 */
export function kitTower(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const model = new UnitModel('tower', body);
    const timber = k.motifs.column === 'wooden';
    const shell = timber ? k.color.wood : k.color.stone;
    model.add(piece(k, body, 'tower-base', () => [
      part(new CylinderGeometry(0.3, 0.33, 0.06, 12), k.color.stoneDark, { y: 0.03 }),
      part(new CylinderGeometry(0.22, 0.26, 0.3, 12), shell, { y: 0.21 }),
      ...moved(ornamentBand(k, k.motifs.ornament, 0.3, k.tint.trim), { y: 0.26, z: -0.25 }),
      part(new BoxGeometry(0.07, 0.12, 0.01), k.color.dark, { y: 0.18, z: -0.255 }),
    ]));
    const top = new Group();
    top.position.y = 0.36;
    top.add(piece(k, body, 'tower-top', () => {
      const parts: Parts = [
        part(new CylinderGeometry(0.25, 0.22, 0.1, 12), shell, { y: 0.05 }),
        part(new CylinderGeometry(0.255, 0.255, 0.03, 12), 'main', { y: 0.085 }),
      ];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        parts.push(part(new BoxGeometry(0.07, 0.07, 0.05), shell, { x: Math.cos(a) * 0.23, y: 0.13, z: Math.sin(a) * 0.23, ry: -a }));
      }
      return parts;
    }));
    model.add(top);
    const weaponMount = new Group();
    weaponMount.position.y = 0.12;
    const style = k.params.siege;
    weaponMount.add(piece(k, body, `tower-weapon-${style}`, () => {
      const parts: Parts = [part(new CylinderGeometry(0.06, 0.08, 0.06, 10), k.color.metal, { y: 0.03 })];
      if (style === 'cannon') {
        parts.push(part(new CylinderGeometry(0.045, 0.055, 0.34, 12), k.color.metal, { y: 0.1, z: -0.12, rx: Math.PI / 2 }));
        parts.push(part(new TorusGeometry(0.055, 0.012, 4, 12), k.color.accent, { y: 0.1, z: -0.27 }));
      } else if (style === 'rockets') {
        parts.push(part(new BoxGeometry(0.18, 0.14, 0.2), 'main', { y: 0.12, rx: -0.4 }));
        for (let i = 0; i < 6; i++) parts.push(part(new CylinderGeometry(0.008, 0.008, 0.22, 4), k.color.metal, { x: -0.06 + (i % 3) * 0.06, y: 0.15 + Math.floor(i / 3) * 0.04, z: -0.08, rx: Math.PI / 2 - 0.4 }));
      } else {
        // A scorpion: stock, bow and a bolt laid on it.
        parts.push(part(new BoxGeometry(0.05, 0.04, 0.38), k.color.wood, { y: 0.08, z: -0.05 }));
        const bow = new TorusGeometry(0.17, 0.014, 4, 12, Math.PI * 0.7);
        bow.rotateX(Math.PI / 2);
        bow.rotateY(Math.PI * 0.35 - Math.PI / 2);
        parts.push(part(bow, k.color.woodDark, { y: 0.08, z: -0.02 }));
        parts.push(part(new CylinderGeometry(0.008, 0.008, 0.34, 5), k.color.wood, { y: 0.11, z: -0.08, rx: Math.PI / 2 }));
        parts.push(part(new ConeGeometry(0.016, 0.05, 5), k.color.metal, { y: 0.11, z: -0.27, rx: -Math.PI / 2 }));
      }
      return parts;
    }));
    top.add(weaponMount);
    const cap = piece(k, body, 'tower-roof', () => [
      ...[0, 1, 2].map((i) => part(new CylinderGeometry(0.012, 0.012, 0.22, 5), k.color.wood, { x: Math.cos(i * 2.1 + 0.5) * 0.2, y: 0.11, z: Math.sin(i * 2.1 + 0.5) * 0.2 })),
      ...moved(roof(k, k.motifs.roof === 'flat' ? 'conical' : k.motifs.roof, 0.46, 0.46), { y: 0.22 }),
    ]);
    cap.position.y = 0.12;
    top.add(cap);
    const anchor = new Group();
    anchor.position.set(0.0, 0.62, 0.0);
    top.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      // Sweep, hold on a bearing, sweep back.
      const s = Math.sin(time * 0.5 + phase);
      weaponMount.rotation.y = Math.sign(s) * Math.pow(Math.abs(s), 0.4) * 1.3;
    };

    model.wreck = async (ctx) => {
      ctx.emit('sparks', model.worldOf(new Vector3(0, 0.55, 0)));
      anchor.visible = false;
      model.attach(weaponMount);
      const gun = throwPart(ctx, weaponMount, new Vector3(-0.38, 0.05, -0.3), 0.5, 0.75, new Vector3(2, 4, 1), new Vector3(Math.PI / 2, 1.4, 0));
      model.attach(cap);
      const roofOff = throwPart(ctx, cap, new Vector3(0.4, 0.04, 0.32), 0.6, 0.85, new Vector3(2, 2, 3), new Vector3(0.3, 1, Math.PI * 0.85));
      const fall = topple(ctx, top, 'z', -1.25, 0.8, 0.15);
      await Promise.all([gun, roofOff, fall]);
      ctx.emit('dust', model.worldOf(new Vector3(0.2, 0.2, 0)));
    };
    return model;
  };
}
