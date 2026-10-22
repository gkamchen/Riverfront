import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { easeInOutCubic } from '../../anim/easing';
import { RIVER_SWIM_X, WATER_LEVEL, riverBedY } from '../layout';
import { disposeGroup, flatDistance, newGroup, type LifeModule, type WildlifeContext } from './shared';

type HeronState = 'stand' | 'strike' | 'takeoff' | 'away' | 'landing';

/** Colours and bill of a wading bird; the behaviour is the same for all. */
export interface WaderLook {
  body: string;
  neck: string;
  head: string;
  dark: string;
  bill: string;
  legs: string;
  wing: string;
  /** Long down-curved bill (ibis) instead of a straight dagger (heron). */
  curvedBill: boolean;
  crest: boolean;
  scale: number;
}

export const HERON_LOOK: WaderLook = {
  body: '#aeb4b8',
  neck: '#e9eaea',
  head: '#e9eaea',
  dark: '#26282b',
  bill: '#d9a52b',
  legs: '#d9a52b',
  wing: '#8e969c',
  curvedBill: false,
  crest: true,
  scale: 1.2,
};

/** Sacred ibis: white plumage, bare black head and neck, black curved bill. */
export const IBIS_LOOK: WaderLook = {
  body: '#efeee8',
  neck: '#1d1d1f',
  head: '#1d1d1f',
  dark: '#1d1d1f',
  bill: '#1d1d1f',
  legs: '#2a2a2c',
  wing: '#e4e2da',
  curvedBill: true,
  crest: false,
  scale: 1.0,
};

function wingGeometry(): BufferGeometry {
  // A flat, slightly swept wing in the xz plane, hinged at the origin.
  const shape = [
    [0, 0, -0.05],
    [0, 0, 0.07],
    [-0.12, 0, 0.42],
    [-0.2, 0, 0.5],
    [-0.26, 0, 0.36],
    [-0.16, 0, -0.04],
  ];
  const positions: number[] = [];
  for (let i = 1; i < shape.length - 1; i++) positions.push(...shape[0]!, ...shape[i]!, ...shape[i + 1]!);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * A grey heron wading by the near bank. Every so often it spears a fish;
 * explosions send it flapping off the board, and it comes back later.
 */
export class HeronModule implements LifeModule {
  readonly group = newGroup('heron');
  readonly #ctx: WildlifeContext;
  readonly #bird = new Group();
  readonly #neck = new Group();
  readonly #head = new Group();
  readonly #wings: Group[] = [];
  readonly #legs: Mesh[] = [];
  readonly #catch: Mesh;
  #state: HeronState = 'stand';
  #t = 0;
  #nextStrike: number;
  #home = new Vector3();
  #from = new Vector3();
  #to = new Vector3();
  #awayTime = 0;
  #fold = 1;

  constructor(ctx: WildlifeContext, look: WaderLook = HERON_LOOK) {
    this.#ctx = ctx;
    const grey = new MeshStandardMaterial({ color: new Color(look.body), roughness: 0.7 });
    const white = new MeshStandardMaterial({ color: new Color(look.neck), roughness: 0.6 });
    const headMat = new MeshStandardMaterial({ color: new Color(look.head), roughness: 0.6 });
    const dark = new MeshStandardMaterial({ color: new Color(look.dark), roughness: 0.6 });
    const beak = new MeshStandardMaterial({ color: new Color(look.bill), roughness: 0.4 });
    const legMat = new MeshStandardMaterial({ color: new Color(look.legs), roughness: 0.5 });
    const wingMat = new MeshStandardMaterial({ color: new Color(look.wing), roughness: 0.7, side: DoubleSide });

    const body = new Mesh(new SphereGeometry(0.1, 14, 10), grey);
    body.scale.set(1.6, 0.85, 0.85);
    body.castShadow = true;
    const tail = new Mesh(new ConeGeometry(0.06, 0.16, 8), dark);
    tail.rotation.z = Math.PI / 2 + 0.4;
    tail.position.set(-0.17, -0.02, 0);
    this.#bird.add(body, tail);

    // Neck: lower segment from the chest, head on top.
    this.#neck.position.set(0.12, 0.04, 0);
    const neck = new Mesh(new CylinderGeometry(0.022, 0.03, 0.26, 8), white);
    neck.position.y = 0.13;
    neck.castShadow = true;
    this.#neck.add(neck);
    this.#head.position.y = 0.26;
    const head = new Mesh(new SphereGeometry(0.04, 10, 8), headMat);
    head.scale.set(1.3, 1, 1);
    const crest = new Mesh(new ConeGeometry(0.012, 0.12, 5), dark);
    crest.rotation.z = Math.PI / 2 + 0.3;
    crest.position.set(-0.07, 0.02, 0);
    crest.visible = look.crest;
    const bill = new Group();
    if (look.curvedBill) {
      // Three short segments bending down along an arc.
      for (let i = 0; i < 3; i++) {
        const seg = new Mesh(new CylinderGeometry(0.008 - i * 0.002, 0.011 - i * 0.002, 0.075, 6), beak);
        const a = -Math.PI / 2 - i * 0.32;
        seg.rotation.z = a;
        seg.position.set(0.075 + i * 0.065, -0.005 - i * i * 0.012, 0);
        bill.add(seg);
      }
    } else {
      const dagger = new Mesh(new ConeGeometry(0.014, 0.16, 6), beak);
      dagger.rotation.z = -Math.PI / 2;
      dagger.position.set(0.12, -0.005, 0);
      bill.add(dagger);
    }
    this.#catch = new Mesh(new SphereGeometry(0.02, 6, 4), new MeshStandardMaterial({ color: new Color('#c7d4d6'), metalness: 0.4, roughness: 0.3 }));
    this.#catch.scale.set(2.5, 0.8, 0.6);
    this.#catch.position.set(0.17, -0.01, 0);
    this.#catch.visible = false;
    this.#head.add(head, crest, bill, this.#catch);
    this.#neck.add(this.#head);
    this.#neck.rotation.z = -0.15;
    this.#bird.add(this.#neck);

    for (const side of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(0.02, 0.05, side * 0.07);
      const wing = new Mesh(wingGeometry(), wingMat);
      wing.scale.set(1, 1, side);
      wing.castShadow = true;
      pivot.add(wing);
      this.#bird.add(pivot);
      this.#wings.push(pivot);
    }
    for (const side of [-1, 1]) {
      const leg = new Mesh(new CylinderGeometry(0.008, 0.008, 0.42, 5), legMat);
      leg.position.set(0, -0.26, side * 0.035);
      this.#bird.add(leg);
      this.#legs.push(leg);
    }

    this.#bird.scale.setScalar(look.scale);
    this.group.add(this.#bird);
    this.#pickHome();
    this.#bird.position.copy(this.#home);
    this.#nextStrike = ctx.rng.range(6, 14);
  }

  trigger(event: string): boolean {
    if (event === 'heronFish' && this.#state === 'stand') this.#nextStrike = 0;
    else if (event === 'heronFly' && this.#state === 'stand') this.#takeoff();
    else return false;
    return true;
  }

  onExplosion(at: Vector3, power: number): void {
    if (this.#state !== 'stand' && this.#state !== 'strike') return;
    if (power >= 0.5 || flatDistance(at, this.#bird.position) < 5) this.#takeoff();
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    const time = ctx.time;
    this.#t += dt;
    switch (this.#state) {
      case 'stand': {
        this.#foldWings(dt);
        this.#neck.rotation.z = -0.15 + Math.sin(time * 0.7) * 0.05;
        this.#head.rotation.y = Math.sin(time * 0.45) * 0.5;
        this.#nextStrike -= dt;
        if (this.#nextStrike <= 0) {
          this.#state = 'strike';
          this.#t = 0;
        }
        break;
      }
      case 'strike': {
        // Lunge, hold under water, lift with a fish, swallow.
        const t = this.#t;
        const lunge = t < 0.18 ? t / 0.18 : t < 0.45 ? 1 : t < 0.8 ? 1 - (t - 0.45) / 0.35 : 0;
        this.#neck.rotation.z = -0.15 - lunge * 1.55;
        this.#head.rotation.z = -lunge * 0.4;
        if (t >= 0.18 && t - dt < 0.18) {
          const tip = this.#bird.localToWorld(new Vector3(0.45, -0.1, 0));
          tip.y = WATER_LEVEL;
          ctx.splash(tip, 0.4);
          ctx.sound('plop', tip);
          this.#catch.visible = ctx.rng.chance(0.65);
        }
        if (t > 1.4) this.#catch.visible = false;
        if (t > 1.8) {
          this.#state = 'stand';
          this.#nextStrike = ctx.rng.range(12, 25);
        }
        break;
      }
      case 'takeoff': {
        const u = Math.min(1, this.#t / 3.2);
        this.#flap(time, 1);
        this.#bird.position.lerpVectors(this.#from, this.#to, easeInOutCubic(u));
        this.#bird.position.y += Math.sin(Math.PI * u * 0.5) * 2.5;
        if (u >= 1) {
          this.#state = 'away';
          this.#t = 0;
          this.#bird.visible = false;
          this.#awayTime = ctx.rng.range(18, 30);
        }
        break;
      }
      case 'away':
        if (this.#t > this.#awayTime) {
          this.#pickHome();
          this.#from.copy(this.#home).add(new Vector3(this.#home.x > 0 ? 8 : -8, 4, 4));
          this.#to.copy(this.#home);
          this.#faceTowards(this.#to.x - this.#from.x, this.#to.z - this.#from.z);
          this.#bird.visible = true;
          this.#state = 'landing';
          this.#t = 0;
        }
        break;
      case 'landing': {
        const u = Math.min(1, this.#t / 3);
        this.#flap(time, 1 - u * 0.6);
        this.#bird.position.lerpVectors(this.#from, this.#to, easeInOutCubic(u));
        this.#legs.forEach((leg) => (leg.rotation.z = (1 - u) * 1.2));
        if (u >= 1) {
          this.#state = 'stand';
          this.#bird.rotation.y = this.#home.z > 0 ? Math.PI * 0.85 : -Math.PI * 0.15;
          this.#nextStrike = ctx.rng.range(6, 14);
          ctx.splash(this.#home.clone().setY(WATER_LEVEL), 0.3);
        }
        break;
      }
    }
  }

  dispose(): void {
    disposeGroup(this.group);
  }

  #pickHome(): void {
    const rng = this.#ctx.rng;
    const x = (rng.chance(0.5) ? -1 : 1) * rng.range(RIVER_SWIM_X - 2.5, RIVER_SWIM_X - 0.6);
    const z = rng.chance(0.65) ? 1.22 : -1.22;
    const feet = Math.max(riverBedY(z), WATER_LEVEL - 0.12);
    this.#home.set(x, feet + 0.55, z);
    this.#bird.rotation.y = z > 0 ? Math.PI * 0.85 : -Math.PI * 0.15;
  }

  #takeoff(): void {
    this.#state = 'takeoff';
    this.#t = 0;
    this.#catch.visible = false;
    this.#from.copy(this.#bird.position);
    const away = this.#bird.position.x > 0 ? 1 : -1;
    this.#to.set(away * 22, 6, this.#bird.position.z * 4 - 6);
    this.#faceTowards(this.#to.x - this.#from.x, this.#to.z - this.#from.z);
    this.#ctx.sound('flap', this.#from);
    this.#ctx.sound('bird', this.#from);
    this.#ctx.splash(this.#from.clone().setY(WATER_LEVEL), 0.5);
    this.#legs.forEach((leg) => (leg.rotation.z = 1.2));
  }

  #faceTowards(dx: number, dz: number): void {
    this.#bird.rotation.y = Math.atan2(-dz, dx);
  }

  #flap(time: number, strength: number): void {
    this.#fold = 0;
    const a = Math.sin(time * 11) * 0.9 * strength;
    this.#wings.forEach((pivot, i) => {
      pivot.rotation.x = (i === 0 ? 1 : -1) * a;
      pivot.rotation.y = 0;
    });
    this.#neck.rotation.z = -0.9;
  }

  #foldWings(dt: number): void {
    this.#fold += (1 - this.#fold) * Math.min(1, dt * 6);
    this.#wings.forEach((pivot, i) => {
      pivot.rotation.x *= Math.exp(-dt * 8);
      pivot.rotation.y = (i === 0 ? 1 : -1) * (Math.PI / 2 - 0.12) * this.#fold;
    });
    for (const leg of this.#legs) leg.rotation.z *= Math.exp(-dt * 8);
  }
}
