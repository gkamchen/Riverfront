import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  SphereGeometry,
  Vector3,
} from 'three';
import { SKIN, cached, lathe, merge, mesh, part, ring } from '../parts';
import { UnitModel, type UnitFactoryOptions } from '../unitModel';
import { lerpTo, throwPart, topple } from './motion';

// ------------------------------------------------------------------ recruit

function recruitBase() {
  return merge([
    part(lathe([[0, 0], [0.27, 0], [0.28, 0.03], [0.25, 0.07], [0.2, 0.09], [0, 0.09]]), 'dark'),
    part(ring(0.22, 0.012, 0.07), SKIN.gold),
  ]);
}

function recruitTorso() {
  return merge([
    part(lathe([[0, 0.09], [0.16, 0.09], [0.17, 0.16], [0.15, 0.32], [0.11, 0.42], [0.08, 0.46], [0, 0.47]]), 'main'),
    part(ring(0.16, 0.016, 0.24), SKIN.khaki),
    part(new BoxGeometry(0.06, 0.05, 0.03), SKIN.brass, { y: 0.24, z: -0.165 }),
    part(new SphereGeometry(0.058, 14, 10), 'main', { x: -0.11, y: 0.41 }),
    part(new SphereGeometry(0.058, 14, 10), 'main', { x: 0.11, y: 0.41 }),
    part(new SphereGeometry(0.09, 18, 14), SKIN.skin, { y: 0.55 }),
    part(new BoxGeometry(0.11, 0.2, 0.08), SKIN.khaki, { y: 0.32, z: 0.15 }),
    // Rifle carried at port arms.
    part(new BoxGeometry(0.032, 0.42, 0.032), SKIN.metal, { x: 0.15, y: 0.36, z: -0.08, rz: -0.32 }),
    part(new BoxGeometry(0.05, 0.12, 0.045), SKIN.woodDark, { x: 0.12, y: 0.24, z: -0.08, rz: -0.32 }),
  ]);
}

function recruitHelmet() {
  return merge([
    part(new SphereGeometry(0.105, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 'dark'),
    part(new CylinderGeometry(0.128, 0.128, 0.016, 24), 'dark'),
    part(new BoxGeometry(0.15, 0.012, 0.02), SKIN.gold, { y: 0.05, z: -0.1 }),
  ]);
}

export function createRecruit({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('recruit', body);
  model.add(mesh(cached('recruit-base', recruitBase), body, 'base'));

  const tilt = new Group();
  const torso = new Group();
  torso.add(mesh(cached('recruit-torso', recruitTorso), body, 'torso'));
  const helmet = mesh(cached('recruit-helmet', recruitHelmet), body, 'helmet');
  helmet.position.y = 0.565;
  torso.add(helmet);
  tilt.add(torso);
  model.add(tilt);

  const phase = Math.random() * 6;
  model.idle = (time) => {
    const breath = Math.sin(time * 2.4 + phase);
    torso.scale.set(1 - breath * 0.008, 1 + breath * 0.022, 1 - breath * 0.008);
    torso.rotation.z = Math.sin(time * 0.9 + phase) * 0.03;
    helmet.rotation.y = Math.sin(time * 0.5 + phase) * 0.25;
  };

  model.wreck = async (ctx) => {
    torso.scale.set(1, 1, 1);
    torso.rotation.z = 0;
    // The helmet flies off first and rolls away on its rim.
    model.attach(helmet);
    const angle = ctx.random() * Math.PI * 2;
    const dir = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const helmetDone = throwPart(
      ctx,
      helmet,
      new Vector3(dir.x * 0.42, 0.075, dir.z * 0.42),
      0.45,
      0.7,
      new Vector3(dir.z * 9, 2, -dir.x * 9),
      new Vector3(Math.PI / 2, angle, 0),
    );
    // Body falls backwards over the edge of the base.
    tilt.position.set(0, 0.09, 0.2);
    torso.position.set(0, -0.09, -0.2);
    const fall = topple(ctx, tilt, 'x', Math.PI / 2 - 0.2, 0.9, 0.08);
    await Promise.all([helmetDone, fall]);
  };
  return model;
}

// ------------------------------------------------------------------ sniper

function sniperBags() {
  const parts = [];
  const bag = () => new CapsuleGeometry(0.06, 0.16, 4, 10);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i - 2) * 0.42;
    parts.push(part(bag(), SKIN.sand, { x: Math.cos(a) * 0.3, y: 0.06, z: Math.sin(a) * 0.3, rz: Math.PI / 2, ry: -a + Math.PI / 2 }));
  }
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i - 1.5) * 0.42;
    parts.push(part(bag(), SKIN.sand, { x: Math.cos(a) * 0.29, y: 0.17, z: Math.sin(a) * 0.29, rz: Math.PI / 2, ry: -a + Math.PI / 2 }));
  }
  parts.push(part(lathe([[0, 0], [0.32, 0], [0.3, 0.03], [0, 0.03]]), 'dark'));
  return merge(parts);
}

function sniperFigure() {
  const parts = [
    part(lathe([[0, 0.03], [0.15, 0.03], [0.16, 0.1], [0.13, 0.24], [0.09, 0.3], [0, 0.31]]), 'main'),
    part(new ConeGeometry(0.11, 0.2, 12), 'dark', { y: 0.39, z: 0.01 }),
    part(new SphereGeometry(0.07, 12, 10), SKIN.black, { y: 0.35, z: -0.035 }),
  ];
  // Ghillie tufts.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    parts.push(part(new ConeGeometry(0.03, 0.12, 5), SKIN.khaki, { x: Math.cos(a) * 0.13, y: 0.2 + (i % 3) * 0.05, z: Math.sin(a) * 0.13, rz: Math.cos(a) * 0.6, rx: -Math.sin(a) * 0.6 }));
  }
  return merge(parts);
}

function sniperRifle() {
  return merge([
    part(new CylinderGeometry(0.014, 0.016, 0.62, 8), SKIN.metal, { rx: Math.PI / 2, z: -0.22 }),
    part(new BoxGeometry(0.05, 0.06, 0.2), SKIN.woodDark, { z: 0.08 }),
    part(new CylinderGeometry(0.024, 0.024, 0.16, 10), SKIN.black, { rx: Math.PI / 2, y: 0.05, z: -0.02 }),
    part(new CylinderGeometry(0.02, 0.02, 0.012, 10), 'glow', { rx: Math.PI / 2, y: 0.05, z: -0.105 }),
    part(new BoxGeometry(0.008, 0.12, 0.008), SKIN.metal, { x: -0.04, y: -0.05, z: -0.4, rz: 0.4 }),
    part(new BoxGeometry(0.008, 0.12, 0.008), SKIN.metal, { x: 0.04, y: -0.05, z: -0.4, rz: -0.4 }),
  ]);
}

export function createSniper({ body }: UnitFactoryOptions): UnitModel {
  const model = new UnitModel('sniper', body);
  const bags = mesh(cached('sniper-bags', sniperBags), body, 'bags');
  model.add(bags);

  const tilt = new Group();
  const figure = new Group();
  figure.add(mesh(cached('sniper-figure', sniperFigure), body, 'figure'));
  const rifle = mesh(cached('sniper-rifle', sniperRifle), body, 'rifle');
  rifle.position.set(0.02, 0.27, -0.08);
  figure.add(rifle);
  tilt.add(figure);
  model.add(tilt);

  const phase = Math.random() * 6;
  model.idle = (time) => {
    figure.rotation.y = Math.sin(time * 0.35 + phase) * 0.35 + Math.sin(time * 1.3 + phase) * 0.04;
    rifle.rotation.x = Math.sin(time * 0.6 + phase) * 0.03;
    const breath = Math.sin(time * 1.8 + phase);
    figure.scale.set(1, 1 + breath * 0.015, 1);
  };

  model.wreck = async (ctx) => {
    figure.scale.set(1, 1, 1);
    model.attach(rifle);
    const side = ctx.random() < 0.5 ? -1 : 1;
    const rifleDone = throwPart(
      ctx,
      rifle,
      new Vector3(side * 0.42, 0.03, 0.18),
      0.55,
      0.75,
      new Vector3(Math.PI * 4, 0, 0),
      new Vector3(Math.PI * 4, side * 1.2, Math.PI / 2),
    );
    // Slumps forward over the sandbags.
    tilt.position.set(0, 0.03, -0.12);
    figure.position.set(0, -0.03, 0.12);
    const slump = topple(ctx, tilt, 'x', -1.05, 0.8, 0.1);
    const spill = lerpTo(ctx, 0.6, (e) => {
      bags.scale.set(1 + e * 0.12, 1 - e * 0.3, 1 + e * 0.12);
    });
    await Promise.all([rifleDone, slump, spill]);
  };
  return model;
}
