import { block3x3, coordOf, neighbors4, type AbilityRequest, type Placement, type PlayerView } from '@riverfront/core';
import { DEAD, HIT, SPOTTED, UNKNOWN, type Knowledge } from '../knowledge.ts';
import { planLayout } from '../layouts.ts';
import { PROFILES } from '../profiles.ts';
import { abilityReady, shotCandidates } from '../tactics.ts';
import type { BotOptions } from '../types.ts';
import { BaseBot } from './base.ts';

/** Level 2: checkerboard hunt, then chase every hit along its line. Radar when affordable. */
export class SargentoRotina extends BaseBot {
  constructor(options: BotOptions) {
    super(PROFILES.rotina, options);
  }

  protected override layout(view: PlayerView): Placement[] {
    return planLayout(view, this.rng, { borderPenalty: 0.85 });
  }

  protected override chooseAbility(view: PlayerView, k: Knowledge): AbilityRequest | null {
    if (!abilityReady(view, 'radar') || this.#hits(k).length > 0) return null;
    let best: number[] = [];
    let bestCount = 0;
    for (let center = 0; center < k.n; center++) {
      const count = block3x3(k.size, center).filter((c) => k.status[c] === UNKNOWN && !k.radarEmpty[c]).length;
      if (count > bestCount) {
        best = [center];
        bestCount = count;
      } else if (count === bestCount) best.push(center);
    }
    if (best.length === 0) return null;
    return { ability: 'radar', target: coordOf(k.size, this.rng.pick(best)) };
  }

  protected chooseShot(_view: PlayerView, k: Knowledge): number {
    const open = shotCandidates(k);
    const spotted = open.filter((i) => k.status[i] === SPOTTED);
    if (spotted.length > 0) return this.rng.pick(spotted);

    const target = this.#target(k);
    if (target !== null) return target;

    // Radar said something is here: comb the block first.
    for (const r of k.radar) {
      const known = r.cells.filter(
        (c) => k.status[c] === HIT || k.status[c] === SPOTTED || (k.status[c] === DEAD && (r.amphibians || k.deadRole[c] !== 'amphibian')),
      ).length;
      const left = r.cells.filter((c) => k.status[c] === UNKNOWN && k.shootable(c));
      if (r.count > known && left.length > 0) return this.rng.pick(left);
    }

    const usable = open.filter((i) => !k.radarEmpty[i]);
    const pool = usable.length > 0 ? usable : open;
    const parity = pool.filter((i) => ((i % k.size.cols) + Math.floor(i / k.size.cols)) % 2 === 0);
    return this.rng.pick(parity.length > 0 ? parity : pool);
  }

  #hits(k: Knowledge): number[] {
    const out: number[] = [];
    for (let i = 0; i < k.n; i++) if (k.status[i] === HIT) out.push(i);
    return out;
  }

  /** Protocol after a kill: check the cells around the wreck before hunting again. */
  #wreck(k: Knowledge): number | null {
    if (k.clusterFactor() < 1.4) return null;
    const around: number[] = [];
    for (let i = 0; i < k.n; i++) {
      if (k.status[i] !== DEAD) continue;
      for (const n of neighbors4(k.size, i)) if (k.status[n] === UNKNOWN && !k.radarEmpty[n] && k.shootable(n)) around.push(n);
    }
    return around.length > 0 ? this.rng.pick(around) : null;
  }

  /** Extends lines of two or more hits; otherwise probes around a lone hit. */
  #target(k: Knowledge): number | null {
    const hits = this.#hits(k);
    if (hits.length === 0) return this.#wreck(k);
    const cols = k.size.cols;
    const ends = new Set<number>();
    for (const h of hits) {
      const col = h % cols;
      const row = Math.floor(h / cols);
      for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
        const next = { col: col + dc, row: row + dr };
        if (next.col >= cols || next.row >= k.size.rows) continue;
        if (k.status[next.row * cols + next.col] !== HIT) continue;
        for (const sign of [1, -1]) {
          let c = col;
          let r = row;
          while (c >= 0 && r >= 0 && c < cols && r < k.size.rows && k.status[r * cols + c] === HIT) {
            c += dc * sign;
            r += dr * sign;
          }
          if (c >= 0 && r >= 0 && c < cols && r < k.size.rows && k.shootable(r * cols + c)) ends.add(r * cols + c);
        }
      }
    }
    if (ends.size > 0) return this.rng.pick([...ends]);
    const around = new Set<number>();
    for (const h of hits) for (const n of neighbors4(k.size, h)) if (k.shootable(n)) around.add(n);
    return around.size > 0 ? this.rng.pick([...around]) : null;
  }
}
