import { REAR_ROWS, type AbilityId, type AbilityRequest, type Placement, type PlayerView } from '@riverfront/core';
import { blankPrior, densityMap, sampleLayouts, toProbabilities, withClusterBias } from '../inference.ts';
import { UNKNOWN, type Knowledge } from '../knowledge.ts';
import { planLayout } from '../layouts.ts';
import { HeatMap, SearchOrderMap, ownUnitCells, revealedEnemyCells } from '../learning.ts';
import { trainedSearchPrior, trainedShotPrior } from '../priors.ts';
import { PROFILES } from '../profiles.ts';
import { abilityCost, abilityReady, bestBomb, bestCell, bestRadar, bestSpy, repairTarget, shieldTarget, underAttack } from '../tactics.ts';
import type { BotOptions } from '../types.ts';
import { BaseBot } from './base.ts';
import { expectedOccupancy, opponentPrior } from './xadrez.ts';

/**
 * Placement mixes: how hard to flatten the hunter's prior, to avoid our own past
 * layouts, to hide where the opponent searches late, and to keep pieces apart.
 */
const STYLES = [
  { blank: 0.5, self: 1.0, early: 2.0, touch: 0.5 },
  { blank: 0.3, self: 1.6, early: 1.5, touch: 0.3 },
  { blank: 0.8, self: 0.8, early: 2.5, touch: 0.6 },
] as const;

/**
 * A live enemy tower keeps firing on its own, so it is worth more than one
 * cell: tilt the rear rows (where it must be) by `bias` while it stands.
 */
export function towerHunt(view: PlayerView, k: Knowledge, prob: Float64Array, bias: number): Float64Array {
  const tower = view.enemy.faction?.tower;
  if (!tower || tower.alive === 0 || bias <= 1) return prob;
  const out = prob.slice();
  const firstRear = k.size.rows - REAR_ROWS;
  for (let i = firstRear * k.size.cols; i < k.n; i++) if (k.status[i] === UNKNOWN) out[i] = Math.min(1, (out[i] ?? 0) * bias);
  return out;
}

/**
 * Level 5: Monte Carlo over whole enemy layouts consistent with everything
 * revealed, weighted by learned habits. Spends energy by expected value and
 * draws its own layout from a mix that drifts away from its past choices.
 */
export class GeneralAbismo extends BaseBot {
  #habits: HeatMap | null = null;
  #self: HeatMap | null = null;
  #order: SearchOrderMap | null = null;
  #key: string | null = null;
  #prior: Float64Array | null = null;

  constructor(options: BotOptions) {
    super(PROFILES.abismo, options, { samples: 240 });
  }

  #learn(view: PlayerView): void {
    const config = view.config;
    const enemy = view.enemy.faction?.id ?? 'neutra';
    const key = `${config.name}|${enemy}`;
    if (this.#key === key && this.#habits) return;
    this.#key = key;
    const n = config.cols * config.rows;
    this.#habits = new HeatMap(this.storage, `riverfront:abismo:habits:${config.name}`, n);
    this.#self = new HeatMap(this.storage, `riverfront:abismo:self:${config.name}`, n);
    this.#order = new SearchOrderMap(this.storage, `riverfront:abismo:order:${config.name}`, n);
    // Priors come from 1v1 layouts; doubles armies are placed by two people, so they do not apply.
    const trained = this.usePriors && !('doubles' in view) ? trainedShotPrior(config, enemy) : null;
    this.#prior = opponentPrior(config, this.#habits, trained, this.params.abismo.priorStrength);
  }

  protected override layout(view: PlayerView): Placement[] {
    this.#key = null;
    this.#learn(view);
    const style = STYLES[this.rng.int(STYLES.length)]!;
    const blank = blankPrior(view.config);
    const self = this.#self?.ratio(expectedOccupancy(view.config), 2) ?? null;
    // How early this opponent searches; before any game, how early hunters usually do (trained).
    const early = this.#order?.earliness() ?? (this.usePriors ? trainedSearchPrior(view.config, view.own.faction?.id) : null);
    const avoid = blank.map(
      (b, c) => Math.pow(b, style.blank) * Math.pow(self?.[c] ?? 1, style.self) * Math.pow(early?.[c] ?? 1, style.early),
    );
    return planLayout(view, this.rng, { avoid, avoidPower: this.params.abismo.avoidPower, touchPenalty: style.touch });
  }

  protected override computeBeliefs(view: PlayerView, k: Knowledge): Float64Array {
    this.#learn(view);
    const result = sampleLayouts(k, this.rng, {
      samples: this.budget.samples,
      ...(this.budget.maxMs !== undefined ? { maxMs: this.budget.maxMs } : {}),
      prior: this.#prior,
    });
    const prob = result.accepted >= 12 ? result.prob : toProbabilities(k, densityMap(k, { hitWeight: 40, prior: this.#prior }));
    return withClusterBias(k, prob);
  }

  protected override chooseAbility(view: PlayerView, k: Knowledge): AbilityRequest | null {
    const p = this.params.abismo;
    const prob = this.beliefs(view, k);
    const hunting = k.mustCells().length === 0;
    const options: { request: AbilityRequest; value: number }[] = [];

    // Rough values in "enemy turns gained"; the spy is cheap and clears whole lines.
    if (abilityReady(view, 'shield') && underAttack(view)) {
      const pieceId = shieldTarget(view);
      if (pieceId) options.push({ request: { ability: 'shield', pieceId }, value: p.shieldValue });
    }
    if (abilityReady(view, 'spy') && hunting) {
      const spy = bestSpy(k, prob);
      options.push({ request: { ability: 'spy', axis: spy.axis, index: spy.index }, value: p.spyValue });
    }
    if (abilityReady(view, 'bomb')) {
      const bomb = bestBomb(k, prob);
      if (bomb) options.push({ request: { ability: 'bomb', target: bomb.target }, value: bomb.value + p.bombBonus });
    }
    if (abilityReady(view, 'radar') && hunting) {
      const radar = bestRadar(k, prob);
      if (radar) options.push({ request: { ability: 'radar', target: radar.target }, value: p.radarFactor * radar.value });
    }
    // Repair pays more now that it reinforces the piece; still only with energy to spare.
    if (abilityReady(view, 'repair') && view.own.energy >= p.repairEnergy) {
      const target = repairTarget(view);
      if (target) options.push({ request: { ability: 'repair', target }, value: p.repairValue });
    }

    // Keep the bomb cadence: don't spend the energy it needs next turn on something small.
    const bomb = view.own.abilities.find((a) => a.id === 'bomb');
    const bombSoon = bomb !== undefined && bomb.blocker !== 'missing-piece' && bomb.cooldownLeft <= 1;
    const scored = options.map((o) => {
      const id: AbilityId = o.request.ability;
      const left = view.own.energy - abilityCost(view, id) + 1;
      const starves = id !== 'bomb' && bombSoon && left < abilityCost(view, 'bomb');
      return { ...o, value: starves ? o.value * p.starveFactor : o.value };
    });
    scored.sort((a, b) => b.value - a.value);
    const best = scored[0];
    return best && best.value >= p.minValue ? best.request : null;
  }

  protected chooseShot(view: PlayerView, k: Knowledge): number {
    return bestCell(k, towerHunt(view, k, this.beliefs(view, k), this.params.abismo.towerBias), this.rng);
  }

  override gameOver(view: PlayerView): void {
    this.#learn(view);
    const enemy = revealedEnemyCells(view);
    if (enemy.length > 0) this.#habits?.record(enemy);
    this.#self?.record(ownUnitCells(view));
    this.#order?.record(view);
    this.#key = null;
  }
}
