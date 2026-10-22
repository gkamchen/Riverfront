import { BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, Shape, ShapeGeometry, SphereGeometry, TorusGeometry, Vector3, type Mesh } from 'three';
import { lathe, part } from '../../units/parts';
import { UnitModel, type UnitFactoryOptions } from '../../units/unitModel';
import { lerpTo, throwPart, topple } from '../../units/models/motion';
import type { UnitFactory } from '../../units/factories';
import { bolt, piece } from './common';
import { camel, elephant, figure, horse, hull, limb, moved, ornamentBand, roof, wheel, type Parts } from './pieces';
import type { KitStyle } from './style';

const COAT = new Color('#8a6440');
const MANE = new Color('#3a2a1c');
const GREY = new Color('#8a8580');
const IVORY = new Color('#efe6cf');
const SAND = new Color('#c4a070');

/** Crew figure scaled down for vehicles, as one mesh (with headgear). */
function crew(k: KitStyle, scale: number): Parts {
  return figure(k, scale, 'officer');
}

// ------------------------------------------------------------------ armor (1x2)

/**
 * Chariot (horses at −x pulling a light car), war elephant with a howdah,
 * covered war wagon or camel rider. On destruction the animals break free and
 * run off; the vehicle loses a wheel and tips over.
 */
export function kitArmor(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const style = k.params.armor;
    const model = new UnitModel('armor', body);
    const animals: Group[] = [];
    const heads: Group[] = [];
    const rig = new Group();
    model.add(rig);
    const wheels: Mesh[] = [];
    let crewMesh: Mesh | null = null;

    const addHorse = (x: number, z: number) => {
      const h = horse(COAT, MANE);
      const group = new Group();
      group.position.set(x, 0, z);
      group.add(piece(k, body, 'horse-body', () => h.body));
      const head = new Group();
      head.position.set(...h.headPivot);
      head.add(piece(k, body, 'horse-head', () => h.head));
      group.add(head);
      group.add(piece(k, body, 'horse-harness', () => [part(new BoxGeometry(0.03, 0.03, 0.16), k.color.woodDark, { y: 0.36, x: -0.1 }), part(new BoxGeometry(0.16, 0.012, 0.15), k.tint.cloth, { y: 0.355, x: 0.04 }), part(new ConeGeometry(0.018, 0.07, 6), k.tint.trim, { x: -0.2, y: 0.56 })]));
      rig.add(group);
      animals.push(group);
      heads.push(head);
    };

    let car: Group;
    if (style === 'elephant') {
      const beast = new Group();
      beast.add(piece(k, body, 'elephant', () => elephant(GREY, IVORY)));
      beast.scale.setScalar(1.25);
      rig.add(beast);
      animals.push(beast);
      car = new Group();
      car.position.set(0.05, 0.72, 0);
      car.add(piece(k, body, 'howdah', () => [
        part(new BoxGeometry(0.36, 0.14, 0.3), k.tint.shield, { y: 0.07 }),
        part(new BoxGeometry(0.4, 0.02, 0.34), k.color.accent, { y: 0.15 }),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(new CylinderGeometry(0.01, 0.01, 0.2, 5), k.color.wood, { x: sx * 0.17, y: 0.25, z: sz * 0.14 }))),
        ...moved(rightRoof(k), { y: 0.35 }),
      ]));
      crewMesh = piece(k, body, 'armor-crew', () => crew(k, 0.55));
      crewMesh.position.set(0.02, 0.1, 0);
      car.add(crewMesh);
      rig.add(car);
    } else if (style === 'litter') {
      // A war litter on carrying poles, borne by four bearers (the "animals" that run off).
      for (const [x, z] of [[-0.55, -0.2], [-0.55, 0.2], [0.55, -0.2], [0.55, 0.2]] as const) {
        const bearer = new Group();
        bearer.position.set(x, 0, z);
        bearer.add(piece(k, body, 'litter-bearer', () => figure(k, 0.6, 'soldier', 'cap', null)));
        rig.add(bearer);
        animals.push(bearer);
      }
      car = new Group();
      car.position.set(0, 0.34, 0);
      car.add(piece(k, body, 'litter-car', () => [
        ...[-1, 1].map((s) => part(new CylinderGeometry(0.014, 0.014, 1.4, 6), k.color.wood, { z: s * 0.2, rz: Math.PI / 2 })),
        part(new BoxGeometry(0.5, 0.16, 0.34), k.tint.shield, { y: 0.1 }),
        part(new BoxGeometry(0.54, 0.02, 0.38), k.color.accent, { y: 0.19 }),
        ...moved(ornamentBand(k, k.motifs.ornament, 0.44), { y: 0.1, z: -0.175 }),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => part(new CylinderGeometry(0.01, 0.01, 0.26, 5), k.color.wood, { x: sx * 0.22, y: 0.32, z: sz * 0.15 }))),
        ...moved(roof(k, k.motifs.roof === 'flat' ? 'tent' : k.motifs.roof, 0.56, 0.4), { y: 0.45 }),
      ]));
      crewMesh = piece(k, body, 'armor-crew', () => crew(k, 0.5));
      crewMesh.position.set(0, 0.18, 0);
      car.add(crewMesh);
      rig.add(car);
    } else if (style === 'camel') {
      const beast = new Group();
      beast.add(piece(k, body, 'camel', () => camel(SAND)));
      beast.position.x = -0.35;
      beast.scale.setScalar(1.25);
      rig.add(beast);
      animals.push(beast);
      car = new Group();
      car.position.set(0.4, 0, 0);
      car.add(piece(k, body, 'camel-cart', () => [part(new BoxGeometry(0.5, 0.14, 0.36), k.tint.shield, { y: 0.25 }), part(new BoxGeometry(0.54, 0.02, 0.4), k.color.accent, { y: 0.33 })]));
      for (const side of [-1, 1]) {
        const w = piece(k, body, 'kit-wheel', () => wheel(k, 0.16, 6));
        w.position.set(0.05, 0.16, side * 0.22);
        car.add(w);
        wheels.push(w);
      }
      crewMesh = piece(k, body, 'armor-crew', () => crew(k, 0.6));
      crewMesh.position.set(0.1, 0.32, 0);
      car.add(crewMesh);
      rig.add(car);
    } else {
      const wagon = style === 'wagon';
      addHorse(-0.5, -0.11);
      addHorse(-0.5, 0.11);
      car = new Group();
      car.position.set(0.38, 0, 0);
      car.add(piece(k, body, `armor-car-${style}`, () => {
        const parts: Parts = [];
        if (wagon) {
          parts.push(part(new BoxGeometry(0.62, 0.2, 0.42), k.tint.shield, { y: 0.3 }));
          parts.push(part(new BoxGeometry(0.66, 0.025, 0.46), k.color.accent, { y: 0.41 }));
          parts.push(part(new CylinderGeometry(0.24, 0.24, 0.62, 12, 1, false, 0, Math.PI), k.tint.cloth, { y: 0.42, rz: Math.PI / 2, ry: Math.PI / 2, sx: 1, sy: 1, sz: 0.85 }));
          parts.push(...moved(ornamentBand(k, k.motifs.ornament, 0.56), { y: 0.3, z: -0.215 }));
        } else {
          // Open car: curved front and sides painted in the team colour.
          parts.push(part(new BoxGeometry(0.34, 0.03, 0.4), k.color.woodDark, { y: 0.2 }));
          parts.push(part(new CylinderGeometry(0.2, 0.2, 0.16, 12, 1, true, Math.PI, Math.PI), k.tint.shield, { x: 0.0, y: 0.29, sx: 0.85 }));
          parts.push(part(new TorusGeometry(0.2, 0.012, 4, 12, Math.PI), k.color.accent, { y: 0.37, rx: Math.PI / 2, rz: Math.PI / 2, sy: 0.85 }));
          parts.push(...moved(ornamentBand(k, k.motifs.ornament, 0.24), { x: -0.17, y: 0.29, ry: Math.PI / 2 }));
        }
        // Pole to the yoke.
        parts.push(part(new CylinderGeometry(0.012, 0.012, 0.62, 6), k.color.wood, { x: -0.5, y: 0.26, rz: Math.PI / 2 - 0.08 }));
        parts.push(part(new BoxGeometry(0.04, 0.03, 0.38), k.color.wood, { x: -0.78, y: 0.34 }));
        parts.push(part(new CylinderGeometry(0.012, 0.012, 0.5, 6), k.color.metal, { y: 0.17, rx: Math.PI / 2 }));
        return parts;
      }));
      for (const side of [-1, 1]) {
        const w = piece(k, body, 'kit-wheel', () => wheel(k, 0.17, 6));
        w.position.set(0, 0.17, side * 0.25);
        car.add(w);
        wheels.push(w);
      }
      crewMesh = piece(k, body, 'armor-crew', () => crew(k, 0.62));
      crewMesh.position.set(wagon ? 0.05 : 0.02, wagon ? 0.44 : 0.21, 0);
      car.add(crewMesh);
      rig.add(car);
    }

    if (style === 'chariot') rig.scale.setScalar(1.2);
    const anchor = new Group();
    anchor.position.set(0.15, style === 'elephant' ? 0.55 : 0.6, 0.1);
    car.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      heads.forEach((head, i) => (head.rotation.z = Math.sin(time * 2.2 + phase + i * 1.3) * 0.12));
      animals.forEach((a, i) => (a.position.y = Math.abs(Math.sin(time * 1.1 + phase + i)) * 0.004));
      if (crewMesh) crewMesh.rotation.y = Math.sin(time * 0.5 + phase) * 0.3;
      wheels.forEach((w) => (w.rotation.z = Math.sin(time * 0.6 + phase) * 0.05));
      if (style === 'elephant') car.rotation.z = Math.sin(time * 1.1 + phase) * 0.02;
    };

    model.wreck = async (ctx) => {
      ctx.emit('dust', model.worldOf(new Vector3(0, 0.2, 0)));
      const side = ctx.random() < 0.5 ? -1 : 1;
      // The animals break free and run off the board edge.
      const run = animals.map((a, i) => bolt(ctx, a, new Vector3(-1.4 - i * 0.2, 0, side * (0.6 + i * 0.4)), 1.4));
      const jobs: Promise<void>[] = [...run];
      const lost = wheels[ctx.random() < 0.5 ? 0 : 1];
      if (lost) {
        model.attach(lost);
        const sign = lost.position.z > 0 ? 1 : -1;
        jobs.push(throwPart(ctx, lost, new Vector3(lost.position.x + 0.3, 0.05, sign * 0.7), 0.25, 0.9, new Vector3(Math.PI / 2, 0, -4), new Vector3(sign * Math.PI / 2, 0.4, -4)));
      }
      if (style === 'elephant') {
        model.attach(car);
        jobs.push(throwPart(ctx, car, new Vector3(0.45, 0.02, side * 0.25), 0.3, 0.8, new Vector3(0, 0, 1.4), new Vector3(0, 0.4, side * 1.3)));
      } else {
        jobs.push(lerpTo(ctx, 0.6, (e) => {
          car.rotation.x = -side * 0.5 * e;
          car.position.y = -0.05 * e;
          car.rotation.z = 0.15 * e;
        }, 0.15));
      }
      if (crewMesh) jobs.push(topple(ctx, crewMesh, 'z', 1.2, 0.8, 0.1));
      await Promise.all(jobs);
    };
    return model;
  };
}

function rightRoof(k: KitStyle): Parts {
  return [part(new ConeGeometry(0.28, 0.12, 4), k.tint.roof, { ry: Math.PI / 4 })];
}

// ------------------------------------------------------------------ artillery (1x3)

/** Ballista / gastraphetes / onager / bombard / fire-arrow cart along the 3 cells. */
/** Where the claw holds the drawn string, on the slider (aim frame). */
const CLAW = new Vector3(0.32, 0.04, 0);

/**
 * Ballista and gastraphetes stand on a trestle: a torsion frame with two rope
 * skeins, arms swept back, a drawn bowstring, a bolt on the slider and a
 * windlass at the back. Onager, bombard and fire-arrow rack ride on a cart.
 */
export function kitArtillery(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const style = k.params.siege;
    const bolter = style === 'ballista' || style === 'gastraphetes';
    const model = new UnitModel('artillery', body);
    const frame = new Group();
    model.add(frame);
    const wheels: Mesh[] = [];
    if (bolter) {
      frame.add(piece(k, body, 'artillery-trestle', () => {
        const parts: Parts = [
          part(new CylinderGeometry(0.05, 0.06, 0.32, 8), k.color.wood, { y: 0.24 }),
          part(new CylinderGeometry(0.11, 0.11, 0.03, 14), k.color.metal, { y: 0.41 }),
        ];
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2 + 0.5;
          parts.push(limb(new Vector3(0, 0.22, 0), new Vector3(Math.cos(a) * 0.36, 0.0, Math.sin(a) * 0.32), 0.028, 0.022, k.color.woodDark));
          parts.push(part(new BoxGeometry(0.1, 0.02, 0.06), k.color.woodDark, { x: Math.cos(a) * 0.36, y: 0.01, z: Math.sin(a) * 0.32, ry: -a }));
        }
        // A crate of spare bolts behind the crew.
        parts.push(part(new BoxGeometry(0.28, 0.12, 0.2), k.color.woodDark, { x: 1.12, y: 0.06, z: 0.2 }));
        for (let i = 0; i < 4; i++) parts.push(part(new CylinderGeometry(0.01, 0.01, 0.34, 5), k.color.wood, { x: 1.12, y: 0.13, z: 0.13 + i * 0.045, rz: Math.PI / 2 }));
        return parts;
      }));
    } else {
      for (const side of [-1, 1]) {
        const w = piece(k, body, 'kit-wheel-big', () => wheel(k, 0.22, 8));
        w.position.set(0.45, 0.22, side * 0.33);
        frame.add(w);
        wheels.push(w);
      }
      frame.add(piece(k, body, `artillery-bed-${style}`, () => [
        part(new BoxGeometry(1.7, 0.08, 0.1), k.color.wood, { x: 0.2, y: 0.18, z: 0.17 }),
        part(new BoxGeometry(1.7, 0.08, 0.1), k.color.wood, { x: 0.2, y: 0.18, z: -0.17 }),
        part(new BoxGeometry(0.1, 0.06, 0.44), k.color.woodDark, { x: 1.0, y: 0.16 }),
        part(new BoxGeometry(0.1, 0.06, 0.44), k.color.woodDark, { x: -0.6, y: 0.16 }),
        part(new CylinderGeometry(0.02, 0.02, 0.76, 6), k.color.metal, { x: 0.45, y: 0.22, rx: Math.PI / 2 }),
        part(new BoxGeometry(0.26, 0.12, 0.22), k.color.woodDark, { x: 1.15, y: 0.06, z: -0.28 }),
        ...moved(ornamentBand(k, k.motifs.ornament, 0.8, k.tint.trim), { x: 0.2, y: 0.18, z: -0.225 }),
        part(new CylinderGeometry(0.05, 0.07, 0.2, 8), k.color.wood, { y: 0.3 }),
      ]));
    }

    const aim = new Group();
    aim.position.set(0, 0.45, 0);
    frame.add(aim);
    const arms: Mesh[] = [];
    const strings: Mesh[] = [];
    let missile: Mesh | null = null;
    let windlass: Mesh | null = null;
    let barrelParts: Group[] = [];

    if (bolter) {
      aim.add(piece(k, body, `artillery-ballista-${style}`, () => {
        const parts: Parts = [
          // Slider with its groove, and the trigger claw.
          part(new BoxGeometry(1.42, 0.06, 0.1), k.color.wood, { x: -0.05 }),
          part(new BoxGeometry(1.3, 0.012, 0.03), k.color.woodDark, { x: -0.05, y: 0.035 }),
          part(new BoxGeometry(0.07, 0.06, 0.08), k.color.metal, { x: CLAW.x, y: CLAW.y }),
          // Windlass cradle at the back.
          part(new BoxGeometry(0.05, 0.12, 0.05), k.color.woodDark, { x: 0.6, y: 0.04, z: 0.1 }),
          part(new BoxGeometry(0.05, 0.12, 0.05), k.color.woodDark, { x: 0.6, y: 0.04, z: -0.1 }),
        ];
        if (style === 'ballista') {
          // Torsion frame: two posts and two beams around the skeins, with a painted front plate.
          for (const z of [-0.12, 0.12]) parts.push(part(new BoxGeometry(0.06, 0.32, 0.05), k.color.woodDark, { x: -0.45, y: 0.02, z }));
          for (const y of [-0.13, 0.17]) parts.push(part(new BoxGeometry(0.08, 0.05, 0.56), k.color.woodDark, { x: -0.45, y }));
          for (const z of [-0.2, 0.2]) {
            parts.push(part(new CylinderGeometry(0.045, 0.045, 0.28, 10), k.color.rope, { x: -0.45, y: 0.02, z }));
            for (const y of [-0.15, 0.19]) parts.push(part(new CylinderGeometry(0.06, 0.06, 0.025, 12), k.color.metal, { x: -0.45, y, z }));
          }
          parts.push(part(new BoxGeometry(0.02, 0.22, 0.2), k.tint.shield, { x: -0.49, y: 0.02 }));
          parts.push(part(new BoxGeometry(0.022, 0.06, 0.06), k.color.dark, { x: -0.495, y: 0.04 }));
          parts.push(...moved(ornamentBand(k, k.motifs.ornament, 0.18, k.color.accent), { x: -0.5, y: 0.12, ry: Math.PI / 2 }));
        } else {
          parts.push(part(new BoxGeometry(0.1, 0.14, 0.14), k.tint.shield, { x: -0.45, y: 0.0 }));
        }
        return parts;
      }));
      if (style === 'ballista') {
        for (const s of [-1, 1]) {
          const arm = piece(k, body, 'artillery-arm', () => [
            part(new BoxGeometry(0.06, 0.055, 0.44), k.color.woodDark, { z: 0.22 }),
            part(new BoxGeometry(0.075, 0.07, 0.05), k.color.metal, { z: 0.44 }),
          ]);
          arm.position.set(-0.45, 0.02, s * 0.2);
          // Swept sideways and back towards the crew, like a bow seen from above.
          arm.rotation.y = s > 0 ? 0.5 : Math.PI - 0.5;
          aim.add(arm);
          arms.push(arm);
        }
      } else {
        const arc = 1.6;
        const bow = piece(k, body, 'artillery-bow', () => {
          const g = new TorusGeometry(0.5, 0.026, 5, 18, arc);
          g.rotateX(Math.PI / 2);
          g.rotateY(arc / 2 - Math.PI);
          g.translate(-0.05, 0.02, 0);
          return [part(g, k.color.woodDark), part(new BoxGeometry(0.08, 0.06, 0.12), k.color.accent, { x: -0.55, y: 0.02 })];
        });
        aim.add(bow);
        arms.push(bow);
      }
      // The drawn bowstring, in two runs from the arm tips to the claw.
      const tip = style === 'ballista' ? new Vector3(-0.25, 0.02, 0.57) : new Vector3(-0.4, 0.02, 0.36);
      for (const s of [-1, 1]) {
        const run = piece(k, body, `artillery-string-${style}-${s}`, () => [limb(new Vector3(tip.x, tip.y, tip.z * s), CLAW, 0.008, 0.008, k.color.rope, 4)]);
        aim.add(run);
        strings.push(run);
      }
      missile = piece(k, body, 'artillery-bolt', () => [
        part(new CylinderGeometry(0.016, 0.016, 0.86, 6), k.color.wood, { x: -0.1, rz: Math.PI / 2 }),
        part(new ConeGeometry(0.034, 0.12, 6), k.color.metal, { x: -0.59, rz: Math.PI / 2 }),
        part(new BoxGeometry(0.07, 0.004, 0.07), k.tint.trim, { x: 0.28 }),
      ]);
      missile.position.y = 0.06;
      aim.add(missile);
      windlass = piece(k, body, 'artillery-windlass', () => [
        part(new CylinderGeometry(0.03, 0.03, 0.26, 8), k.color.wood, { rx: Math.PI / 2 }),
        part(new BoxGeometry(0.02, 0.2, 0.02), k.color.metal, { z: 0.14 }),
        part(new BoxGeometry(0.2, 0.02, 0.02), k.color.metal, { z: 0.14 }),
        part(new BoxGeometry(0.02, 0.2, 0.02), k.color.metal, { z: -0.14 }),
        part(new BoxGeometry(0.2, 0.02, 0.02), k.color.metal, { z: -0.14 }),
      ]);
      windlass.position.set(0.6, 0.09, 0);
      aim.add(windlass);
    } else if (style === 'catapult') {
      aim.add(piece(k, body, 'artillery-onager', () => [
        part(new BoxGeometry(0.06, 0.42, 0.06), k.color.wood, { x: -0.45, y: 0.12, z: 0.18 }),
        part(new BoxGeometry(0.06, 0.42, 0.06), k.color.wood, { x: -0.45, y: 0.12, z: -0.18 }),
        part(new BoxGeometry(0.1, 0.08, 0.46), k.tint.shield, { x: -0.45, y: 0.36 }),
        part(new CylinderGeometry(0.06, 0.06, 0.36, 10), k.color.rope, { x: 0.3, y: -0.05, rx: Math.PI / 2 }),
      ]));
      const arm = piece(k, body, 'artillery-onager-arm', () => [
        part(new BoxGeometry(0.85, 0.05, 0.06), k.color.woodDark, { x: -0.42 }),
        part(lathe([[0, 0], [0.07, 0.02], [0.08, 0.06], [0, 0.04]], 8), k.color.metal, { x: -0.86, y: 0.02 }),
        part(new SphereGeometry(0.05, 8, 6), k.color.stone, { x: -0.86, y: 0.07 }),
      ]);
      arm.position.set(0.3, -0.05, 0);
      arm.rotation.z = -0.35;
      aim.add(arm);
      arms.push(arm);
    } else if (style === 'cannon') {
      // Great bombard: barrel segments so it can sag when destroyed.
      aim.add(piece(k, body, 'artillery-cannon-bed', () => [part(new BoxGeometry(1.1, 0.12, 0.34), k.color.woodDark, { x: -0.1, y: -0.06 })]));
      let parent: Group = aim;
      barrelParts = [];
      for (let i = 0; i < 3; i++) {
        const seg = new Group();
        seg.position.set(i === 0 ? 0.3 : -0.36, i === 0 ? 0.08 : 0, 0);
        seg.add(piece(k, body, `artillery-cannon-${i}`, () => [
          part(new CylinderGeometry(0.12 - i * 0.012, 0.13 - i * 0.012, 0.36, 14), k.color.metal, { x: -0.18, rz: Math.PI / 2 }),
          part(new TorusGeometry(0.13 - i * 0.012, 0.016, 5, 14), k.color.accent, { x: -0.02, ry: Math.PI / 2 }),
        ]));
        parent.add(seg);
        barrelParts.push(seg);
        parent = seg;
      }
    } else {
      // Fire-arrow cart: a slanted rack full of arrows.
      aim.add(piece(k, body, 'artillery-rack', () => {
        const parts: Parts = [part(new BoxGeometry(0.5, 0.36, 0.42), k.tint.shield, { x: -0.2, y: 0.12, rz: 0.45 })];
        for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) parts.push(part(new CylinderGeometry(0.008, 0.008, 0.3, 4), k.color.metal, { x: -0.38 - i * 0.012, y: 0.34 + i * 0.02, z: -0.15 + j * 0.1, rz: 0.45 + Math.PI / 2 }));
        return parts;
      }));
    }

    // The engineer who lays and looses the piece.
    const gunner = piece(k, body, 'artillery-crew', () => figure(k, 0.6, 'officer'));
    gunner.position.set(bolter ? 0.88 : 1.05, 0, bolter ? -0.2 : 0.3);
    model.add(gunner);
    const anchor = new Group();
    anchor.position.set(1.15, 0.5, 0.2);
    frame.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      aim.rotation.y = Math.sin(time * 0.17 + phase) * 0.12;
      aim.rotation.z = -0.05 - (Math.sin(time * 0.25 + phase) * 0.5 + 0.5) * 0.08;
      if (windlass) windlass.rotation.z = Math.sin(time * 0.6 + phase) * 0.6;
      gunner.rotation.y = Math.sin(time * 0.4 + phase) * 0.4;
      if (style === 'catapult' && arms[0]) arms[0].rotation.z = -0.35 + Math.sin(time * 0.8 + phase) * 0.02;
    };

    model.wreck = async (ctx) => {
      ctx.emit('smoke', model.worldOf(new Vector3(-0.45, 0.5, 0)));
      ctx.emit('sparks', model.worldOf(new Vector3(-0.45, 0.5, 0)));
      // The string snaps first.
      for (const run of strings) run.visible = false;
      const jobs: Promise<void>[] = [];
      arms.forEach((arm, i) => {
        if (i === 0) {
          model.attach(arm);
          jobs.push(throwPart(ctx, arm, new Vector3(-0.9, 0.04, -0.55), 0.5, 0.85, new Vector3(3, 2, 1), new Vector3(Math.PI / 2, 1.2, 0)));
        } else jobs.push(lerpTo(ctx, 0.5, (e) => (arm.rotation.x = e * 0.9)));
      });
      if (missile) {
        model.attach(missile);
        jobs.push(throwPart(ctx, missile, new Vector3(-0.4, 0.03, 0.5), 0.35, 0.7, new Vector3(0, 2, 0), new Vector3(0, 1.0, 0)));
      }
      barrelParts.forEach((seg, i) => jobs.push(lerpTo(ctx, 0.9, (e) => (seg.rotation.z = e * (0.2 + i * 0.15)))));
      jobs.push(topple(ctx, gunner, 'z', -1.3, 0.8, 0.1));
      if (bolter) {
        // The trestle gives way and the slider pitches into the ground.
        jobs.push(lerpTo(ctx, 0.7, (e) => {
          aim.rotation.z = -0.05 + e * 0.45;
          aim.position.y = 0.45 - e * 0.2;
          frame.rotation.x = 0.12 * e;
        }, 0.1));
      } else {
        jobs.push(lerpTo(ctx, 0.6, (e) => (aim.rotation.z = -0.05 + e * 0.35), 0.1));
        const lost = wheels[ctx.random() < 0.5 ? 0 : 1]!;
        const sign = lost.position.z > 0 ? 1 : -1;
        model.attach(lost);
        jobs.push(throwPart(ctx, lost, new Vector3(0.3, 0.05, sign * 0.8), 0.25, 0.9, new Vector3(Math.PI / 2, 0, -4), new Vector3(sign * Math.PI / 2, 0.4, -4)));
        jobs.push(lerpTo(ctx, 0.6, (e) => {
          frame.rotation.x = sign * 0.14 * e;
          frame.position.y = -0.05 * e;
        }, 0.2));
      }
      await Promise.all(jobs);
    };
    return model;
  };
}

// ------------------------------------------------------------------ amphibian (1x2 boat)

function sailParts(k: KitStyle): Parts {
  switch (k.params.sail) {
    case 'square':
      return [part(new BoxGeometry(0.008, 0.42, 0.56), k.tint.cloth, { y: 0.56 }), part(new BoxGeometry(0.01, 0.06, 0.56), k.color.accent, { y: 0.7 }), part(new CylinderGeometry(0.008, 0.008, 0.66, 6), k.color.wood, { y: 0.78, rx: Math.PI / 2 })];
    case 'lateen': {
      const s = new Shape();
      s.moveTo(-0.4, 0);
      s.lineTo(0.3, 0);
      s.lineTo(-0.36, 0.62);
      s.closePath();
      return [part(new ShapeGeometry(s), k.tint.cloth, { y: 0.28 }), part(new CylinderGeometry(0.006, 0.006, 0.8, 6), k.color.wood, { x: -0.05, y: 0.6, rz: 1.0 })];
    }
    case 'battened': {
      const parts: Parts = [part(new BoxGeometry(0.008, 0.5, 0.5), k.tint.cloth, { y: 0.56 })];
      for (let i = 0; i < 5; i++) parts.push(part(new BoxGeometry(0.014, 0.01, 0.52), k.color.woodDark, { y: 0.34 + i * 0.11 }));
      return parts;
    }
    case 'none':
      return [part(new BoxGeometry(0.3, 0.12, 0.26), k.tint.cloth, { y: 0.16 })];
  }
}

/** A boat across the two cells, rowing on the spot; it lists and settles when sunk. */
export function kitAmphibian(k: KitStyle): UnitFactory {
  return ({ body }: UnitFactoryOptions) => {
    const p = k.params;
    const model = new UnitModel('amphibian', body);
    const craft = new Group();
    craft.position.y = 0.08;
    model.add(craft);
    craft.add(piece(k, body, `boat-hull-${p.boat}`, () => hull(k, p.boat)));
    const mastPivot = new Group();
    mastPivot.position.set(0.05, 0.08, 0);
    mastPivot.add(piece(k, body, `boat-rig-${p.sail}`, () => [part(new CylinderGeometry(0.014, 0.018, p.sail === 'none' ? 0.1 : 0.85, 6), k.color.wood, { y: p.sail === 'none' ? 0.05 : 0.42 }), ...sailParts(k)]));
    craft.add(mastPivot);
    const crewMesh = piece(k, body, 'boat-crew', () => crew(k, 0.5));
    crewMesh.position.set(0.5, 0.08, 0);
    craft.add(crewMesh);
    const oars: Group[] = [];
    const rowed = p.boat === 'trireme' || p.boat === 'longship' || p.boat === 'canoe' || p.boat === 'reed';
    if (rowed) {
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const oar = new Group();
          oar.position.set(-0.4 + i * 0.22, 0.1, side * 0.17);
          const blade = piece(k, body, 'boat-oar', () => [part(new BoxGeometry(0.012, 0.012, 0.32), k.color.woodDark, { z: 0.16 }), part(new BoxGeometry(0.05, 0.006, 0.06), k.color.wood, { z: 0.32 })]);
          blade.rotation.x = 0.5;
          blade.scale.z = side;
          oar.add(blade);
          craft.add(oar);
          oars.push(oar);
        }
      }
    }
    const anchor = new Group();
    anchor.position.set(0.05, p.sail === 'none' ? 0.3 : 0.95, 0);
    mastPivot.add(anchor);
    model.flagAnchor = anchor;

    const phase = Math.random() * 6;
    model.idle = (time) => {
      craft.position.y = 0.08 + Math.sin(time * 1.8 + phase) * 0.015;
      craft.rotation.x = Math.sin(time * 1.1 + phase) * 0.03;
      craft.rotation.z = Math.sin(time * 0.8 + phase) * 0.012;
      mastPivot.rotation.x = Math.sin(time * 0.9 + phase) * 0.02;
      oars.forEach((oar, i) => {
        const side = i < oars.length / 2 ? 1 : -1;
        const stroke = time * 2.2 + phase;
        oar.rotation.y = Math.sin(stroke) * 0.35 * side;
        oar.rotation.x = Math.max(0, Math.cos(stroke)) * 0.2 * side;
      });
    };

    model.wreck = async (ctx) => {
      ctx.emit('splash', model.worldOf(new Vector3(0, 0.1, 0)));
      const side = ctx.random() < 0.5 ? -1 : 1;
      const mast = topple(ctx, mastPivot, 'x', side * 1.2, 1.0, 0.15);
      const list = lerpTo(ctx, 1.2, (e) => {
        craft.rotation.x = side * 0.32 * e;
        craft.rotation.z = 0.12 * e;
        craft.position.y = 0.08 - e * 0.1;
      });
      const oarsDrop = lerpTo(ctx, 0.8, (e) => oars.forEach((o) => (o.rotation.x = e * 0.6)));
      const crewDown = topple(ctx, crewMesh, 'z', 1.3, 0.7, 0.1);
      await Promise.all([mast, list, oarsDrop, crewDown]);
    };
    return model;
  };
}
