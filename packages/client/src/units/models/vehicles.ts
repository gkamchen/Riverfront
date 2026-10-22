import { BoxGeometry, CylinderGeometry, Group, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SKIN, cached, lathe, merge, mesh, part, ring } from '../parts';
import { UnitModel, type UnitFactoryOptions } from '../unitModel';
import { lerpTo, throwPart } from './motion';

// ------------------------------------------------------------------ armor (1x2)

function armorHull() {
  const parts = [];
  for (const side of [-1, 1]) {
    parts.push(part(new RoundedBoxGeometry(1.62, 0.16, 0.17, 2, 0.06), SKIN.rubber, { y: 0.085, z: side * 0.27 }));
    for (let i = 0; i < 6; i++) {
      parts.push(part(new CylinderGeometry(0.058, 0.058, 0.18, 14), SKIN.metalLight, { x: -0.65 + i * 0.26, y: 0.08, z: side * 0.27, rx: Math.PI / 2 }));
    }
    parts.push(part(new BoxGeometry(1.5, 0.03, 0.2), 'dark', { y: 0.18, z: side * 0.27 }));
  }
  parts.push(
    part(new RoundedBoxGeometry(1.5, 0.17, 0.46, 2, 0.04), 'main', { y: 0.22 }),
    part(new BoxGeometry(0.3, 0.12, 0.44), 'main', { x: -0.78, y: 0.2, rz: -0.55 }),
    part(new BoxGeometry(0.5, 0.025, 0.3), 'dark', { x: 0.45, y: 0.31 }),
    part(new BoxGeometry(0.16, 0.08, 0.1), SKIN.khaki, { x: 0.6, y: 0.33, z: 0.14 }),
    part(new CylinderGeometry(0.03, 0.03, 0.05, 10), SKIN.lamp, { x: -0.76, y: 0.27, z: 0.17, rz: Math.PI / 2 }),
    part(new CylinderGeometry(0.03, 0.03, 0.05, 10), SKIN.lamp, { x: -0.76, y: 0.27, z: -0.17, rz: Math.PI / 2 }),
  );
  return merge(parts);
}

function armorTurret() {
  return merge([
    part(lathe([[0, 0], [0.25, 0], [0.26, 0.04], [0.22, 0.12], [0.12, 0.17], [0, 0.18]]), 'main'),
    part(ring(0.25, 0.014, 0.012), SKIN.gold),
    part(new CylinderGeometry(0.03, 0.036, 0.4, 12), SKIN.metal, { y: 0.08, z: -0.3, rx: Math.PI / 2 }),
    part(new CylinderGeometry(0.046, 0.046, 0.07, 12), SKIN.metal, { y: 0.08, z: -0.49, rx: Math.PI / 2 }),
    part(new CylinderGeometry(0.06, 0.06, 0.035, 16), SKIN.gold, { x: 0.05, y: 0.19, z: 0.05 }),
    part(new CylinderGeometry(0.006, 0.006, 0.4, 6), SKIN.metal, { x: -0.12, y: 0.35, z: 0.12 }),
  ]);
}

export function createArmor({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('armor', body);
  const hullHolder = new Group();
  const hull = mesh(cached('armor-hull', armorHull), body, 'hull');
  hullHolder.add(hull);
  const turret = new Group();
  turret.position.set(0.1, 0.305, 0);
  turret.add(mesh(cached('armor-turret', armorTurret), body, 'turret'));
  hullHolder.add(turret);
  model.add(hullHolder);

  const anchor = new Group();
  anchor.position.set(-0.12, 0.55, 0.12);
  turret.add(anchor);
  model.flagAnchor = anchor;

  const phase = Math.random() * 6;
  model.idle = (time) => {
    turret.rotation.y = Math.sin(time * 0.37 + phase) * 0.55;
    hullHolder.position.y = Math.sin(time * 37 + phase) * 0.0025;
  };

  model.wreck = async (ctx) => {
    hullHolder.position.y = 0;
    model.attach(turret);
    const side = ctx.random() < 0.5 ? -1 : 1;
    ctx.emit('sparks', model.worldOf(new Vector3(0.1, 0.35, 0)));
    const turretDone = throwPart(
      ctx,
      turret,
      new Vector3(0.25 + ctx.random() * 0.3, 0.33, side * 0.6),
      1.0,
      0.95,
      new Vector3(Math.PI * 3, 1.5, 0),
      new Vector3(Math.PI, 1.2 * side, side * 0.2),
    );
    const sag = lerpTo(ctx, 0.5, (e) => {
      hullHolder.rotation.x = -side * 0.14 * e;
      hullHolder.rotation.z = 0.05 * e;
      hullHolder.position.y = -0.04 * e;
    }, 0.15);
    await Promise.all([turretDone, sag]);
  };
  return model;
}

// ------------------------------------------------------------------ artillery (1x3)

const SEGMENTS = 4;
const SEGMENT_LENGTH = 0.34;

function artilleryCarriage() {
  const parts = [
    part(new RoundedBoxGeometry(0.5, 0.16, 0.42, 2, 0.03), 'dark', { x: -0.25, y: 0.24 }),
    part(new BoxGeometry(0.06, 0.38, 0.62), 'main', { x: -0.53, y: 0.42, rz: 0.12 }),
    part(new BoxGeometry(0.02, 0.06, 0.58), SKIN.gold, { x: -0.565, y: 0.58, rz: 0.12 }),
    part(new BoxGeometry(0.42, 0.1, 0.12), 'main', { x: -0.28, y: 0.36 }),
  ];
  // Split trail legs running back along the bar.
  for (const side of [-1, 1]) {
    parts.push(part(new BoxGeometry(1.45, 0.08, 0.08), 'main', { x: 0.45, y: 0.14, z: side * 0.15, ry: -side * 0.1, rz: 0.08 }));
    parts.push(part(new BoxGeometry(0.06, 0.16, 0.16), SKIN.metal, { x: 1.18, y: 0.07, z: side * 0.22 }));
  }
  parts.push(
    part(new BoxGeometry(0.32, 0.18, 0.24), SKIN.wood, { x: 0.82, y: 0.09, z: -0.3 }),
    part(new CylinderGeometry(0.03, 0.03, 0.22, 10), SKIN.brass, { x: 0.74, y: 0.2, z: -0.3, rz: Math.PI / 2 }),
    part(new CylinderGeometry(0.03, 0.03, 0.22, 10), SKIN.brass, { x: 0.8, y: 0.21, z: -0.24, rz: Math.PI / 2 }),
  );
  return merge(parts);
}

function artilleryWheel() {
  return merge([
    part(new TorusGeometry(0.21, 0.05, 10, 24), SKIN.rubber),
    part(new CylinderGeometry(0.17, 0.17, 0.05, 20), SKIN.metal, { rx: Math.PI / 2 }),
    part(new CylinderGeometry(0.06, 0.06, 0.09, 12), SKIN.gold, { rx: Math.PI / 2 }),
  ]);
}

function barrelSegment(index: number) {
  const r0 = 0.068 - index * 0.006;
  const r1 = r0 - 0.006;
  const parts = [part(new CylinderGeometry(r1, r0, SEGMENT_LENGTH, 14), SKIN.metal, { x: -SEGMENT_LENGTH / 2, rz: Math.PI / 2 })];
  if (index === 0) parts.push(part(new CylinderGeometry(0.095, 0.095, 0.2, 14), 'dark', { x: -0.06, rz: Math.PI / 2 }));
  if (index === SEGMENTS - 1) parts.push(part(new CylinderGeometry(0.065, 0.065, 0.1, 14), SKIN.metal, { x: -SEGMENT_LENGTH, rz: Math.PI / 2 }));
  else parts.push(part(new CylinderGeometry(r1 + 0.008, r1 + 0.008, 0.025, 14), SKIN.gold, { x: -SEGMENT_LENGTH, rz: Math.PI / 2 }));
  return merge(parts);
}

export function createArtillery({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('artillery', body);
  const frame = new Group();
  frame.add(mesh(cached('artillery-carriage', artilleryCarriage), body, 'carriage'));
  model.add(frame);

  const wheels = [-1, 1].map((side) => {
    const wheel = mesh(cached('artillery-wheel', artilleryWheel), body, 'wheel');
    wheel.position.set(-0.25, 0.26, side * 0.3);
    frame.add(wheel);
    return wheel;
  });

  // The barrel is a chain of segments so it can bend when destroyed.
  const segments: Group[] = [];
  let parent: Group = frame;
  for (let i = 0; i < SEGMENTS; i++) {
    const segment = new Group();
    segment.position.set(i === 0 ? -0.25 : -SEGMENT_LENGTH, i === 0 ? 0.42 : 0, 0);
    segment.add(mesh(cached(`artillery-barrel-${i}`, () => barrelSegment(i)), body, `barrel-${i}`));
    parent.add(segment);
    segments.push(segment);
    parent = segment;
  }
  const breech = segments[0]!;

  const phase = Math.random() * 6;
  model.idle = (time) => {
    breech.rotation.z = -0.32 - (Math.sin(time * 0.25 + phase) * 0.5 + 0.5) * 0.18;
    breech.rotation.y = Math.sin(time * 0.17 + phase) * 0.06;
  };

  model.wreck = async (ctx) => {
    const muzzle = new Vector3(-0.25 - SEGMENT_LENGTH * SEGMENTS, 0.6, 0);
    ctx.emit('smoke', model.worldOf(muzzle));
    // Barrel droops, each segment a bit more than the last.
    const bend = lerpTo(ctx, 0.9, (e) => {
      segments.forEach((segment, i) => {
        if (i === 0) segment.rotation.z = -0.4 + e * 0.32;
        else segment.rotation.z = e * (0.22 + i * 0.12);
      });
    });
    // One wheel comes off and rolls away.
    const side = ctx.random() < 0.5 ? 0 : 1;
    const wheel = wheels[side]!;
    model.attach(wheel);
    const sign = side === 0 ? -1 : 1;
    const roll = throwPart(
      ctx,
      wheel,
      new Vector3(-0.1, 0.05, sign * 0.75),
      0.25,
      0.9,
      new Vector3(Math.PI / 2, 0, -4),
      new Vector3(sign * Math.PI / 2, 0.4, -4),
    );
    const lean = lerpTo(ctx, 0.6, (e) => {
      frame.rotation.x = sign * 0.16 * e;
      frame.position.y = -0.05 * e;
    }, 0.2);
    await Promise.all([bend, roll, lean]);
  };
  return model;
}

// ------------------------------------------------------------------ amphibian (1x2 hovercraft)

function hoverSkirt() {
  const skirt = new TorusGeometry(0.27, 0.13, 12, 36);
  skirt.rotateX(Math.PI / 2);
  skirt.scale(2.45, 1, 1.12);
  return merge([part(skirt, 'dark', { y: 0.13 })]);
}

function hoverDeck() {
  return merge([
    part(new RoundedBoxGeometry(1.5, 0.08, 0.56, 2, 0.03), 'main', { y: 0.24 }),
    part(new RoundedBoxGeometry(0.58, 0.2, 0.42, 2, 0.05), 'main', { x: -0.22, y: 0.36 }),
    part(new BoxGeometry(0.5, 0.06, 0.43), SKIN.glass, { x: -0.24, y: 0.41 }),
    part(new BoxGeometry(0.06, 0.06, 0.38), SKIN.glass, { x: -0.5, y: 0.38 }),
    part(new BoxGeometry(0.3, 0.03, 0.5), SKIN.gold, { x: -0.62, y: 0.29 }),
    part(new SphereGeometry(0.03, 8, 6), 'glow', { x: -0.74, y: 0.3, z: 0.2 }),
    part(new SphereGeometry(0.03, 8, 6), 'glow', { x: -0.74, y: 0.3, z: -0.2 }),
  ]);
}

function hoverDuct() {
  const parts = [part(new TorusGeometry(0.13, 0.025, 8, 24), SKIN.metal, { ry: Math.PI / 2 })];
  parts.push(part(new BoxGeometry(0.03, 0.18, 0.02), SKIN.metal, { x: 0.08, y: 0 }));
  parts.push(part(new BoxGeometry(0.04, 0.1, 0.04), SKIN.metal, { y: -0.13 }));
  return merge(parts);
}

function hoverProp() {
  const parts = [part(new SphereGeometry(0.025, 8, 6), SKIN.gold)];
  for (let i = 0; i < 3; i++) {
    parts.push(part(new BoxGeometry(0.012, 0.22, 0.035), SKIN.metalLight, { rx: (i / 3) * Math.PI }));
  }
  return merge(parts);
}

export function createAmphibian({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('amphibian', body);
  const craft = new Group();
  const skirt = mesh(cached('amphibian-skirt', hoverSkirt), body, 'skirt');
  craft.add(skirt);
  const deck = new Group();
  deck.add(mesh(cached('amphibian-deck', hoverDeck), body, 'deck'));
  craft.add(deck);
  const props: Group[] = [];
  for (const side of [-1, 1]) {
    const duct = mesh(cached('amphibian-duct', hoverDuct), body, 'duct');
    duct.position.set(0.6, 0.42, side * 0.15);
    deck.add(duct);
    const prop = new Group();
    prop.add(mesh(cached('amphibian-prop', hoverProp), body, 'prop'));
    prop.position.copy(duct.position);
    deck.add(prop);
    props.push(prop);
  }
  model.add(craft);

  const phase = Math.random() * 6;
  let spin = 22;
  model.idle = (time, dt) => {
    craft.position.y = 0.02 + Math.sin(time * 2.2 + phase) * 0.018;
    craft.rotation.z = Math.sin(time * 1.3 + phase) * 0.015;
    skirt.scale.set(1, 1 + Math.sin(time * 6 + phase) * 0.025, 1);
    for (const prop of props) prop.rotation.x += spin * dt;
  };

  model.wreck = async (ctx) => {
    ctx.emit('splash', model.worldOf(new Vector3(0, 0.1, 0)));
    const spinDown = ctx.tweens.run(1.6, (t) => {
      spin = 22 * (1 - t);
      for (const prop of props) prop.rotation.x += spin * 0.016;
    });
    // The skirt loses its air: it flattens and spreads while the hull sinks onto it.
    const deflate = lerpTo(ctx, 1.1, (e) => {
      const wobble = Math.sin(e * Math.PI * 5) * (1 - e) * 0.08;
      skirt.scale.set(1 + e * 0.1 + wobble, 1 - e * 0.72, 1 + e * 0.14 - wobble);
      craft.position.y = 0.02 - e * 0.08;
      deck.position.y = -e * 0.09;
      deck.rotation.z = e * 0.1;
      deck.rotation.x = -e * 0.07;
    });
    await Promise.all([spinDown, deflate]);
  };
  return model;
}
