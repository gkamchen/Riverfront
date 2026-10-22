import type { PlayerView } from '@riverfront/core';

/** Anything with the localStorage shape works (localStorage itself, a Map wrapper, a file...). */
export interface BotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryStorage implements BotStorage {
  readonly #data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
}

/** Prefixo das chaves de aprendizado. */
export const STORAGE_PREFIX = 'riverfront:';
/** Prefixo usado antes da troca de nome do projeto; lido uma vez e copiado para a chave nova. */
const LEGACY_PREFIX = 'tower-destroyer:';

/** Lê uma chave; se ainda não existir, migra o valor salvo com o prefixo antigo. */
export function readMigrated(storage: BotStorage | null, key: string): string | null {
  if (!storage) return null;
  const current = storage.getItem(key);
  if (current !== null || !key.startsWith(STORAGE_PREFIX)) return current;
  const legacy = storage.getItem(LEGACY_PREFIX + key.slice(STORAGE_PREFIX.length));
  if (legacy !== null) storage.setItem(key, legacy);
  return legacy;
}

interface HeatData {
  games: number;
  counts: number[];
}

/**
 * How often each cell held a unit over past games. Used both to learn the
 * opponent's habits and to keep a bot's own layouts from repeating.
 */
export class HeatMap {
  readonly #storage: BotStorage | null;
  readonly #key: string;
  #data: HeatData;

  constructor(storage: BotStorage | null, key: string, cells: number) {
    this.#storage = storage;
    this.#key = key;
    this.#data = { games: 0, counts: Array.from({ length: cells }, () => 0) };
    const raw = readMigrated(storage, key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as HeatData;
        if (Array.isArray(parsed.counts) && parsed.counts.length === cells && Number.isFinite(parsed.games)) this.#data = parsed;
      } catch {
        // corrupt entry: start over
      }
    }
  }

  get games(): number {
    return this.#data.games;
  }

  record(cells: Iterable<number>): void {
    for (const c of cells) this.#data.counts[c] = (this.#data.counts[c] ?? 0) + 1;
    this.#data.games++;
    this.#storage?.setItem(this.#key, JSON.stringify(this.#data));
  }

  /**
   * Per-cell factor (mean ≈ 1) telling how much more often units sat on a cell
   * than `expected` predicts. `strength` is how many pseudo-games of the
   * expectation are mixed in, so early games move it only a little.
   */
  ratio(expected: Float64Array, strength = 4): Float64Array | null {
    if (this.#data.games === 0) return null;
    const g = this.#data.games;
    return expected.map((e, c) => {
      const rate = ((this.#data.counts[c] ?? 0) + strength * e) / (g + strength);
      return e > 0 ? rate / e : 1;
    });
  }
}

interface OrderData {
  games: number;
  /** Sum over games of how early the opponent shot each cell (1 = first shot, 0 = never). */
  early: number[];
}

/**
 * Learns the order in which the opponent searches our field, from its shots in
 * the shared history. Cells it reaches late are good hiding places.
 */
export class SearchOrderMap {
  readonly #storage: BotStorage | null;
  readonly #key: string;
  #data: OrderData;

  constructor(storage: BotStorage | null, key: string, cells: number) {
    this.#storage = storage;
    this.#key = key;
    this.#data = { games: 0, early: Array.from({ length: cells }, () => 0) };
    const raw = readMigrated(storage, key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as OrderData;
        if (Array.isArray(parsed.early) && parsed.early.length === cells && Number.isFinite(parsed.games)) this.#data = parsed;
      } catch {
        // corrupt entry: start over
      }
    }
  }

  get games(): number {
    return this.#data.games;
  }

  record(view: PlayerView): void {
    const cols = view.config.cols;
    const order: number[] = [];
    for (const h of view.history) {
      if (h.kind === 'end' || h.kind === 'tide' || h.kind === 'tower' || h.by !== view.opponent) continue;
      if (h.kind === 'shot') order.push(h.report.target.row * cols + h.report.target.col);
      else if (h.kind === 'ability' && h.outcome?.ability === 'bomb') {
        for (const s of h.outcome.shots) order.push(s.target.row * cols + s.target.col);
      } else if (h.kind === 'special' && h.outcome) {
        for (const s of h.outcome.shots) order.push(s.target.row * cols + s.target.col);
      }
    }
    const total = this.#data.early.length;
    order.forEach((cell, rank) => {
      this.#data.early[cell] = (this.#data.early[cell] ?? 0) + (1 - rank / total);
    });
    this.#data.games++;
    this.#storage?.setItem(this.#key, JSON.stringify(this.#data));
  }

  /** How early the opponent tends to reach each cell, normalised to mean 1 (null before any game). */
  earliness(strength = 2): Float64Array | null {
    if (this.#data.games === 0) return null;
    const g = this.#data.games;
    const raw = this.#data.early.map((e) => (e + strength * 0.5) / (g + strength));
    const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
    return Float64Array.from(raw, (v) => v / mean);
  }
}

/** Cells of the opponent's units, readable once the match is over. */
export function revealedEnemyCells(view: PlayerView): number[] {
  const layout = view.enemy.layout;
  if (!layout) return [];
  return layout.pieces.flatMap((p) => p.cells.map((c) => c.row * view.config.cols + c.col));
}

export function ownUnitCells(view: PlayerView): number[] {
  return view.own.cells.flatMap((c, i) => (c.role ? [i] : []));
}
