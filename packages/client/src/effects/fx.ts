import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  PlaneGeometry,
  PointLight,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import {
  FIELD_INNER_Z,
  FRAME_TOP,
  OUTER_HALF_X,
  OUTER_HALF_Z,
  PLATE_HALF_X,
  PLATE_HALF_Z,
  TABLE_Y,
  TILE_TOP,
  WATER_LEVEL,
} from '../board/layout';
import type { ReflectedLight } from '../board/water';
import type { MaterialLibrary } from '../materials/library';
import { TEAM_COLORS } from '../materials/palettes';
import type { TeamId } from '../units/roles';
import type { UnitEmitKind } from '../units/unitModel';
import { rand } from '../util/random';
import { Debris } from './debris';
import { Fireworks } from './fireworks';
import { ParticleSystem, type EmitOptions } from './particles';
import { Shockwaves } from './shockwaves';
import { TimeWarp } from './timeWarp';
import { Banners, Rain } from './weather';

interface Emitter {
  position: Vector3;
  remaining: number;
  rate: number;
  carry: number;
}

interface Flash {
  sprite: Sprite;
  age: number;
  life: number;
  size: number;
}

/** What the river must offer the effects (ripples and reflections). */
export interface WaterSurface {
  addRipple(x: number, z: number, strength?: number): void;
  setReflections(lights: readonly ReflectedLight[]): void;
  setRain(amount: number): void;
  readonly mode: 'water' | 'lava' | 'ice';
}

export type MissSurface = 'earth' | 'rock' | 'water';

const DUST = new Color('#a07a52');
const DUST_END = new Color('#6b5640');
const SMOKE = new Color('#3a3430');
const SMOKE_END = new Color('#8a8580');
const FIRE = new Color(3.4, 1.5, 0.42);
const FIRE_END = new Color(0.9, 0.18, 0.04);
const SPARK = new Color(5, 3.2, 1.2);
const SPARK_END = new Color(2.5, 0.6, 0.1);
const ARC = new Color(2.2, 3.6, 6);
const ARC_END = new Color(0.4, 0.8, 2.5);
const STONE_CHIP = new Color('#6f6a66');
const SOIL_CHIP = new Color('#5c3f27');
const EMBER = new Color(3, 1.1, 0.3);
const RING_WARM = new Color(1.1, 0.6, 0.22);
const RING_HOT = new Color(2.2, 1.6, 0.9);
const RING_DUST = new Color(0.3, 0.22, 0.15);
const RING_WATER = new Color(0.45, 0.6, 0.65);
const SPRAY = new Color(0.75, 0.9, 0.95);
const MIST = new Color(0.85, 0.92, 0.95);
const STEAM = new Color('#e7e4df');
const TRAIL = new Color(5, 3, 1.2);
const TRAIL_END = new Color(0.8, 0.25, 0.08);
const LAVA = new Color(3.2, 1.0, 0.2);
const ROCK_SMOKE = new Color('#8d8781');
const ROCK_SMOKE_END = new Color('#5d5955');
const ICE_CHIP = new Color('#cfe6f5');
const DARK_CHIP = new Color('#2a2624');
const TRAIL_SMOKE = new Color('#b8b0a8');

/** Scorch decals kept on the board; after that the oldest one is reused. */
const MAX_SCORCHES = 40;

function flashTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,236,190,0.9)');
    g.addColorStop(0.45, 'rgba(255,150,60,0.35)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

/**
 * Owns every short-lived visual effect: particles, chips, rings, flashes,
 * scorch marks, endings (fireworks, rain, flags) and game-time warping.
 * Gameplay code only asks for "dust here" or "explosion there".
 */
export class EffectsDirector {
  readonly group = new Group();
  /** Hit-stop / slow motion. Feed the frame delta through `warp(dt)`. */
  readonly time = new TimeWarp();
  readonly fireworks = new Fireworks();
  readonly rain = new Rain();
  readonly banners = new Banners();
  readonly #glow = new ParticleSystem(1800, true);
  readonly #smoke = new ParticleSystem(1600, false);
  readonly #debris: Debris;
  readonly #rings: Shockwaves;
  readonly #light = new PointLight(new Color('#ffb060'), 0, 9, 1.6);
  readonly #flashes: Flash[] = [];
  readonly #scorchGeometry = new PlaneGeometry(1.15, 1.15);
  readonly #scorches = new Group();
  readonly #scorchPool: Mesh[] = [];
  #nextScorch = 0;
  readonly #flashTexture: CanvasTexture;
  // Reused option objects for the per-frame emitters (no garbage per frame).
  readonly #trailGlow: EmitOptions = { origin: new Vector3(), count: 2, radius: 0.03, speed: [0.05, 0.25], spread: 1, life: [0.25, 0.45], size: [0.16, 0.26], grow: 0.2, color: TRAIL, colorEnd: TRAIL_END };
  readonly #trailSmoke: EmitOptions = { origin: new Vector3(), count: 1, speed: [0.05, 0.2], spread: 1, life: [0.6, 1.1], size: [0.12, 0.2], grow: 2.5, color: TRAIL_SMOKE, opacity: 0.35, drag: 1 };
  readonly #wreckSmoke: EmitOptions = { origin: new Vector3(), count: 1, radius: 0.12, speed: [0.1, 0.3], spread: 0.2, lift: 0.7, life: [1.4, 2.4], size: [0.22, 0.34], grow: 3.2, color: SMOKE, colorEnd: SMOKE_END, opacity: 0.45, gravity: -0.2, drag: 0.6 };
  readonly #wreckEmber: EmitOptions = { origin: new Vector3(), count: 1, radius: 0.12, speed: [0.2, 0.6], spread: 0.3, lift: 0.6, life: [0.5, 1], size: [0.04, 0.07], color: EMBER, colorEnd: FIRE_END, drag: 1 };
  readonly #emitters: Emitter[] = [];
  readonly #materials: MaterialLibrary;
  readonly #shake: (strength: number) => void;
  #water: WaterSurface | null = null;
  #lightLevel = 0;
  #density = 1;
  /** Hit-stops on explosions; turn off for reduced motion. */
  autoHitstop = true;

  constructor(materials: MaterialLibrary, shake: (strength: number) => void) {
    this.#materials = materials;
    this.#shake = shake;
    this.#debris = new Debris(materials.debris, 320, TILE_TOP);
    // Chips land on what is really there: table, frame, tiles, or sink into the river.
    this.#debris.setGround((x, z, out) => {
      const ax = Math.abs(x);
      const az = Math.abs(z);
      out.liquid = false;
      if (ax > OUTER_HALF_X || az > OUTER_HALF_Z) out.y = TABLE_Y;
      else if (ax > PLATE_HALF_X || az > PLATE_HALF_Z) out.y = FRAME_TOP;
      else if (az < FIELD_INNER_Z - 0.05) {
        out.y = WATER_LEVEL;
        out.liquid = (this.#water?.mode ?? 'water') !== 'ice';
      } else out.y = TILE_TOP;
      return out;
    });
    this.#rings = new Shockwaves(this.group, 10);
    this.#scorchGeometry.rotateX(-Math.PI / 2);
    this.#light.position.set(0, 1.2, 0);
    const texture = flashTexture();
    this.#flashTexture = texture;
    for (let i = 0; i < 4; i++) {
      const sprite = new Sprite(new SpriteMaterial({ map: texture, blending: AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      sprite.visible = false;
      sprite.renderOrder = 7;
      this.group.add(sprite);
      this.#flashes.push({ sprite, age: 1, life: 1, size: 1 });
    }
    this.group.name = 'effects';
    this.group.add(
      this.#smoke.points,
      this.#glow.points,
      this.#debris.mesh,
      this.#light,
      this.#scorches,
      this.fireworks.group,
      this.rain.group,
      this.banners.group,
    );
  }

  /** Lets splashes ripple the river and fireworks reflect on it. */
  attachWater(water: WaterSurface): void {
    this.#water = water;
  }

  /** Lower particle counts for reduced motion or low quality. */
  setDensity(density: number): void {
    this.#density = density;
    this.fireworks.setDensity(Math.max(0.35, density));
    this.rain.setDensity(Math.max(0.35, density));
  }

  setViewport(heightPx: number, fov: number): void {
    this.#glow.setScale(heightPx, fov);
    this.#smoke.setScale(heightPx, fov);
    this.fireworks.setViewport(heightPx, fov);
    this.rain.setViewport(heightPx, fov);
  }

  /** Scales a real frame delta by the current hit-stop / slow-motion. */
  warp(realDt: number): number {
    return this.time.update(realDt);
  }

  hitstop(duration = 0.07, scale = 0.03): void {
    this.time.hitstop(duration, scale);
  }

  /** Kill-cam hook: slow everything that runs on warped time. */
  slowMo(duration: number, scale = 0.3): void {
    this.time.slowMo(duration, scale);
  }

  // ------------------------------------------------------------ impacts

  dust(at: Vector3): void {
    this.#smoke.emit({
      origin: at,
      count: this.#n(34),
      radius: 0.3,
      speed: [0.6, 1.6],
      spread: 0.5,
      lift: 0.5,
      life: [0.9, 1.7],
      size: [0.35, 0.6],
      grow: 2.6,
      color: DUST,
      colorEnd: DUST_END,
      opacity: 0.6,
      gravity: -0.15,
      drag: 2.6,
    });
    this.#debris.burst({ origin: at, count: this.#n(10), color: SOIL_CHIP, size: [0.025, 0.05], speed: [0.6, 1.6], lift: 2.2 });
    this.#rings.spawn(at, RING_DUST, 1.1, 0.55);
  }

  rockHit(at: Vector3): void {
    this.#glow.emit({
      origin: at.clone().setY(at.y + 0.25),
      count: this.#n(26),
      radius: 0.1,
      speed: [2, 4.5],
      spread: 0.6,
      life: [0.18, 0.45],
      size: [0.05, 0.09],
      color: SPARK,
      colorEnd: SPARK_END,
      gravity: 9,
      drag: 1.2,
    });
    this.#smoke.emit({
      origin: at,
      count: this.#n(18),
      radius: 0.25,
      speed: [0.4, 1.1],
      spread: 0.5,
      lift: 0.4,
      life: [0.8, 1.4],
      size: [0.3, 0.5],
      grow: 2.2,
      color: ROCK_SMOKE,
      colorEnd: ROCK_SMOKE_END,
      opacity: 0.6,
      drag: 2.4,
    });
    this.#debris.burst({ origin: at.clone().setY(at.y + 0.2), count: this.#n(22), color: STONE_CHIP, size: [0.03, 0.07], speed: [1, 2.6], lift: 3.2 });
    this.#rings.spawn(at, RING_DUST, 1.3, 0.45);
    this.#shake(0.12);
  }

  /** Feedback for a shot that found nothing: dust on earth, chips on rock, a splash in water. */
  miss(at: Vector3, surface: MissSurface): void {
    if (surface === 'rock') {
      this.rockHit(at);
      return;
    }
    if (surface === 'water') {
      this.waterSplash(at, 1);
      return;
    }
    // A small, soft puff: clearly a miss, nothing like an explosion.
    this.#smoke.emit({
      origin: at,
      count: this.#n(22),
      radius: 0.18,
      speed: [0.3, 0.9],
      spread: 0.45,
      lift: 0.35,
      life: [0.7, 1.3],
      size: [0.22, 0.38],
      grow: 2.2,
      color: DUST,
      colorEnd: DUST_END,
      opacity: 0.5,
      gravity: -0.1,
      drag: 2.8,
    });
    this.#debris.burst({ origin: at, count: this.#n(8), color: SOIL_CHIP, size: [0.02, 0.04], speed: [0.4, 1.1], lift: 1.8 });
    this.#rings.spawn(at, RING_DUST, 0.8, 0.45);
  }

  /** Column of water (or a lava gout / ice shards, depending on the river). */
  waterSplash(at: Vector3, power = 1): void {
    const mode = this.#water?.mode ?? 'water';
    const surface = at.clone().setY(WATER_LEVEL + 0.02);
    if (mode === 'ice') {
      this.#debris.burst({ origin: surface, count: this.#n(18 * power), color: ICE_CHIP, size: [0.03, 0.07], speed: [0.8, 2.2], lift: 3 });
      this.#smoke.emit({ origin: surface, count: this.#n(14), radius: 0.2, speed: [0.3, 0.8], spread: 0.5, lift: 0.3, life: [0.6, 1.2], size: [0.25, 0.4], grow: 2, color: MIST, opacity: 0.45, drag: 2.5 });
      this.#rings.spawn(surface, RING_WATER, 1.1 * power, 0.5);
      return;
    }
    const lava = mode === 'lava';
    const system = lava ? this.#glow : this.#smoke;
    system.emit({
      origin: surface,
      count: this.#n(46 * power),
      radius: 0.12,
      speed: [2.2 * power, 4 * power],
      spread: 0.1,
      life: [0.6, 1.1],
      size: lava ? [0.07, 0.13] : [0.09, 0.18],
      grow: 1.3,
      color: lava ? LAVA : SPRAY,
      colorEnd: lava ? FIRE_END : MIST,
      opacity: 0.85,
      gravity: 8,
      drag: 0.5,
    });
    system.emit({
      origin: surface,
      count: this.#n(30 * power),
      radius: 0.25,
      speed: [1, 2],
      spread: 0.42,
      lift: 0.6,
      life: [0.4, 0.8],
      size: [0.05, 0.1],
      color: lava ? LAVA : SPRAY,
      colorEnd: lava ? FIRE_END : SPRAY,
      opacity: 0.8,
      gravity: 7,
      drag: 0.8,
    });
    if (!lava) {
      this.#smoke.emit({ origin: surface, count: this.#n(10), radius: 0.3, speed: [0.2, 0.5], spread: 0.6, lift: 0.4, life: [0.8, 1.5], size: [0.35, 0.55], grow: 2, color: MIST, opacity: 0.3, drag: 2 });
    }
    this.#rings.spawn(surface, lava ? RING_WARM : RING_WATER, 1.4 * power, 0.6);
    this.#water?.addRipple(at.x, at.z, 1.2 * power);
  }

  /** Bigger, layered blast: flash, double shockwave, fireball, sparks, smoke skirt, debris. */
  explosion(at: Vector3, team: Color, power = 1): void {
    const core = at.clone().setY(at.y + 0.35);
    this.#flashSprite(core, 2.4 * power);
    this.#glow.emit({
      origin: core,
      count: this.#n(56 * power),
      radius: 0.15,
      speed: [0.8, 2.6],
      spread: 1,
      lift: 1,
      life: [0.25, 0.6],
      size: [0.24, 0.5],
      grow: 1.8,
      color: FIRE,
      colorEnd: FIRE_END,
      drag: 3.5,
    });
    this.#glow.emit({
      origin: core,
      count: this.#n(110 * power),
      radius: 0.08,
      speed: [3, 8],
      spread: 0.75,
      lift: 1.5,
      life: [0.4, 1.0],
      size: [0.045, 0.09],
      color: SPARK,
      colorEnd: SPARK_END,
      gravity: 9.8,
      drag: 1.1,
    });
    this.#smoke.emit({
      origin: core,
      count: this.#n(60 * power),
      radius: 0.3,
      speed: [0.5, 1.8],
      spread: 0.7,
      lift: 1.4,
      life: [1.6, 3],
      size: [0.3, 0.55],
      grow: 2.8,
      color: SMOKE,
      colorEnd: SMOKE_END,
      opacity: 0.55,
      gravity: -0.35,
      drag: 1.8,
    });
    // Low skirt of dust pushed outwards along the ground.
    this.#smoke.emit({
      origin: at.clone().setY(at.y + 0.05),
      count: this.#n(30 * power),
      radius: 0.2,
      speed: [2, 3.2],
      spread: 0.52,
      lift: 0.05,
      life: [0.7, 1.3],
      size: [0.25, 0.4],
      grow: 2.4,
      color: DUST,
      colorEnd: DUST_END,
      opacity: 0.4,
      drag: 4,
    });
    this.#debris.burst({ origin: core, count: this.#n(20 * power), color: team, size: [0.035, 0.07], speed: [1.5, 3.4], lift: 4 });
    this.#debris.burst({ origin: core, count: this.#n(16 * power), color: DARK_CHIP, size: [0.03, 0.06], speed: [1, 3], lift: 3.5 });
    this.#rings.spawn(at, RING_HOT, 1.2 * power, 0.25);
    this.#rings.spawn(at, RING_WARM, 2.2 * power, 0.6);
    this.#flashLight(core, power);
    this.#shake(0.45 * power);
    this.scorch(at);
    this.#emitters.push({ position: core.clone().setY(at.y + 0.3), remaining: 4.5, rate: 9, carry: 0 });
    if (this.autoHitstop) this.time.hitstop(0.07 * Math.min(1.5, power));
  }

  muzzle(at: Vector3): void {
    this.#glow.emit({
      origin: at,
      count: this.#n(18),
      radius: 0.05,
      speed: [0.5, 1.8],
      spread: 1,
      life: [0.15, 0.3],
      size: [0.18, 0.32],
      color: FIRE,
      colorEnd: FIRE_END,
      drag: 4,
    });
    this.#flashLight(at, 0.35);
  }

  /** Called every frame while a projectile flies; allocates nothing. */
  trail(at: Vector3): void {
    this.#trailGlow.origin.copy(at);
    this.#glow.emit(this.#trailGlow);
    if (Math.random() < 0.5 * this.#density) {
      this.#trailSmoke.origin.copy(at);
      this.#smoke.emit(this.#trailSmoke);
    }
  }

  /** Small spray (kept for older callers); see `waterSplash` for a full splash. */
  splash(at: Vector3): void {
    this.#smoke.emit({
      origin: at,
      count: this.#n(24),
      radius: 0.15,
      speed: [1.2, 2.6],
      spread: 0.25,
      life: [0.5, 0.9],
      size: [0.08, 0.16],
      grow: 1.4,
      color: SPRAY,
      opacity: 0.85,
      gravity: 7,
      drag: 0.8,
    });
  }

  /** Burn mark on the tiles; at most MAX_SCORCHES, then the oldest one moves. */
  scorch(at: Vector3): void {
    let mark = this.#scorchPool[this.#nextScorch];
    if (!mark) {
      mark = new Mesh(this.#scorchGeometry, this.#materials.scorch);
      mark.receiveShadow = true;
      mark.renderOrder = 1;
      this.#scorchPool.push(mark);
      this.#scorches.add(mark);
    }
    this.#nextScorch = (this.#nextScorch + 1) % MAX_SCORCHES;
    mark.visible = true;
    mark.position.set(at.x, TILE_TOP + 0.004, at.z);
    mark.rotation.y = Math.random() * Math.PI * 2;
  }

  /** Requests coming from unit wreck animations. */
  unitEmit(kind: UnitEmitKind, at: Vector3): void {
    switch (kind) {
      case 'sparks':
        this.#glow.emit({ origin: at, count: this.#n(30), radius: 0.05, speed: [1.5, 3.5], spread: 0.7, life: [0.2, 0.5], size: [0.04, 0.07], color: SPARK, colorEnd: SPARK_END, gravity: 9, drag: 1 });
        break;
      case 'arc':
        this.#glow.emit({ origin: at, count: this.#n(24), radius: 0.08, speed: [1, 3], spread: 1, life: [0.08, 0.22], size: [0.05, 0.1], color: ARC, colorEnd: ARC_END, drag: 3 });
        this.#flashSprite(at, 0.6);
        break;
      case 'smoke':
        this.#smoke.emit({ origin: at, count: this.#n(16), radius: 0.1, speed: [0.2, 0.6], spread: 0.4, lift: 0.6, life: [1, 2], size: [0.2, 0.35], grow: 2.5, color: SMOKE, colorEnd: SMOKE_END, opacity: 0.5, gravity: -0.2, drag: 1.5 });
        break;
      case 'steam':
        this.#smoke.emit({ origin: at, count: this.#n(12), radius: 0.06, speed: [0.3, 0.7], spread: 0.3, lift: 0.5, life: [0.8, 1.4], size: [0.15, 0.25], grow: 2.4, color: STEAM, opacity: 0.45, gravity: -0.3, drag: 1.4 });
        break;
      case 'splash':
        this.waterSplash(at, 0.6);
        break;
      case 'dust':
        this.dust(at.clone().setY(TILE_TOP));
        break;
    }
  }

  // ------------------------------------------------------------ endings

  /** Fireworks over the river in the winner's colours, flags up. */
  victory(team: TeamId, seconds = 9): void {
    const c = TEAM_COLORS[team];
    const hdr = (color: Color, k: number) => color.clone().multiplyScalar(k);
    this.fireworks.start(seconds, [hdr(c.glow, 1.8), hdr(c.main, 2.2), new Color(2.4, 1.5, 0.35), new Color(1.6, 1.7, 2.2)]);
    this.banners.raise();
  }

  /** Rain over the board and the loser's flag coming down. */
  defeat(loser: TeamId): void {
    this.rain.start();
    this.#water?.setRain(1);
    this.banners.lower(loser);
  }

  /** Stops fireworks and rain and raises the flags again. */
  clearEnding(): void {
    this.fireworks.clear();
    this.rain.stop();
    this.#water?.setRain(0);
    this.banners.raise();
  }

  update(dt: number): void {
    this.#updateEmitters(dt);
    this.#glow.update(dt);
    this.#smoke.update(dt);
    this.#debris.update(dt);
    this.#rings.update(dt);
    this.fireworks.update(dt);
    this.rain.update(dt);
    this.banners.update(dt);
    this.#water?.setReflections(this.fireworks.lights);

    for (const flash of this.#flashes) {
      if (!flash.sprite.visible) continue;
      flash.age += dt;
      const t = flash.age / flash.life;
      if (t >= 1) {
        flash.sprite.visible = false;
        continue;
      }
      const grow = 1 - Math.pow(1 - Math.min(1, t * 3), 3);
      flash.sprite.scale.setScalar(flash.size * (0.25 + grow * 0.75));
      flash.sprite.material.opacity = (1 - t) * (1 - t);
    }

    this.#lightLevel = Math.max(0, this.#lightLevel - dt * 4.5);
    this.#light.intensity = this.#lightLevel * this.#lightLevel * 22;
  }

  clear(): void {
    this.#glow.clear();
    this.#smoke.clear();
    this.#debris.clear();
    this.#emitters.length = 0;
    for (const mark of this.#scorchPool) mark.visible = false;
    this.#nextScorch = 0;
    this.#lightLevel = 0;
    this.time.cancel();
    this.clearEnding();
    this.rain.clear();
    for (const flash of this.#flashes) flash.sprite.visible = false;
  }

  /** Frees every GPU resource the effects own (shared unit/flag assets excluded). */
  dispose(): void {
    this.clear();
    this.#glow.dispose();
    this.#smoke.dispose();
    this.#debris.dispose();
    this.#rings.dispose();
    this.fireworks.dispose();
    this.rain.dispose();
    this.banners.dispose();
    this.#scorchGeometry.dispose();
    this.#flashTexture.dispose();
    for (const flash of this.#flashes) flash.sprite.material.dispose();
    this.#light.dispose();
    this.group.removeFromParent();
  }

  #flashSprite(at: Vector3, size: number): void {
    const flash = this.#flashes.reduce((oldest, f) => (f.age / f.life > oldest.age / oldest.life ? f : oldest));
    flash.sprite.position.copy(at);
    flash.sprite.visible = true;
    flash.age = 0;
    flash.life = 0.32;
    flash.size = size;
    flash.sprite.scale.setScalar(size * 0.25);
    flash.sprite.material.opacity = 1;
  }

  #flashLight(position: Vector3, level: number): void {
    // Keep the light well above surfaces: glossy clearcoat right next to a
    // point light produces values that overflow the half-float bloom buffer.
    this.#light.position.set(position.x, Math.max(position.y, 0) + 1.4, position.z);
    this.#lightLevel = Math.max(this.#lightLevel, Math.min(1.2, level));
  }

  /** Smouldering wrecks keep puffing smoke and the odd ember for a while. */
  #updateEmitters(dt: number): void {
    for (let i = this.#emitters.length - 1; i >= 0; i--) {
      const emitter = this.#emitters[i]!;
      emitter.remaining -= dt;
      if (emitter.remaining <= 0) {
        this.#emitters.splice(i, 1);
        continue;
      }
      const fade = Math.min(1, emitter.remaining / 2);
      emitter.carry += dt * emitter.rate * fade * this.#density;
      while (emitter.carry >= 1) {
        emitter.carry -= 1;
        this.#wreckSmoke.origin.copy(emitter.position);
        this.#smoke.emit(this.#wreckSmoke);
        if (Math.random() < 0.35) {
          this.#wreckEmber.origin.copy(emitter.position);
          this.#glow.emit(this.#wreckEmber);
        }
      }
    }
  }

  #n(count: number): number {
    return Math.max(1, Math.round(count * this.#density * rand(0.85, 1.15)));
  }
}
