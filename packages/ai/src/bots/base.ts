import {
  createRng,
  hashSeed,
  type AbilityRequest,
  type Placement,
  type PlayerView,
  type Rng,
  type SpecialShotRequest,
} from '@riverfront/core';
import { densityMap, toProbabilities } from '../inference.ts';
import { Knowledge, ViewMemory } from '../knowledge.ts';
import { planLayout } from '../layouts.ts';
import { leaderFor, tauntTier } from '../leaders.ts';
import type { BotStorage } from '../learning.ts';
import { resolveParams, trainedUse, type BotParams } from '../params.ts';
import { bestRadar, planSpecial, toCoord } from '../tactics.ts';
import type { Bot, BotAction, BotOptions, BotProfile, DecideOptions, TauntEvent, ThinkingBudget } from '../types.ts';

/** A level profile dressed as a faction commander, when the faction has one. */
function withLeader(profile: BotProfile, options: BotOptions): BotProfile {
  const persona = leaderFor(options.faction);
  if (!persona) return options.faction ? { ...profile, faction: options.faction } : profile;
  const [a] = tauntTier(profile.level);
  const taunts = Object.fromEntries(Object.entries(persona.taunts).map(([event, lines]) => [event, lines[a] ?? ''])) as BotProfile['taunts'];
  return {
    ...profile,
    name: `${persona.title} ${persona.name}`,
    personality: persona.personality,
    taunts,
    faction: persona.faction,
    leader: persona,
  };
}

export abstract class BaseBot implements Bot {
  readonly profile: BotProfile;
  protected readonly rng: Rng;
  protected readonly memory: ViewMemory;
  protected readonly storage: BotStorage | null;
  protected readonly budget: ThinkingBudget;
  /** 0: never fires the special shot; 1: fires it plainly; 2: weighs it against the alternatives. */
  protected readonly specialSkill: 0 | 1 | 2;
  readonly #tauntRng: Rng;
  /** Tuned numbers (trained by default) and whether trained priors are used. */
  protected readonly params: BotParams;
  protected readonly usePriors: boolean;
  #beliefs: { key: Knowledge; prob: Float64Array } | null = null;

  constructor(profile: BotProfile, options: BotOptions, budget: ThinkingBudget = { samples: 0 }) {
    this.profile = withLeader(profile, options);
    this.rng = createRng(options.seed);
    // Taunts draw from their own stream so they never change the bot's moves.
    this.#tauntRng = createRng(hashSeed(options.seed, 'taunt'));
    this.storage = options.storage ?? null;
    this.budget = { ...budget, ...options.budget };
    const use = options.trained === false ? { params: false, priors: false } : trainedUse(profile.level);
    this.params = resolveParams(use.params, options.params);
    this.usePriors = options.priors ?? use.priors;
    this.specialSkill = profile.level <= 1 ? 0 : profile.level === 2 ? 1 : 2;
    // From level 3 up a bot remembers the misses the fog hides.
    this.memory = new ViewMemory(profile.level >= 3);
  }

  placeLayout(view: PlayerView): Placement[] {
    this.memory.reset();
    return this.layout(view);
  }

  decide(view: PlayerView, options: DecideOptions = {}): BotAction {
    this.memory.observe(view);
    const k = Knowledge.fromView(view, this.memory);
    const canUse = options.allowAbility !== false && !view.turnState.abilityUsed && view.own.abilities.some((a) => a.ready);
    if (canUse) {
      const request = this.factionAbility(view, k) ?? this.chooseAbility(view, k);
      if (request) return { type: 'ability', request };
    }
    if (options.allowSpecial !== false && this.specialSkill > 0 && view.own.faction?.special?.ready) {
      const request = this.chooseSpecial(view, k);
      if (request) return { type: 'special', request };
    }
    return { type: 'attack', target: toCoord(k, this.chooseShot(view, k)) };
  }

  gameOver(_view: PlayerView): void {}

  taunt(event: TauntEvent): string {
    const persona = this.profile.leader;
    if (!persona) return this.profile.taunts[event];
    const [a, b] = tauntTier(this.profile.level);
    const lines = persona.taunts[event];
    return lines[this.#tauntRng.next() < 0.5 ? a : b] ?? lines[0] ?? '';
  }

  /** Abilities that set up the faction kit: a precise shot needs a radar reading first. */
  protected factionAbility(view: PlayerView, k: Knowledge): AbilityRequest | null {
    if (this.specialSkill < 2) return null;
    const special = view.own.faction?.special;
    if (special?.kind !== 'precise' || special.blocker !== 'no-target' || k.mustCells().length > 0) return null;
    if (!view.own.abilities.some((a) => a.id === 'radar' && a.ready)) return null;
    const radar = bestRadar(k, this.beliefs(view, k));
    return radar ? { ability: 'radar', target: radar.target } : null;
  }

  /** Special shot to fire now, if any. Density bots reuse their beliefs; the others a plain density map. */
  protected chooseSpecial(view: PlayerView, k: Knowledge): SpecialShotRequest | null {
    const prob = this.specialSkill >= 2 ? this.beliefs(view, k) : toProbabilities(k, densityMap(k));
    return planSpecial(view, k, prob, this.rng, this.specialSkill === 2 ? 2 : 1);
  }

  protected layout(view: PlayerView): Placement[] {
    return planLayout(view, this.rng);
  }

  protected chooseAbility(_view: PlayerView, _k: Knowledge): AbilityRequest | null {
    return null;
  }

  /** Hit chances per enemy cell; computed once per decision. */
  protected beliefs(view: PlayerView, k: Knowledge): Float64Array {
    if (this.#beliefs?.key !== k) this.#beliefs = { key: k, prob: this.computeBeliefs(view, k) };
    return this.#beliefs.prob;
  }

  protected computeBeliefs(_view: PlayerView, k: Knowledge): Float64Array {
    return new Float64Array(k.n);
  }

  /** Index of the enemy cell to shoot. */
  protected abstract chooseShot(view: PlayerView, k: Knowledge): number;
}
