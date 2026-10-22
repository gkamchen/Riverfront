import { Group, type Vector3 } from 'three';
import type { Lake } from '../water';
import { BirdsongModule, FirefliesModule } from './ambient';
import { DragonflyModule } from './dragonflies';
import { DriftersModule } from './drifters';
import { FishModule } from './fish';
import { BoatModule } from './boats';
import { HeronModule, IBIS_LOOK } from './heron';
import { LilyFrogsModule } from './lilyFrogs';
import { CrocodileModule, HippoModule } from './nile';
import { CONDOR_LOOK, CROW_LOOK, DolphinModule, DuckModule, EAGLE_LOOK, FALCON_LOOK, MACAW_LOOK, SeagullModule } from './sea';
import {
  CosmeticRng,
  WildlifeContext,
  type AmbientSpecies,
  type LifeModule,
  type WildlifeQuality,
  type WildlifeSound,
} from './shared';
import { PenguinsModule, SealsModule, SnowModule } from './tundra';
import { EmbersModule, SalamanderModule } from './volcano';
import { CaravanModule, DragonKiteModule, KoiModule, MistModule, PetalsModule } from './wave2';

export type { AmbientSpecies, WildlifeQuality, WildlifeSound } from './shared';

export interface WildlifeOptions {
  species: readonly AmbientSpecies[];
  quality?: WildlifeQuality | 'alto' | 'baixo';
  seed?: number;
  /** Called for every wildlife sound (map it to the sound board). */
  onSound?: (name: WildlifeSound, at: Vector3) => void;
  reducedMotion?: () => boolean;
}

const BUILDERS: Record<AmbientSpecies, (ctx: WildlifeContext) => LifeModule> = {
  fish: (ctx) => new FishModule(ctx),
  lilypads: (ctx) => new LilyFrogsModule(ctx),
  heron: (ctx) => new HeronModule(ctx),
  dragonflies: (ctx) => new DragonflyModule(ctx),
  drifters: (ctx) => new DriftersModule(ctx),
  fireflies: (ctx) => new FirefliesModule(ctx),
  birdsong: (ctx) => new BirdsongModule(ctx),
  salamanders: (ctx) => new SalamanderModule(ctx),
  embers: (ctx) => new EmbersModule(ctx),
  seals: (ctx) => new SealsModule(ctx),
  penguins: (ctx) => new PenguinsModule(ctx),
  snow: (ctx) => new SnowModule(ctx),
  crocodiles: (ctx) => new CrocodileModule(ctx),
  hippos: (ctx) => new HippoModule(ctx),
  ibis: (ctx) => new HeronModule(ctx, IBIS_LOOK),
  dolphins: (ctx) => new DolphinModule(ctx),
  seagulls: (ctx) => new SeagullModule(ctx),
  ducks: (ctx) => new DuckModule(ctx),
  felucca: (ctx) => new BoatModule(ctx, 'felucca'),
  cargoBoat: (ctx) => new BoatModule(ctx, 'cargo'),
  trireme: (ctx) => new BoatModule(ctx, 'trireme'),
  mist: (ctx) => new MistModule(ctx),
  longship: (ctx) => new BoatModule(ctx, 'longship'),
  harborSeals: (ctx) => new SealsModule(ctx, { onRocks: true }),
  koi: (ctx) => new KoiModule(ctx),
  petals: (ctx) => new PetalsModule(ctx),
  junk: (ctx) => new BoatModule(ctx, 'junk'),
  dragonKite: (ctx) => new DragonKiteModule(ctx),
  caravan: (ctx) => new CaravanModule(ctx),
  caique: (ctx) => new BoatModule(ctx, 'caique'),
  eagles: (ctx) => new SeagullModule(ctx, EAGLE_LOOK),
  condors: (ctx) => new SeagullModule(ctx, CONDOR_LOOK),
  macaws: (ctx) => new SeagullModule(ctx, MACAW_LOOK),
  crows: (ctx) => new SeagullModule(ctx, CROW_LOOK),
  wolves: (ctx) => new CaravanModule(ctx, 'wolves'),
  llamas: (ctx) => new CaravanModule(ctx, 'llamas'),
  dogs: (ctx) => new CaravanModule(ctx, 'dogs'),
  jaguars: (ctx) => new CaravanModule(ctx, 'jaguars'),
  falcons: (ctx) => new SeagullModule(ctx, FALCON_LOOK),
  lions: (ctx) => new CaravanModule(ctx, 'lions'),
  tigers: (ctx) => new CaravanModule(ctx, 'tigers'),
  horses: (ctx) => new CaravanModule(ctx, 'horses'),
  peacocks: (ctx) => new CaravanModule(ctx, 'peacocks'),
};

function normalizeQuality(level: WildlifeQuality | 'alto' | 'baixo' | undefined): WildlifeQuality {
  return level === 'low' || level === 'baixo' ? 'low' : 'high';
}

/**
 * Cosmetic life in and around the river. Purely visual: it never reads or
 * changes the match state, and its randomness is its own.
 *
 * Wiring: `update(dt)` every frame; `onExplosion(pos, power)` for hits and
 * misses (power ~1 for explosions, ~0.3 for misses); `onHoverIdle(pos|null)`
 * whenever the aimed cell changes.
 */
export class WildlifeController {
  readonly group = new Group();
  readonly #lake: Lake;
  readonly #rng: CosmeticRng;
  readonly #ctx: WildlifeContext;
  readonly #reducedMotion: () => boolean;
  #modules: LifeModule[] = [];
  #species: readonly AmbientSpecies[] = [];
  #viewportScale = 500;
  #dusk = 0;

  constructor(lake: Lake, options: WildlifeOptions) {
    this.#lake = lake;
    this.#rng = new CosmeticRng(options.seed ?? 0x5eed);
    this.#reducedMotion = options.reducedMotion ?? (() => false);
    const onSound = options.onSound ?? (() => undefined);
    this.#ctx = new WildlifeContext(lake, this.#rng, normalizeQuality(options.quality), onSound);
    this.group.name = 'wildlife';
    this.group.add(this.#ctx.spray.points, this.#ctx.glow.points);
    this.setSpecies(options.species);
  }

  get species(): readonly AmbientSpecies[] {
    return this.#species;
  }

  /** Rebuilds the cast (used by theme switches). */
  setSpecies(species: readonly AmbientSpecies[]): void {
    for (const module of this.#modules) module.dispose();
    this.#modules = species.map((id) => {
      const module = BUILDERS[id](this.#ctx);
      this.group.add(module.group);
      return module;
    });
    this.#species = species;
    this.#applyViewport();
    for (const module of this.#modules) module.setDusk?.(this.#dusk);
  }

  update(dt: number): void {
    const step = this.#reducedMotion() ? dt * 0.5 : dt;
    this.#ctx.update(step);
    for (const module of this.#modules) module.update(step);
  }

  onExplosion(worldPos: Vector3, power = 1): void {
    for (const module of this.#modules) module.onExplosion?.(worldPos, power);
    if (this.#lake.mode === 'ice' && Math.abs(worldPos.z) < 3.5) {
      this.#lake.addCrack(worldPos.x, Math.max(-1.3, Math.min(1.3, worldPos.z)), 0.8 + power * 1.2);
      this.#ctx.sound('crack', worldPos);
    }
  }

  onHoverIdle(worldPos: Vector3 | null): void {
    for (const module of this.#modules) module.onHoverIdle?.(worldPos);
  }

  setQuality(level: WildlifeQuality | 'alto' | 'baixo'): void {
    const quality = normalizeQuality(level);
    if (quality === this.#ctx.quality) return;
    this.#ctx.quality = quality;
    for (const module of this.#modules) module.setQuality?.(quality);
    this.#applyViewport();
  }

  /** 0 = day, 1 = full dusk (fireflies out). */
  setDusk(amount: number): void {
    this.#dusk = amount;
    this.#ctx.dusk = amount;
    for (const module of this.#modules) module.setDusk?.(amount);
  }

  /** Point sprite scale; pass the drawing-buffer height and the camera fov. */
  setViewport(heightPx: number, fovDegrees: number): void {
    this.#ctx.spray.setScale(heightPx, fovDegrees);
    this.#ctx.glow.setScale(heightPx, fovDegrees);
    this.#viewportScale = heightPx / (2 * Math.tan((fovDegrees * Math.PI) / 360));
    this.#applyViewport();
  }

  /** Routes wildlife sounds (e.g. `(name) => soundBoard.play(name)`). */
  setSoundHandler(handler: (name: WildlifeSound, at: Vector3) => void): void {
    this.#ctx.setSoundHandler(handler);
  }

  /** Forces a scripted moment, for galleries and debugging. */
  trigger(event: string): boolean {
    return this.#modules.some((module) => module.trigger?.(event) ?? false);
  }

  dispose(): void {
    for (const module of this.#modules) module.dispose();
    this.#modules = [];
    this.#ctx.dispose();
    this.group.removeFromParent();
  }

  #applyViewport(): void {
    for (const module of this.#modules) {
      const scalable = module as LifeModule & { setScale?: (scale: number) => void };
      scalable.setScale?.(this.#viewportScale);
    }
  }
}
