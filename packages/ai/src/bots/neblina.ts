import type { AbilityRequest, Placement, PlayerView } from '@riverfront/core';
import { blankPrior, densityMap, toProbabilities, withClusterBias } from '../inference.ts';
import type { Knowledge } from '../knowledge.ts';
import { planLayout } from '../layouts.ts';
import { PROFILES } from '../profiles.ts';
import { abilityCost, abilityReady, bestBomb, bestCell, bestSpy, repairTarget, shieldTarget, underAttack } from '../tactics.ts';
import type { BotOptions } from '../types.ts';
import { BaseBot } from './base.ts';

/** Level 3: probability density over the pieces still standing; spy and bomb on the peaks. */
export class CapitaNeblina extends BaseBot {
  constructor(options: BotOptions) {
    super(PROFILES.neblina, options);
  }

  protected override layout(view: PlayerView): Placement[] {
    return planLayout(view, this.rng, { touchPenalty: 0.5 });
  }

  /** She assumes people hide in the middle, where most pieces fit. */
  protected override computeBeliefs(view: PlayerView, k: Knowledge): Float64Array {
    return withClusterBias(k, toProbabilities(k, densityMap(k, { hitWeight: 30, prior: blankPrior(view.config) })));
  }

  protected override chooseAbility(view: PlayerView, k: Knowledge): AbilityRequest | null {
    const prob = this.beliefs(view, k);
    // She protects a piece the enemy is chasing (it is what makes a defensive army worth it).
    if (abilityReady(view, 'shield') && underAttack(view)) {
      const pieceId = shieldTarget(view);
      if (pieceId) return { ability: 'shield', pieceId };
    }
    // Repair only with energy to spare (it reinforces the piece for a turn).
    if (abilityReady(view, 'repair') && view.own.energy >= abilityCost(view, 'repair') + 3) {
      const target = repairTarget(view);
      if (target) return { ability: 'repair', target };
    }
    if (abilityReady(view, 'bomb')) {
      const bomb = bestBomb(k, prob);
      if (bomb && bomb.value >= 0.5) return { ability: 'bomb', target: bomb.target };
    }
    if (abilityReady(view, 'spy') && view.own.energy >= 6 && k.mustCells().length === 0) {
      const spy = bestSpy(k, prob);
      return { ability: 'spy', axis: spy.axis, index: spy.index };
    }
    return null;
  }

  protected chooseShot(view: PlayerView, k: Knowledge): number {
    return bestCell(k, this.beliefs(view, k), this.rng);
  }
}
