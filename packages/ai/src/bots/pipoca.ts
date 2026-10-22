import { neighbors4, type Placement, type PlayerView } from '@riverfront/core';
import { HIT, type Knowledge } from '../knowledge.ts';
import { planLayout } from '../layouts.ts';
import { PROFILES } from '../profiles.ts';
import type { BotOptions } from '../types.ts';
import { BaseBot } from './base.ts';

/** Level 1: shoots at random; after a hit it remembers to look around half of the time. */
export class CaboPipoca extends BaseBot {
  constructor(options: BotOptions) {
    super(PROFILES.pipoca, options);
  }

  /** Sloppy: pieces end up bunched together. */
  protected override layout(view: PlayerView): Placement[] {
    return planLayout(view, this.rng, { touchBonus: 10 });
  }

  protected chooseShot(_view: PlayerView, k: Knowledge): number {
    if (this.rng.next() < 0.5) {
      const around = new Set<number>();
      for (let i = 0; i < k.n; i++) {
        if (k.status[i] !== HIT) continue;
        for (const n of neighbors4(k.size, i)) if (k.shootable(n)) around.add(n);
      }
      if (around.size > 0) return this.rng.pick([...around]);
    }
    const open: number[] = [];
    for (let i = 0; i < k.n; i++) if (k.shootable(i)) open.push(i);
    return this.rng.pick(open);
  }
}
