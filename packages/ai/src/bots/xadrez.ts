import { unitCellCount, type AbilityRequest, type FieldConfig, type Placement, type PlayerView } from '@riverfront/core';
import { blankPrior, densityMap, toProbabilities, withClusterBias } from '../inference.ts';
import type { Knowledge } from '../knowledge.ts';
import { planLayout } from '../layouts.ts';
import { HeatMap, revealedEnemyCells } from '../learning.ts';
import { trainedSearchPrior, trainedShotPrior } from '../priors.ts';
import { PROFILES } from '../profiles.ts';
import { abilityCost, abilityReady, bestBomb, bestCell, bestRadar, bestSpy, repairTarget, shieldTarget, underAttack } from '../tactics.ts';
import type { BotOptions } from '../types.ts';
import { BaseBot } from './base.ts';

/** Expected chance that each cell holds a unit, from the blank-board prior. */
export function expectedOccupancy(config: FieldConfig): Float64Array {
  const blank = blankPrior(config);
  const rate = unitCellCount(config) / blank.length;
  return blank.map((v) => v * rate);
}

/**
 * Opponent model: the trained prior for the enemy faction on this preset,
 * corrected by what this bot learned about the current opponent.
 */
export function opponentPrior(config: FieldConfig, habits: HeatMap | null, trained: Float64Array | null, strength: number): Float64Array | null {
  const expected = expectedOccupancy(config);
  const base = trained ? expected.map((e, c) => e * (trained[c] ?? 1)) : expected;
  const learned = habits?.ratio(base, strength) ?? null;
  if (!trained) return learned;
  return learned ? trained.map((t, c) => t * (learned[c] ?? 1)) : trained;
}

/** Where to hide: blank-board density times how early hunters usually look (trained). */
export function hidingMap(config: FieldConfig, search: Float64Array | null): Float64Array {
  const blank = blankPrior(config);
  return search ? blank.map((b, c) => b * (search[c] ?? 1)) : blank;
}

/**
 * Level 4: density map tilted by what it learned about the opponent's
 * placement habits; hides its own big pieces where hunters look least, keeps
 * recruits in the open as bait, and times shield and repair.
 */
export class MajorXadrez extends BaseBot {
  #habits: HeatMap | null = null;
  #key: string | null = null;
  #prior: Float64Array | null = null;

  constructor(options: BotOptions) {
    super(PROFILES.xadrez, options);
  }

  #learn(view: PlayerView): void {
    const config = view.config;
    const enemy = view.enemy.faction?.id ?? 'neutra';
    const key = `${config.name}|${enemy}`;
    if (this.#key === key && this.#habits) return;
    this.#key = key;
    const n = config.cols * config.rows;
    this.#habits = new HeatMap(this.storage, `riverfront:xadrez:habits:${config.name}`, n);
    // Priors come from 1v1 layouts; doubles armies are placed by two people, so they do not apply.
    const trained = this.usePriors && !('doubles' in view) ? trainedShotPrior(config, enemy) : null;
    this.#prior = opponentPrior(config, this.#habits, trained, this.params.xadrez.priorStrength);
  }

  protected override layout(view: PlayerView): Placement[] {
    this.#key = null;
    this.#learn(view);
    const p = this.params.xadrez;
    const search = this.usePriors ? trainedSearchPrior(view.config, view.own.faction?.id) : null;
    return planLayout(view, this.rng, {
      avoid: hidingMap(view.config, search),
      avoidPower: p.avoidPower,
      touchPenalty: p.touchPenalty,
      baitPieces: ['recruit-1'],
    });
  }

  protected override computeBeliefs(view: PlayerView, k: Knowledge): Float64Array {
    this.#learn(view);
    return withClusterBias(k, toProbabilities(k, densityMap(k, { hitWeight: this.params.xadrez.hitWeight, prior: this.#prior })));
  }

  protected override chooseAbility(view: PlayerView, k: Knowledge): AbilityRequest | null {
    const p = this.params.xadrez;
    const prob = this.beliefs(view, k);
    const energy = view.own.energy;
    if (abilityReady(view, 'shield') && underAttack(view)) {
      const pieceId = shieldTarget(view);
      if (pieceId) return { ability: 'shield', pieceId };
    }
    if (abilityReady(view, 'bomb')) {
      const bomb = bestBomb(k, prob);
      if (bomb && bomb.value >= p.bombMin) return { ability: 'bomb', target: bomb.target };
    }
    if (abilityReady(view, 'repair') && energy >= abilityCost(view, 'repair') + p.repairSpare) {
      const target = repairTarget(view);
      if (target) return { ability: 'repair', target };
    }
    if (abilityReady(view, 'radar') && energy >= p.radarEnergy && k.mustCells().length === 0) {
      const radar = bestRadar(k, prob);
      if (radar) return { ability: 'radar', target: radar.target };
    }
    if (abilityReady(view, 'spy') && energy >= p.spyEnergy && k.mustCells().length === 0) {
      const spy = bestSpy(k, prob);
      return { ability: 'spy', axis: spy.axis, index: spy.index };
    }
    return null;
  }

  protected chooseShot(view: PlayerView, k: Knowledge): number {
    return bestCell(k, this.beliefs(view, k), this.rng);
  }

  override gameOver(view: PlayerView): void {
    this.#learn(view);
    const cells = revealedEnemyCells(view);
    if (cells.length > 0) this.#habits?.record(cells);
    this.#key = null;
  }
}
