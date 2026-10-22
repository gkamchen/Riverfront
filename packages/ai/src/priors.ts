import { opponentOf, type FieldConfig, type PlayerView } from '@riverfront/core';
import priorsFile from '../trained/priors.json' with { type: 'json' };
import { blankPrior } from './inference.ts';
import { revealedEnemyCells } from './learning.ts';

/**
 * Priors learned by self-play (`npm run train`), per preset and faction:
 * - shot: where armies of a faction end up placing units, relative to a blank board (mean ≈ 1);
 * - search: how early hunters reach each cell of a field (mean ≈ 1), used to hide pieces.
 * They are built only from what players see: layouts revealed at the end and the shot history.
 */
export interface PriorEntry {
  readonly games: number;
  readonly values: readonly number[];
}

export interface PriorsFile {
  readonly version: number;
  readonly shot: Readonly<Record<string, PriorEntry>>;
  readonly search: Readonly<Record<string, PriorEntry>>;
}

const FILE = priorsFile as PriorsFile;

export const TRAINED_PRIORS_VERSION: number = FILE.version ?? 0;

/** Key of a prior: the preset name, optionally with a faction ("full/grecia"). */
export function priorKey(config: FieldConfig, faction?: string | null): string {
  return faction ? `${config.name}/${faction}` : config.name;
}

function lookup(table: Readonly<Record<string, PriorEntry>>, config: FieldConfig, faction: string | null | undefined): Float64Array | null {
  const n = config.cols * config.rows;
  for (const key of [priorKey(config, faction), priorKey(config)]) {
    const entry = table[key];
    if (entry && entry.values.length === n && entry.games > 0) return Float64Array.from(entry.values);
  }
  return null;
}

/** Where an army of `faction` tends to keep its units on this preset (null when untrained). */
export function trainedShotPrior(config: FieldConfig, faction?: string | null, file: PriorsFile = FILE): Float64Array | null {
  return lookup(file.shot ?? {}, config, faction);
}

/** How early hunters reach each cell of this preset (null when untrained). */
export function trainedSearchPrior(config: FieldConfig, faction?: string | null, file: PriorsFile = FILE): Float64Array | null {
  return lookup(file.search ?? {}, config, faction);
}

interface Tally {
  games: number;
  sums: number[];
}

export interface PriorTallies {
  readonly shot: Readonly<Record<string, { games: number; sums: number[]; config: FieldConfig }>>;
  readonly search: Readonly<Record<string, { games: number; sums: number[]; config: FieldConfig }>>;
}

/**
 * Collects priors from finished matches. Feed it the final view of each
 * player; `build` returns the file to save.
 */
export class PriorBuilder {
  readonly #shot = new Map<string, Tally>();
  readonly #search = new Map<string, Tally>();
  readonly #configs = new Map<string, FieldConfig>();

  #tally(table: Map<string, Tally>, key: string, n: number): Tally {
    let t = table.get(key);
    if (!t) table.set(key, (t = { games: 0, sums: Array.from({ length: n }, () => 0) }));
    return t;
  }

  /** Final view of one player of a finished match. */
  add(view: PlayerView): void {
    if (view.phase !== 'finished' || !view.enemy.layout) return;
    const config = view.config;
    const n = config.cols * config.rows;
    const enemyFaction = view.enemy.faction?.id ?? 'neutra';
    const ownFaction = view.own.faction?.id ?? 'neutra';
    for (const key of [priorKey(config, enemyFaction), priorKey(config)]) {
      this.#configs.set(key, config);
      const t = this.#tally(this.#shot, key, n);
      t.games++;
      for (const c of revealedEnemyCells(view)) t.sums[c] = (t.sums[c] ?? 0) + 1;
    }
    // How early the opponent reached each of our cells.
    const order: number[] = [];
    const opponent = opponentOf(view.player);
    for (const h of view.history) {
      if (h.kind === 'shot' && h.by === opponent) order.push(h.report.target.row * config.cols + h.report.target.col);
      else if ((h.kind === 'ability' || h.kind === 'special') && h.by === opponent && h.outcome && 'shots' in h.outcome) {
        for (const s of h.outcome.shots) order.push(s.target.row * config.cols + s.target.col);
      }
    }
    for (const key of [priorKey(config, ownFaction), priorKey(config)]) {
      this.#configs.set(key, config);
      const t = this.#tally(this.#search, key, n);
      t.games++;
      order.forEach((cell, rank) => {
        t.sums[cell] = (t.sums[cell] ?? 0) + (1 - rank / n);
      });
    }
  }

  /** Raw tallies, plain data (to merge builders across workers). */
  export(): PriorTallies {
    const dump = (table: Map<string, Tally>) =>
      Object.fromEntries([...table].map(([key, t]) => [key, { games: t.games, sums: [...t.sums], config: this.#configs.get(key)! }]));
    return { shot: dump(this.#shot), search: dump(this.#search) };
  }

  merge(tallies: PriorTallies): void {
    for (const [name, table] of [['shot', this.#shot], ['search', this.#search]] as const) {
      for (const [key, t] of Object.entries(tallies[name])) {
        this.#configs.set(key, t.config);
        const mine = this.#tally(table, key, t.sums.length);
        mine.games += t.games;
        t.sums.forEach((s, i) => (mine.sums[i] = (mine.sums[i] ?? 0) + s));
      }
    }
  }

  build(version: number, strength = 6): PriorsFile {
    const round = (v: number) => Math.round(v * 1000) / 1000;
    const shot: Record<string, PriorEntry> = {};
    for (const [key, t] of this.#shot) {
      const config = this.#configs.get(key)!;
      const blank = blankPrior(config);
      const units = blank.reduce((a, b) => a + b, 0);
      const rate = t.sums.reduce((a, b) => a + b, 0) / Math.max(1, t.games);
      // Expected units per cell from the blank board, scaled to the army size seen.
      const expected = blank.map((b) => (b / units) * rate);
      shot[key] = {
        games: t.games,
        values: Array.from(expected, (e, c) => (e > 0 ? round(((t.sums[c] ?? 0) + strength * e) / (t.games + strength) / e) : 1)),
      };
    }
    const search: Record<string, PriorEntry> = {};
    for (const [key, t] of this.#search) {
      const raw = t.sums.map((s) => (s + strength * 0.5) / (t.games + strength));
      const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
      search[key] = { games: t.games, values: raw.map((v) => round(v / mean)) };
    }
    return { version, shot, search };
  }
}
